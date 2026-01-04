// logtime.js (Optimized + Duration Tracking)
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

async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rowData = resp.data.values || []; 
    const lowerCaseName = (name || "").trim().toLowerCase();

    let rowIndexB = rowData.findIndex((r, idx) => idx >= 2 && r[0] && r[0].toLowerCase().includes(lowerCaseName));
    if (rowIndexB !== -1) return { row: rowIndexB + 1, cValue: (rowData[rowIndexB][1] || "").toString(), isNew: false };

    let rowIndexC = rowData.findIndex((r, idx) => idx >= 2 && r[1] && r[1].trim().toLowerCase() === lowerCaseName);
    if (rowIndexC !== -1) return { row: rowIndexC + 1, cValue: (rowData[rowIndexC][1] || "").toString(), isNew: false };

    const START_ROW = 200;
    let targetRow = START_ROW;
    for (let i = START_ROW - 1; i < Math.max(rowData.length, START_ROW); i++) {
        const row = rowData[i];
        if (!row || (!row[0] && !row[1])) { targetRow = i + 1; break; }
        if (i === rowData.length - 1) targetRow = rowData.length + 1;
    }
    return { row: targetRow, cValue: "", isNew: true };
}

// ฟังก์ชันหาคอลัมน์ตามวัน (จ=K, อ=L, พ=M, พฤ=N, ศ=O, ส=P, อา=Q)
function getDayColumn(dateString) {
    try {
        const [d, m, y] = dateString.split("/");
        const dateObj = new Date(y, m - 1, d);
        const day = dateObj.getDay(); // 0=อาทิตย์, 1=จันทร์...
        const mapping = { 1: "K", 2: "L", 3: "M", 4: "N", 5: "O", 6: "P", 0: "Q" };
        return mapping[day];
    } catch (e) { return null; }
}

function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");
    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    const out = text.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    const idMatch = text.match(/(steam:\w+)/i);
    const id = idMatch ? idMatch[1] : null;

    // --- ส่วนที่เพิ่ม: ดึงระยะเวลาเข้าเวร ---
    const durationMatch = text.match(/ระยะเวลาที่เข้าเวร\s*\n?\s*(\d{2}:\d{2}:\d{2})/i);
    const duration = durationMatch ? durationMatch[1] : null;

    return { name, date, time, id, duration };
}

async function saveLog(name, date, time, id, duration) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";
    const auth = await getSheetsClientCached();
    if (!auth) return;
    const sheets = google.sheets({ version: "v4", auth });

    const { row, cValue, isNew } = await findRowSmart(sheets, spreadsheetId, sheetName, name);
    const data = [];
    const valueInputOption = "USER_ENTERED";

    const cExists = !!(cValue && cValue.toString().trim() !== "");
    if (!cExists || isNew) {
        data.push({ range: `${sheetName}!C${row}`, values: [[name]] });
    }
    data.push({ range: `${sheetName}!D${row}:E${row}`, values: [[date, time]] });
    if (id) data.push({ range: `${sheetName}!G${row}`, values: [[id]] });

    // --- ส่วนที่เพิ่ม: บันทึกระยะเวลาลงตามวัน (K-Q) ---
    if (duration && date) {
        const col = getDayColumn(date);
        if (col) {
            data.push({
                range: `${sheetName}!${col}${row}`,
                values: [[duration]]
            });
        }
    }

    if (data.length === 0) return;
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: { valueInputOption, data },
    });
    console.log(`✔ Saved @ Row ${row} [DayCol Added] →`, name, date, duration);
}

function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";
    client.on("messageCreate", message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        process.nextTick(() => handleLog(message).catch(err => console.error("❌ handleLog error:", err)));
    });

    async function handleLog(message) {
        let lines = [];
        if (message.content) lines.push(message.content);
        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;
                if (e.title) lines.push(e.title);
                if (e.description) lines.push(e.description);
                if (e.fields) {
                    for (const f of e.fields) { if (f) { lines.push(f.name); lines.push(f.value); } }
                }
            }
        }
        const text = lines.join("\n");
        const { name, date, time, id, duration } = extractMinimal(text);

        if (!name || !date || !time) return;

        console.log("🟩 NAME:", name, "| DURATION:", duration);
        await saveLog(name, date, time, id, duration);
        console.log("✔ DONE");
    }
}

module.exports = { initializeLogListener };
