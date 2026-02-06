const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const https = require("https");

// -----------------------------
// Environment tweaks
// -----------------------------
process.env.GOOGLE_API_USE_MTLS_ENDPOINT = process.env.GOOGLE_API_USE_MTLS_ENDPOINT || "never";
process.env.GOOGLE_CLOUD_DISABLE_SPDY = process.env.GOOGLE_CLOUD_DISABLE_SPDY || "1";

const keepAliveAgent = new https.Agent({ keepAlive: true });
google.options({ httpAgent: keepAliveAgent });

let _cachedAuthClient = null;
async function getSheetsClientCached() {
    if (_cachedAuthClient) return _cachedAuthClient;
    const privateKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n") : null;
    if (!process.env.CLIENT_EMAIL || !privateKey) {
        console.log("❌ Missing GOOGLE ENV");
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
// Time Helpers (บวกเวลาสะสม)
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
        const [d, m, y] = dateString.split("/");
        const dateObj = new Date(y, m - 1, d);
        const day = dateObj.getDay(); // 0=อา, 1=จ...
        const mapping = { 1: "K", 2: "L", 3: "M", 4: "N", 5: "O", 6: "P", 0: "Q" };
        return mapping[day];
    } catch (e) { return null; }
}

// -----------------------------
// SMART row finder (Logic เดิม)
// -----------------------------
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rowData = resp.data.values || []; 
    const lowerCaseName = (name || "").trim().toLowerCase();

    let rowIndexB = rowData.findIndex((r, idx) => 
        idx >= 2 && r[0] && r[0].toLowerCase().includes(lowerCaseName)
    );
    if (rowIndexB !== -1) {
        return { row: rowIndexB + 1, cValue: (rowData[rowIndexB][1] || "").toString(), isNew: false };
    }

    let rowIndexC = rowData.findIndex((r, idx) => 
        idx >= 2 && r[1] && r[1].trim().toLowerCase() === lowerCaseName
    );
    if (rowIndexC !== -1) {
        return { row: rowIndexC + 1, cValue: (rowData[rowIndexC][1] || "").toString(), isNew: false };
    }

    const START_ROW = 200;
    let targetRow = START_ROW;
    for (let i = START_ROW - 1; i < Math.max(rowData.length, START_ROW); i++) {
        const row = rowData[i];
        if (!row || (!row[0] && !row[1])) {
            targetRow = i + 1;
            break;
        }
        if (i === rowData.length - 1) targetRow = rowData.length + 1;
    }
    return { row: targetRow, cValue: "", isNew: true };
}

// -----------------------------
// Extract Info (เพิ่ม Duration)
// -----------------------------
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    const out = text.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    const idMatch = text.match(/(steam:\w+)/i);
    const id = idMatch ? idMatch[1] : null;

    // ดึงระยะเวลาเข้าเวร
    const durMatch = text.match(/ระยะเวลาที่เข้าเวร\s*\n?\s*(\d{2}:\d{2}:\d{2})/i);
    const duration = durMatch ? durMatch[1] : null;

    return { name, date, time, id, duration };
}

// -----------------------------
// SAVE LOG (All-in-one)
// -----------------------------
async function saveLog(name, date, time, id, duration) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = await getSheetsClientCached();
    if (!auth) return;

    const sheets = google.sheets({ version: "v4", auth });
    const { row } = await findRowSmart(sheets, spreadsheetId, sheetName, name);
    const dayCol = getDayColumn(date);
    const data = [];

    // 1. บันทึก ชื่อ, วันที่, เวลา (ช่อง C, D, E)
    data.push({
        range: `${sheetName}!C${row}:E${row}`,
        values: [[name, date, time]],
    });

    // 2. บันทึก ID (ช่อง G)
    if (id) {
        data.push({ range: `${sheetName}!G${row}`, values: [[id]] });
    }

    // 3. บวกเวลาสะสม (ช่อง K-Q ตามวัน)
    if (duration && dayCol) {
        const currentCell = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!${dayCol}${row}`,
        });
        const oldTimeStr = currentCell.data.values?.[0]?.[0] || "00:00:00";
        const newTotal = secondsToTime(timeToSeconds(oldTimeStr) + timeToSeconds(duration));
        
        data.push({
            range: `${sheetName}!${dayCol}${row}`,
            values: [[newTotal]],
        });
    }

    if (data.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: { valueInputOption: "USER_ENTERED", data },
    });

    console.log(`✔ Updated Row ${row} → ${name} [${date}] | Total in ${dayCol}: ${duration} Added`);
}

// -----------------------------
// Discord listener
// -----------------------------
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        process.nextTick(() => handleLog(message).catch(err => console.error("❌ handleLog error:", err)));
    });

    async function handleLog(message) {
        console.log("\n📥 NEW MESSAGE IN LOG CHANNEL");
        const lines = [];
        if (message.content) lines.push(message.content);
        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;
                if (e.title) lines.push(e.title);
                if (e.description) lines.push(e.description);
                if (e.fields) {
                    for (const f of e.fields) {
                        if (!f) continue;
                        lines.push(f.name);
                        lines.push(f.value);
                    }
                }
            }
        }

        const text = lines.join("\n");
        const { name, date, time, id, duration } = extractMinimal(text);

        if (!name || !date || !time) return console.log("❌ DATA INCOMPLETE");

        console.log("🟩 NAME:", name, "| DURATION:", duration);
        await saveLog(name, date, time, id, duration);
        console.log("✔ DONE");
    }
}

module.exports = { initializeLogListener };
