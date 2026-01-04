// logtime.js (Full Version - Accumulative Duration)
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const https = require("https");

// -----------------------------
// Environment tweaks (non-breaking)
// -----------------------------
process.env.GOOGLE_API_USE_MTLS_ENDPOINT = process.env.GOOGLE_API_USE_MTLS_ENDPOINT || "never";
process.env.GOOGLE_CLOUD_DISABLE_SPDY = process.env.GOOGLE_CLOUD_DISABLE_SPDY || "1";

// -----------------------------
// Keep-alive agent (reuse TCP connections)
// -----------------------------
const keepAliveAgent = new https.Agent({ keepAlive: true });
google.options({ httpAgent: keepAliveAgent });

// -----------------------------
// Cached sheets client
// -----------------------------
let _cachedAuthClient = null;
async function getSheetsClientCached() {
    if (_cachedAuthClient) return _cachedAuthClient;

    const privateKey = process.env.PRIVATE_KEY
        ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n")
        : null;

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
// Time Helpers (สำหรับการบวกเวลา)
// -----------------------------
function timeToSeconds(timeStr) {
    if (!timeStr || !timeStr.includes(":")) return 0;
    const parts = timeStr.split(":");
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseInt(parts[2], 10) || 0;
    return (h * 3600) + (m * 60) + s;
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

// -----------------------------
// SMART row finder
// -----------------------------
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`;
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });

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
        if (i === rowData.length - 1) {
            targetRow = rowData.length + 1;
        }
    }

    return { row: targetRow, cValue: "", isNew: true };
}

// -----------------------------
// Extract minimal info
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

    const durMatch = text.match(/ระยะเวลาที่เข้าเวร\s*\n?\s*(\d{2}:\d{2}:\d{2})/i);
    const duration = durMatch ? durMatch[1] : null;

    return { name, date, time, id, duration };
}

// -----------------------------
// SAVE OR UPDATE LOG (Updated with Summation)
// -----------------------------
async function saveLog(name, date, time, id, duration) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = await getSheetsClientCached();
    if (!auth) return;

    const sheets = google.sheets({ version: "v4", auth });

    const { row, cValue, isNew } = await findRowSmart(sheets, spreadsheetId, sheetName, name);

    const data = [];
    const valueInputOption = "USER_ENTERED";

    // ส่วนการทำงานเดิม (ห้ามแก้)
    const cExists = !!(cValue && cValue.toString().trim() !== "");
    if (!cExists || isNew) {
        data.push({
            range: `${sheetName}!C${row}`,
            values: [[name]],
        });
    }

    data.push({
        range: `${sheetName}!D${row}:E${row}`,
        values: [[date, time]],
    });

    if (id) {
        data.push({
            range: `${sheetName}!G${row}`,
            values: [[id]],
        });
    }

    // --- ส่วนที่เพิ่มใหม่: ระบบบวกเวลาสะสม (K-Q) ---
    if (duration && date) {
        const col = getDayColumn(date);
        if (col) {
            // อ่านค่าเวลาเก่าก่อน
            const currentRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!${col}${row}`,
            });
            const oldTimeStr = currentRes.data.values?.[0]?.[0] || "00:00:00";
            
            // บวกเวลา
            const totalSec = timeToSeconds(oldTimeStr) + timeToSeconds(duration);
            const finalTime = secondsToTime(totalSec);

            data.push({
                range: `${sheetName}!${col}${row}`,
                values: [[finalTime]],
            });
        }
    }

    if (data.length === 0) {
        console.log("⚠ Nothing to update.");
        return;
    }

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
            valueInputOption,
            data,
        },
    });

    console.log(`✔ Saved Row ${row} | Time Added: ${duration} | Total Today: ${date} -> Column ${getDayColumn(date)}`);
}

// -----------------------------
// Discord listener initializer
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

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 DURATION:", duration);

        await saveLog(name, date, time, id, duration);
        console.log("✔ DONE");
    }
}

module.exports = { initializeLogListener };
