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
    // ใช้ CLIENT_EMAIL และ PRIVATE_KEY จาก Environment Variables
    const privateKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n") : null;
    if (!process.env.CLIENT_EMAIL || !privateKey) {
        console.log("❌ Missing GOOGLE ENV (CLIENT_EMAIL or PRIVATE_KEY)");
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
// SMART row finder
// -----------------------------
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rowData = resp.data.values || []; 
    const lowerCaseName = (name || "").trim().toLowerCase();

    // ค้นหาจากคอลัมน์ B
    let rowIndexB = rowData.findIndex((r, idx) => 
        idx >= 2 && r[0] && r[0].toLowerCase().includes(lowerCaseName)
    );
    if (rowIndexB !== -1) {
        return { row: rowIndexB + 1, isNew: false };
    }

    // ค้นหาจากคอลัมน์ C
    let rowIndexC = rowData.findIndex((r, idx) => 
        idx >= 2 && r[1] && r[1].trim().toLowerCase() === lowerCaseName
    );
    if (rowIndexC !== -1) {
        return { row: rowIndexC + 1, isNew: false };
    }

    // หาแถวว่างเริ่มต้นที่ 200
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
    return { row: targetRow, isNew: true };
}

// -----------------------------
// Extract Info
// -----------------------------
function extractMinimal(text) {
    // ลบ Markdown และตัวอักษรพิเศษ
    text = text.replace(/[`*]/g, "").replace(/\u200B/g, "");

    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    const out = text.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    const idMatch = text.match(/(steam:\w+)/i);
    const id = idMatch ? idMatch[1] : null;

    return { name, date, time, id };
}

// -----------------------------
// SAVE LOG (บันทึกเฉพาะข้อมูลพื้นฐาน)
// -----------------------------
async function saveLog(name, date, time, id) {
    const spreadsheetId = process.env.SPREADSHEET_ID || "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = await getSheetsClientCached();
    if (!auth) return;

    const sheets = google.sheets({ version: "v4", auth });
    const { row } = await findRowSmart(sheets, spreadsheetId, sheetName, name);
    
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

    if (data.length === 0) return;

    try {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            resource: { valueInputOption: "USER_ENTERED", data },
        });
        console.log(`✔ Updated Row ${row} → ${name} [${date}]`);
        return true;
    } catch (err) {
        console.error("❌ BatchUpdate Error:", err);
        return false;
    }
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
        
        let lines = [];
        if (message.content) lines.push(message.content);
        
        // รองรับข้อมูลที่อยู่ใน Embed
        if (message.embeds && message.embeds.length > 0) {
            message.embeds.forEach(embed => {
                const e = embed.data || embed;
                if (e.title) lines.push(e.title);
                if (e.description) lines.push(e.description);
                if (e.fields) {
                    e.fields.forEach(f => {
                        if (f) {
                            lines.push(f.name);
                            lines.push(f.value);
                        }
                    });
                }
            });
        }

        const text = lines.join("\n");
        const { name, date, time, id } = extractMinimal(text);

        if (!name || !date || !time) {
            return console.log("❌ DATA INCOMPLETE (Name, Date, or Time missing)");
        }

        console.log("🟩 PROCESSING:", name);
        const success = await saveLog(name, date, time, id);
        
        if (success) {
            console.log("✔ DONE");
            await message.react("✅").catch(() => {});
        } else {
            await message.react("❌").catch(() => {});
        }
    }
}

// Export เพื่อใช้ใน index.js
module.exports = { 
    saveLog, 
    initializeLogListener 
};
