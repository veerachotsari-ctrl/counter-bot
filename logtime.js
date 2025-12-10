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
// 🔍 ค้นหาแถวจากชื่อ (แบบใหม่: เช็คทั้ง C และ B)
// ========================================================================
async function findRowByName(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B3:C`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const rows = res.data.values || [];
    const lower = name.trim().toLowerCase();

    let foundIndex = null;

    rows.forEach((row, i) => {
        const colB = row[0] ? row[0].toLowerCase() : "";
        const colC = row[1] ? row[1].toLowerCase() : "";

        // เงื่อนไข 1: C = ชื่อเป๊ะ
        if (colC === lower) {
            foundIndex = i + 3;
        }

        // เงื่อนไข 2: B มีชื่ออยู่ในข้อความ เช่น
        // "00 [FTPD] Baigapow MooKrob"
        if (!foundIndex && colB.includes(lower)) {
            foundIndex = i + 3;
        }
    });

    return foundIndex;
}


// ========================================================================
// Save / Update Database
// B = Tag+Name, C = Pure Name, D = วัน, E = เวลาออกงาน
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
        // อัปเดตเฉพาะคอลัมน์ D & E
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!D${row}:E${row}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[date, time]] },
        });

        console.log(`🔄 Updated row ${row} →`, name, date, time);
    } else {
        // ถ้าไม่เจอ → เพิ่มแถวใหม่ (เติม B,C,D,E)
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!B3`,
            valueInputOption: "USER_ENTERED",
            resource: {
                values: [[`FTPD ${name}`, name, date, time]]
            }
        });

        console.log("➕ Added NEW row →", name, date, time);
    }
}


// ========================================================================
// 🧠 ULTRA-LIGHT PARSER (ดึงเฉพาะ “เวลาออกงาน” แบบแม่น)
// ========================================================================
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    // 1️⃣ NAME
    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    // 2️⃣ Date/Time หลังคำว่า “เวลาออกงาน”
    const out = text.match(
        /เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i
    );

    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    return { name, date, time };
}


// ========================================================================
// Discord Log Listener
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE RECEIVED");

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

        // 🎯 Extract ONLY what needed
        const { name, date, time } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 Date/Time:", date, time);

        // 📝 Save to Google Sheet
        await saveLog(name, date, time);

        console.log("✔ FINISHED:", name, date, time);
    });
}

module.exports = { initializeLogListener };
