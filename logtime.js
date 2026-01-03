// logtime.js (Optimized - "เร็วแรงสุด")
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
// Cached sheets client (avoid re-authorize)
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

    // Authorize once and cache the client (tokens are managed internally)
    await client.authorize();
    _cachedAuthClient = client;
    return _cachedAuthClient;
}

// -----------------------------
// SMART row finder (แก้ไข: สแกน B ถ้าไม่เจอเริ่มแถว 200)
// -----------------------------
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`;
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });

    const rowData = resp.data.values || []; // [[B1,C1], [B2,C2], ...]
    const lowerCaseName = (name || "").trim().toLowerCase();

    // STEP 1: search B (partial contains) - เริ่มหาตั้งแต่แถว 3
    let rowIndex = rowData.findIndex((r, idx) => idx >= 2 && r[0] && r[0].toLowerCase().includes(lowerCaseName));
    if (rowIndex !== -1) {
        return { row: rowIndex + 1, cValue: (rowData[rowIndex][1] || "").toString(), isNew: false };
    }

    // STEP 2: หากไม่เจอใน B ให้เริ่มหาแถวว่างตั้งแต่แถว 200 เป็นต้นไป
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
// Extract minimal info (name, date, time, id)
// identical behavior to original
// -----------------------------
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    // NAME
    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    // DATE + TIME (after 'เวลาออกงาน')
    const out = text.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    // ID (steam:xxxx)
    const idMatch = text.match(/(steam:\w+)/i);
    const id = idMatch ? idMatch[1] : null;

    return { name, date, time, id };
}

// -----------------------------
// SAVE OR UPDATE LOG (optimized: use batchUpdate, reuse auth)
// Behavior preserved exactly
// -----------------------------
async function saveLog(name, date, time, id) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = await getSheetsClientCached();
    if (!auth) return;

    const sheets = google.sheets({ version: "v4", auth });

    // Find row and existing C value in single read
    const { row, cValue, isNew } = await findRowSmart(sheets, spreadsheetId, sheetName, name);

    // Prepare batch updates (only produce the same cells that original did)
    const data = [];
    const valueInputOption = "USER_ENTERED";

    // If C empty or isNew → set C = name
    const cExists = !!(cValue && cValue.toString().trim() !== "");
    if (!cExists || isNew) {
        data.push({
            range: `${sheetName}!C${row}`,
            values: [[name]],
        });
    }

    // Update D + E (always)
    data.push({
        range: `${sheetName}!D${row}:E${row}`,
        values: [[date, time]],
    });

    // If id present → update G
    if (id) {
        data.push({
            range: `${sheetName}!G${row}`,
            values: [[id]],
        });
    }

    // If nothing to update (shouldn't happen because D+E always present), skip
    if (data.length === 0) {
        console.log("⚠ Nothing to update (unexpected).");
        return;
    }

    // Use batchUpdate to group updates into single API call
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
            valueInputOption,
            data,
        },
    });

    console.log(`✔ Saved @ Row ${row} →`, name, date, time, id ? `[ID: ${id}]` : '');
}

// -----------------------------
// Discord listener initializer
// Uses process.nextTick to avoid blocking event loop
// -----------------------------
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        // Defer actual heavy work to next tick (keeps bot responsive)
        process.nextTick(() => handleLog(message).catch(err => console.error("❌ handleLog error:", err)));
    });

    // Extract + save handler
    async function handleLog(message) {
        console.log("\n📥 NEW MESSAGE IN LOG CHANNEL");

        const lines = [];

        // message content
        if (message.content) lines.push(message.content);

        // embeds
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

        // Extract
        const { name, date, time, id } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 TIME:", date, time);
        if (id) console.log("🟩 ID:", id);

        // Save → Sheets
        await saveLog(name, date, time, id);

        console.log("✔ DONE");
    }
}

module.exports = { initializeLogListener };
