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
// 🔍 ค้นหาชื่อในคอลัมน์ไหนก็ได้ (B หรือ C)
// ========================================================================
async function findRowInColumn(sheets, spreadsheetId, sheetName, column, name) {
    const range = `${sheetName}!${column}3:${column}`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values || [];

    const idx = rows.findIndex(
        row => row[0] && row[0].trim().toLowerCase() === name.trim().toLowerCase()
    );

    return idx === -1 ? null : idx + 3;
}

// ========================================================================
// Save or Update
// C = ชื่อ, D = วันที่, E = เวลา
// ========================================================================
async function saveLog(name, date, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // 1️⃣ หาชื่อใน C ก่อน
    let rowC = await findRowInColumn(sheets, spreadsheetId, sheetName, "C", name);

    // 2️⃣ ถ้าไม่เจอ C → ไปหาที่ B
    let rowB = null;
    if (!rowC) {
        rowB = await findRowInColumn(sheets, spreadsheetId, sheetName, "B", name);
    }

    // 3️⃣ ถ้าเจอใน C → อัปเดตข้อมูลใน D,E
    if (rowC) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!D${rowC}:E${rowC}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[date, time]] },
        });

        console.log(`🔄 Updated row (C matched) ${rowC} →`, name, date, time);
        return;
    }

    // 4️⃣ ถ้าเจอใน B → เติมชื่อเข้า C และเขียนข้อมูล
    if (rowB) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!C${rowB}:E${rowB}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, date, time]] },
        });

        console.log(`🟦 Found in B → Filled at C row ${rowB}`);
        return;
    }

    // 5️⃣ ถ้าไม่เจอทั้ง B และ C → เพิ่มแถวใหม่ (เริ่มที่ C)
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!C3`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[name, date, time]] },
    });

    console.log("🟩 Added NEW row →", name, date, time);
}

// ========================================================================
// Ultra-Light Parser
// ========================================================================
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    // ชื่อ
    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    // Date + Time หลัง "เวลาออกงาน"
    const out = text.match(
        /เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i
    );

    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    return { name, date, time };
}

// ========================================================================
// Discord Listener
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE");

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

        const { name, date, time } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 Date/Time:", date, time);

        await saveLog(name, date, time);

        console.log("✔ DONE");
    });
}

module.exports = { initializeLogListener };
