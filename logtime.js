const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const https = require("https");

// -----------------------------
// Environment & Config
// -----------------------------
process.env.GOOGLE_API_USE_MTLS_ENDPOINT = "never";
process.env.GOOGLE_CLOUD_DISABLE_SPDY = "1";

const keepAliveAgent = new https.Agent({ keepAlive: true });
google.options({ httpAgent: keepAliveAgent });

let _cachedAuthClient = null;
const SPREADSHEET_ID = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
const SHEET_NAME = "logtime";

// ระบบ Queue เพื่อป้องกันการเขียนไฟล์ทับกัน (Race Condition)
let processingQueue = Promise.resolve();

async function getSheetsClientCached() {
    if (_cachedAuthClient) return _cachedAuthClient;
    const privateKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n") : null;
    if (!process.env.CLIENT_EMAIL || !privateKey) {
        console.error("❌ Missing GOOGLE ENV: Check CLIENT_EMAIL and PRIVATE_KEY");
        return null;
    }
    const client = new JWT({
        email: process.env.CLIENT_EMAIL,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    await client.authorize();
    _cachedAuthClient = client;
    return _cachedAuthClient;
}

// -----------------------------
// Time Helpers
// -----------------------------
function timeToSeconds(timeStr) {
    if (!timeStr || !timeStr.includes(":")) return 0;
    const parts = timeStr.split(":").map(Number);
    return (parts[0] * 3600) + (parts[1] * 60) + (parts[2] || 0);
}

function secondsToTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function getDayColumn(dateString) {
    try {
        const [d, m, y] = dateString.split("/").map(Number);
        // สร้าง Date Object (ระวังเรื่องปี พ.ศ./ค.ศ.)
        const dateObj = new Date(y < 2500 ? y : y - 543, m - 1, d); 
        const day = dateObj.getDay(); 
        const mapping = { 1: "K", 2: "L", 3: "M", 4: "N", 5: "O", 6: "P", 0: "Q" };
        return mapping[day];
    } catch (e) { return null; }
}

// -----------------------------
// Core Logic
// -----------------------------
async function findRowSmart(sheets, name) {
    const range = `${SHEET_NAME}!B:C`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    const rowData = resp.data.values || []; 
    const lowerCaseName = (name || "").trim().toLowerCase();

    // ค้นหาใน Column B หรือ C
    let foundIndex = rowData.findIndex((r, idx) => {
        if (idx < 2) return false; // ข้าม Header
        const colB = (r[0] || "").toLowerCase();
        const colC = (r[1] || "").toLowerCase();
        return colB.includes(lowerCaseName) || colC === lowerCaseName;
    });

    if (foundIndex !== -1) return foundIndex + 1;

    // ถ้าไม่เจอ หาแถวว่างเริ่มที่ 200
    const START_ROW = 200;
    for (let i = START_ROW - 1; i < Math.max(rowData.length, START_ROW); i++) {
        if (!rowData[i] || (!rowData[i][0] && !rowData[i][1])) return i + 1;
    }
    return rowData.length + 1;
}

function extractMinimal(text) {
    text = text.replace(/[`*]|(\u200B)/g, "");

    const nameMatch = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const outMatch = text.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const idMatch = text.match(/(steam:\w+)/i);
    const durMatch = text.match(/ระยะเวลาที่เข้าเวร\s*\n?\s*(\d{2}:\d{2}:\d{2})/i);

    return {
        name: nameMatch ? nameMatch[1].trim() : null,
        date: outMatch ? outMatch[1] : null,
        time: outMatch ? outMatch[2] : null,
        id: idMatch ? idMatch[1] : null,
        duration: durMatch ? durMatch[1] : null
    };
}

async function saveLog(name, date, time, id, duration) {
    const auth = await getSheetsClientCached();
    if (!auth) return;
    const sheets = google.sheets({ version: "v4", auth });

    try {
        const row = await findRowSmart(sheets, name);
        const dayCol = getDayColumn(date);
        const data = [];

        // บันทึกข้อมูลพื้นฐาน (C: Name, D: Date, E: Time)
        data.push({ range: `${SHEET_NAME}!C${row}:E${row}`, values: [[name, date, time]] });
        if (id) data.push({ range: `${SHEET_NAME}!G${row}`, values: [[id]] });

        // คำนวณเวลาสะสม
        if (duration && dayCol) {
            const currentCell = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!${dayCol}${row}`,
            });
            const oldTimeStr = currentCell.data.values?.[0]?.[0] || "00:00:00";
            const newTotal = secondsToTime(timeToSeconds(oldTimeStr) + timeToSeconds(duration));
            data.push({ range: `${SHEET_NAME}!${dayCol}${row}`, values: [[newTotal]] });
        }

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { valueInputOption: "USER_ENTERED", data },
        });

        console.log(`✅ SUCCESS: Row ${row} | ${name} | Added: ${duration}`);
    } catch (err) {
        console.error("❌ GOOGLE API ERROR:", err.message);
    }
}

// -----------------------------
// Discord Listener
// -----------------------------
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", message => {
        if (message.channel.id !== LOG_CHANNEL || message.author.bot) return;

        // ดึงข้อความจาก Embeds หรือ Content
        let lines = [message.content];
        message.embeds.forEach(embed => {
            if (embed.title) lines.push(embed.title);
            if (embed.description) lines.push(embed.description);
            embed.fields?.forEach(f => lines.push(f.name, f.value));
        });

        const text = lines.join("\n");
        const { name, date, time, id, duration } = extractMinimal(text);

        if (!name || !date || !time) return;

        console.log(`📩 Processing log for: ${name}...`);
        
        // ใส่เข้า Queue เพื่อป้องกันปัญหาเวลาทับกัน
        processingQueue = processingQueue.then(() => 
            saveLog(name, date, time, id, duration)
        ).catch(err => console.error("❌ Queue Error:", err));
    });
}

module.exports = { initializeLogListener };
