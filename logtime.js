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
// 🔍 ค้นหาแถวจากชื่อ (B คอลัมน์) — ป้องกันชื่อซ้ำ 100%
// ========================================================================
async function findRowByName(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B2:B`;  
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const rows = response.data.values || [];

    const index = rows.findIndex(row =>
        row[0] && row[0].trim().toLowerCase() === name.trim().toLowerCase()
    );

    if (index === -1) return null;

    return index + 2;  // offset เพราะเริ่มที่ B2
}


// ========================================================================
// Save or Update
// ========================================================================
async function saveLog(name, date, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // 1) หาแถวที่มีชื่อซ้ำ
    const row = await findRowByName(sheets, spreadsheetId, sheetName, name);

    if (row) {
        // 2) ถ้ามีชื่อ → update แค่วันที่ + เวลา
        const updateRange = `${sheetName}!C${row}:D${row}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[date, time]] },
        });

        console.log(`🔄 Updated existing row ${row} →`, name, date, time);
    } else {
        // 3) ถ้าไม่เจอชื่อ → append ใหม่
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!B2`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, date, time]] },
        });

        console.log("➕ Added new row →", name, date, time);
    }
}


// ========================================================================
// Discord Log Listener
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE");

        let text = message.content ? message.content + "\n" : "";

        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;

                if (e.title) text += e.title + "\n";
                if (e.description) text += e.description + "\n";

                const fields = e.fields || [];
                for (const f of fields) {
                    if (!f) continue;
                    const fname = f.name?.trim() || "";
                    const fvalue = f.value?.trim() || "";
                    text += `${fname}\n${fvalue}\n`;
                }
            }
        }

        text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

        console.log("📜 PARSED:\n" + text);

        // --------------------- Extract Name ---------------------
        let name = null;

        const n1 = text.match(/(?:^|\n)ชื่อ\s*\n(.+?)(?:\n\S|$)/i);
        if (n1) name = n1[1].trim();

        const n2 = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+?)(?:\n|$)/i);
        if (!name && n2) name = n2[1].trim();

        if (!name) {
            console.log("❌ NAME NOT FOUND");
            return;
        }

        console.log("🟩 NAME:", name);

        // --------------------- Extract Date + Time ---------------------
        let date = null, time = null;
        const dtRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/g;

        let match, last;
        while ((match = dtRegex.exec(text)) !== null) last = match;

        if (!last) {
            console.log("❌ DATE NOT FOUND");
            return;
        }

        date = last[1];
        time = last[2];

        console.log("🟩 Date/Time:", date, time);


        // --------------------- Save / Update ---------------------
        await saveLog(name, date, time);

        console.log("✔ DONE:", name, date, time);
    });
}

module.exports = { initializeLogListener };
