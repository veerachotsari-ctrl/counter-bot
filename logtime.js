// logtime.js (Full Optimized - All-in-one Update)
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const https = require("https");

process.env.GOOGLE_API_USE_MTLS_ENDPOINT = process.env.GOOGLE_API_USE_MTLS_ENDPOINT || "never";
process.env.GOOGLE_CLOUD_DISABLE_SPDY = process.env.GOOGLE_CLOUD_DISABLE_SPDY || "1";

const keepAliveAgent = new https.Agent({ keepAlive: true });
google.options({ httpAgent: keepAliveAgent });

let _cachedAuthClient = null;
async function getSheetsClientCached() {
    if (_cachedAuthClient) return _cachedAuthClient;
    const privateKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n") : null;
    if (!process.env.CLIENT_EMAIL || !privateKey) return null;
    const client = new JWT({
        email: process.env.CLIENT_EMAIL,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    await client.authorize();
    _cachedAuthClient = client;
    return _cachedAuthClient;
}

// --- Helper Functions ---
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
        const [d, m, y] = dateString.split("/");
        const dateObj = new Date(y, m - 1, d);
        const day = dateObj.getDay(); 
        const mapping = { 1: "K", 2: "L", 3: "M", 4: "N", 5: "O", 6: "P", 0: "Q" };
        return mapping[day];
    } catch (e) { return null; }
}

async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rowData = resp.data.values || []; 
    const lowerCaseName = (name || "").trim().toLowerCase();

    // หาจากช่อง B ก่อน
    let rowIndex = rowData.findIndex((r, idx) => idx >= 2 && r[0] && r[0].toLowerCase().includes(lowerCaseName));
    if (rowIndex === -1) { // ถ้าไม่เจอหาช่อง C
        rowIndex = rowData.findIndex((r, idx) => idx >= 2 && r[1] && r[1].trim().toLowerCase() === lowerCaseName);
    }

    if (rowIndex !== -1) return { row: rowIndex + 1, isNew: false };

    const START_ROW = 200;
    let targetRow = START_ROW;
    for (let i = START_ROW - 1; i < Math.max(rowData.length, START_ROW); i++) {
        if (!rowData[i] || (!rowData[i][0] && !rowData[i][1])) { targetRow = i + 1; break; }
        if (i === rowData.length - 1) targetRow = rowData.length + 1;
    }
    return { row: targetRow, isNew: true };
}

function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");
    const name = (text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i) || [])[1]?.trim();
    const out = text.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const id = (text.match(/(steam:\w+)/i) || [])[1];
    const duration = (text.match(/ระยะเวลาที่เข้าเวร\s*\n?\s*(\d{2}:\d{2}:\d{2})/i) || [])[1];
    return { name, date: out?.[1], time: out?.[2], id, duration };
}

// --- Main Save Function ---
async function saveLog(name, date, time, id, duration) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";
    const auth = await getSheetsClientCached();
    if (!auth) return;
    const sheets = google.sheets({ version: "v4", auth });

    const { row, isNew } = await findRowSmart(sheets, spreadsheetId, sheetName, name);
    const dayCol = getDayColumn(date);
    const batchData = [];

    // 1. งานเดิม: บันทึกวันเวลาและ ID
    if (isNew) batchData.push({ range: `${sheetName}!C${row}`, values: [[name]] });
    batchData.push({ range: `${sheetName}!D${row}:E${row}`, values: [[date, time]] });
    if (id) batchData.push({ range: `${sheetName}!G${row}`, values: [[id]] });

    // 2. งานใหม่: บวกเวลาสะสม (ทำพร้อมกัน)
    if (duration && dayCol) {
        const currentCell = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!${dayCol}${row}`
        });
        const oldTime = currentCell.data.values?.[0]?.[0] || "00:00:00";
        const newTotal = secondsToTime(timeToSeconds(oldTime) + timeToSeconds(duration));
        batchData.push({ range: `${sheetName}!${dayCol}${row}`, values: [[newTotal]] });
    }

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: { valueInputOption: "USER_ENTERED", data: batchData }
    });
    console.log(`✔ [All-in-one] Saved ${name} to Row ${row} | Day: ${dayCol}`);
}

function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";
    client.on("messageCreate", async (msg) => {
        if (msg.channel.id !== LOG_CHANNEL) return;
        const lines = [msg.content];
        if (msg.embeds) msg.embeds.forEach(e => {
            lines.push(e.title, e.description);
            if (e.fields) e.fields.forEach(f => lines.push(f.name, f.value));
        });
        const { name, date, time, id, duration } = extractMinimal(lines.join("\n"));
        if (name && date && time) await saveLog(name, date, time, id, duration);
    });
}

module.exports = { initializeLogListener };
