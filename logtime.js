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
// 🔍 ดึงค่าทั้งคอลัมน์
// ========================================================================
async function getColumnValues(sheets, spreadsheetId, sheetName, col) {
    const range = `${sheetName}!${col}3:${col}`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
}

// ========================================================================
// 🔍 หาในคอลัมน์ B ก่อน
// B = "00 [FTPD] Baigapow Mookrob"
// เทียบกับชื่อจริงจาก Log = "Baigapow Mookrob"
// ========================================================================
function extractRealNameFromB(text) {
    // ตัดเลขนำหน้า + tag เช่น [FTPD]
    return text
        .replace(/^\d+\s*\[[^\]]+\]\s*/i, "")
        .trim()
        .toLowerCase();
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

    // 1) เตรียมข้อมูล
    const nameLower = name.trim().toLowerCase();

    // 2) โหลดคอลัมน์ B และ C
    const colB = await getColumnValues(sheets, spreadsheetId, sheetName, "B");
    const colC = await getColumnValues(sheets, spreadsheetId, sheetName, "C");

    let foundRowB = null;
    let foundRowC = null;

    // 3) 🔍 หาใน B ก่อน
    colB.forEach((row, i) => {
        const cell = row[0];
        if (!cell) return;

        const cleaned = extractRealNameFromB(cell);
        if (cleaned === nameLower) {
            foundRowB = i + 3; // row number
        }
    });

    // 4) ถ้าไม่เจอใน B → หาใน C
    if (!foundRowB) {
        colC.forEach((row, i) => {
            const cell = row[0];
            if (!cell) return;

            if (cell.trim().toLowerCase() === nameLower) {
                foundRowC = i + 3;
            }
        });
    }

    // ====================================================================
    // เคส 1️⃣ เจอใน B → เขียนชื่อใน C + วันที่ + เวลา
    // ====================================================================
    if (foundRowB) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!C${foundRowB}:E${foundRowB}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, date, time]] },
        });

        console.log(`🟦 Match in B → Wrote name into C row ${foundRowB}`);
        return;
    }

    // ====================================================================
    // เคส 2️⃣ เจอใน C → อัปเดตวันที่ + เวลาอย่างเดียว
    // ====================================================================
    if (foundRowC) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!D${foundRowC}:E${foundRowC}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[date, time]] },
        });

        console.log(`🔄 Updated existing C row ${foundRowC}`);
        return;
    }

    // ====================================================================
    // เคส 3️⃣ ไม่เจอทั้ง B และ C → เพิ่มแถวใหม่ใน C
    // ====================================================================
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!C3`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[name, date, time]] },
    });

    console.log("🟩 Added NEW entry:", name);
}

// ========================================================================
// Ultra-Light Parser
// ========================================================================
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    const out = text.match(
        /เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i
    );

    return {
        name,
        date: out ? out[1] : null,
        time: out ? out[2] : null,
    };
}

// ========================================================================
// Discord Listener
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        let text = "";

        if (message.content) text += message.content + "\n";

        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;

                if (e.title) text += e.title + "\n";
                if (e.description) text += e.description + "\n";

                if (e.fields) {
                    for (const f of e.fields) {
                        text += `${f.name}\n${f.value}\n`;
                    }
                }
            }
        }

        const { name, date, time } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("📥 Parsed:", name, date, time);

        await saveLog(name, date, time);

        console.log("✔ DONE");
    });
}

module.exports = { initializeLogListener };
