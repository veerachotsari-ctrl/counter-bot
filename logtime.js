const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const https = require("https");

// -----------------------------
// Environment tweaks
// -----------------------------
process.env.GOOGLE_API_USE_MTLS_ENDPOINT =
    process.env.GOOGLE_API_USE_MTLS_ENDPOINT || "never";

process.env.GOOGLE_CLOUD_DISABLE_SPDY =
    process.env.GOOGLE_CLOUD_DISABLE_SPDY || "1";

const keepAliveAgent = new https.Agent({ keepAlive: true });
google.options({ httpAgent: keepAliveAgent });


// -----------------------------
// Auth Cache
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
// Duplicate Guard
// -----------------------------
const recentMessages = new Set();


// -----------------------------
// SMART row finder
// -----------------------------
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {

    // จำกัดช่วง (เร็วขึ้น)
    const range = `${sheetName}!B2:C500`;

    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });

    const rowData = resp.data.values || [];

    const lowerCaseName = (name || "")
        .trim()
        .toLowerCase();


    // ค้นจาก B
    let rowIndexB = rowData.findIndex((r, idx) =>
        idx >= 1 &&
        r?.[0] &&
        r[0].toLowerCase().includes(lowerCaseName)
    );

    if (rowIndexB !== -1) {
        return { row: rowIndexB + 2, isNew: false };
    }


    // ค้นจาก C
    let rowIndexC = rowData.findIndex((r, idx) =>
        idx >= 1 &&
        r?.[1] &&
        r[1].trim().toLowerCase() === lowerCaseName
    );

    if (rowIndexC !== -1) {
        return { row: rowIndexC + 2, isNew: false };
    }


    // หาแถวว่าง (เริ่ม 200)
    const START_ROW = 200;

    let targetRow = START_ROW;

    for (let i = START_ROW - 2; i < Math.max(rowData.length, START_ROW); i++) {

        const row = rowData[i];

        if (!row || (!row[0] && !row[1])) {
            targetRow = i + 2;
            break;
        }

        if (i === rowData.length - 1) {
            targetRow = rowData.length + 2;
        }
    }

    return { row: targetRow, isNew: true };
}


// -----------------------------
// Extract Info
// -----------------------------
function extractMinimal(text) {

    text = text
        .replace(/[`*]/g, "")
        .replace(/\u200B/g, "");


    // ชื่อ (ยืดหยุ่นขึ้น)
    const n = text.match(
        /รายงานเข้าเวรของ\s*[:\-–—]?\s*(.+)/i
    );

    const name = n ? n[1].trim() : null;


    // วันที่ / เวลา
    const out = text.match(
        /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i
    );

    const date = out ? out[1] : null;
    const time = out ? out[2] : null;


    // Steam ID
    const idMatch = text.match(/steam:\w+/i);
    const id = idMatch ? idMatch[0] : null;


    return { name, date, time, id };
}


// -----------------------------
// SAVE LOG
// -----------------------------
async function saveLog(name, date, time, id) {

    try {

        const spreadsheetId =
            "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";

        const sheetName = "logtime";


        const auth = await getSheetsClientCached();

        if (!auth) return;


        const sheets = google.sheets({
            version: "v4",
            auth,
        });


        // หาแถว
        const { row } = await findRowSmart(
            sheets,
            spreadsheetId,
            sheetName,
            name
        );


        const data = [];


        // ชื่อ + วันที่ + เวลา
        data.push({
            range: `${sheetName}!C${row}:E${row}`,
            values: [[name, date, time]],
        });


        // Steam ID
        if (id) {
            data.push({
                range: `${sheetName}!G${row}`,
                values: [[id]],
            });
        }


        if (data.length === 0) return;


        // เขียน Sheet
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            resource: {
                valueInputOption: "USER_ENTERED",
                data,
            },
        });


        console.log(`✔ Updated Row ${row} → ${name}`);


    } catch (err) {

        console.error("❌ saveLog error:", err.message);

    }
}


// -----------------------------
// Discord listener
// -----------------------------
function initializeLogListener(client) {

    const LOG_CHANNEL = "1445640443986710548";


    client.on("messageCreate", message => {

        // กัน Bot / Webhook
        if (message.author?.bot) return;

        if (message.channel.id !== LOG_CHANNEL) return;


        process.nextTick(() => {

            handleLog(message)
                .catch(err =>
                    console.error("❌ handleLog error:", err)
                );

        });

    });


    async function handleLog(message) {

        // กันข้อความซ้ำ
        if (recentMessages.has(message.id)) return;

        recentMessages.add(message.id);

        setTimeout(() => {
            recentMessages.delete(message.id);
        }, 60000);


        console.log("\n📥 NEW MESSAGE IN LOG CHANNEL");


        const lines = [];


        if (message.content) {
            lines.push(message.content);
        }


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

        // Debug ได้ถ้าจำเป็น
        // console.log("RAW TEXT:\n", text);


        const { name, date, time, id } =
            extractMinimal(text);


        if (!name || !date || !time) {

            console.log("❌ DATA INCOMPLETE");
            return;
        }


        console.log("🟩 NAME:", name, "| DATE:", date);


        await saveLog(name, date, time, id);


        console.log("✔ DONE");
    }
}


module.exports = {
    initializeLogListener,
};
