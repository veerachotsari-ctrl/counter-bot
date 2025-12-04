const { google } = require("googleapis");
const { JWT } = require("google-auth-library");


// ========================================================================
// Google Sheets Client
// ========================================================================
function getSheetsClient() {
    const privateKey = process.env.PRIVATE_KEY
        ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n")
        : null;

    if (!process.env.CLIENT_EMAIL || !privateKey) {
        console.log("❌ Missing GOOGLE ENV");
        return null;
    }

    return new JWT({
        email: process.env.CLIENT_EMAIL,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
}


// ========================================================================
// 🔍 ค้นหาแถวจากชื่อ (เริ่ม C3)
// ========================================================================
async function findRowByName(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!C3:C`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const rows = response.data.values || [];

    const index = rows.findIndex(row =>
        row[0] && row[0].trim().toLowerCase() === name.trim().toLowerCase()
    );

    return index === -1 ? null : index + 3;
}


// ========================================================================
// Save or Update (C = ชื่อ, D = วันที่, E = เวลา)
// ========================================================================
async function saveLog(name, date, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    const row = await findRowByName(sheets, spreadsheetId, sheetName, name);

    if (row) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!D${row}:E${row}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[date, time]] },
        });

        console.log(`🔄 Updated row ${row} →`, name, date, time);
    } else {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!C3`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, date, time]] },
        });

        console.log("➕ Added new row →", name, date, time);
    }
}


// ========================================================================
// ULTRA-LIGHT PARSER (เร็ว + เบา + แม่นสุด)
// ========================================================================
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    // 1) NAME
    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    // 2) Date + Time (อ่านเฉพาะบรรทัดสุดท้าย)
    const t = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    const date = t ? t[1] : null;
    const time = t ? t[2] : null;

    return { name, date, time };
}


// ========================================================================
// Discord Log Listener (เวอร์ชันเบาแรง)
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE");

        // -------- รวมเฉพาะข้อความที่ต้องใช้ --------
        let text = "";

        if (message.content) text += message.content + "\n";

        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;

                if (e.title) text += e.title + "\n";
                if (e.description) text += e.description + "\n";

                if (e.fields) {
                    for (const f of e.fields) {
                        if (!f) continue;
                        text += `${f.name}\n${f.value}\n`;
                    }
                }
            }
        }

        // -------- Extract minimal information --------
        const { name, date, time } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 Date/Time:", date, time);

        // -------- Save sheet --------
        await saveLog(name, date, time);

        console.log("✔ DONE:", name, date, time);
    });
}

module.exports = { initializeLogListener };
