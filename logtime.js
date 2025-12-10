// ========================================================================
// logtime.js (FULL VERSION) 
// - อ่าน log จาก Discord
// - ดึงชื่อ / เวลาออกงาน
// - ค้นหาใน Google Sheets (B = ชื่อเต็ม, C = ชื่อย่อ)
// - อัปเดตเวลาออกงานลง D และ E
// ========================================================================

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
// 🔍 ค้นหาแถวจากชื่อในคอลัมน์ B (B3:B = “00 [FTPD] Baigapow MooKrob”)
// ใช้ contains, ไม่ต้องตรงเป๊ะ, ไม่สนตัวพิมพ์เล็กใหญ่
// ========================================================================
async function findRowByName(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B3:B`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const rows = response.data.values || [];

    const lowerName = name.trim().toLowerCase();

    const index = rows.findIndex(row => {
        if (!row[0]) return false;
        return row[0].toLowerCase().includes(lowerName);
    });

    return index === -1 ? null : index + 3;
}


// ========================================================================
// Save or Update (C = ชื่อย่อ, D = วันที่, E = เวลาออกงาน)
// ========================================================================
async function saveLog(name, date, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return false;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // หาบรรทัดจากชื่อในคอลัมน์ B
    const row = await findRowByName(sheets, spreadsheetId, sheetName, name);

    // ถ้าเจอ → update D + E
    if (row) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!D${row}:E${row}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[date, time]] },
        });

        console.log(`🔄 Updated row ${row} →`, name, date, time);
        return true;
    }

    // ถ้าไม่เจอ → append ข้อมูลใหม่ (C = ชื่อ, D = วันที่, E = เวลา)
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!C3`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[name, date, time]] },
    });

    console.log("➕ Added new row →", name, date, time);
    return true;
}


// ========================================================================
// Extract Minimal Info from Discord Log
// ดึงแค่ “ชื่อ”, “วันที่ออกงาน”, “เวลาออกงาน”
// ========================================================================
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    // NAME
    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    // DATE + TIME
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

        console.log("\n📥 NEW MESSAGE");

        let text = "";

        if (message.content) text += message.content + "\n";

        // อ่าน Embed ทั้งหมด
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

        // 🔍 Extract
        const { name, date, time } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 Date/Time:", date, time);

        // 📝 Save to Google Sheet
        await saveLog(name, date, time);

        console.log("✔ DONE:", name, date, time);
    });
}

module.exports = { initializeLogListener, saveLog };
