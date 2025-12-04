// logtime.js
const { google } = require("googleapis");

// ===============================
// Google Sheets Authentication
// ===============================
function getSheetsClient() {
    return new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        process.env.PRIVATE_KEY.replace(/\\n/g, "\n"), // สำคัญมาก
        ["https://www.googleapis.com/auth/spreadsheets"]
    );
}

// ===============================
// บันทึกลง Google Sheet
// ===============================
async function saveLog(name, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const client = getSheetsClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A2`,
            valueInputOption: "USER_ENTERED",
            resource: {
                values: [[name, time]]
            }
        });

        console.log(`✔ Saved to Google Sheets: ${name} | ${time}`);
        return true;

    } catch (err) {
        console.error("❌ Google Sheets ERROR:", err);
        return false;
    }
}

// ===============================
// จับข้อความในห้อง log
// ===============================
function initializeLogListener(client) {

    const LOG_CHANNEL = "1445640443986710548";

    console.log("[LogTime] Module ready. Listening in channel:", LOG_CHANNEL);

    client.on("messageCreate", async message => {

        if (message.channel.id !== LOG_CHANNEL) return;
        if (message.author.bot) return;

        const content = message.content.trim();

        // ============================
        // Regex แยกชื่อ
        // เช่น:
        // "ชื่อ นายแดง เวลาออกงาน 12:30:55"
        // ============================
        const nameMatch =
            content.match(/ชื่อ[:\s]+(.+?)(?:เวลา|$)/i) ||
            content.match(/ชื่อ\s+(.+)/i);

        const timeMatch =
            content.match(/(\d{2}:\d{2}:\d{2})/) ||
            content.match(/เวลา[:\s]+(\d{2}:\d{2}(:\d{2})?)/);

        if (!nameMatch || !timeMatch) {
            console.log("⚠ ข้อความไม่เข้าเงื่อนไข ไม่บันทึก:", content);
            return;
        }

        const name = nameMatch[1].trim();
        let time = timeMatch[1].trim();

        // เผื่อเขียนแบบ 12:30 ไม่มีวินาที
        if (/^\d{2}:\d{2}$/.test(time)) {
            time = `${time}:00`;
        }

        console.log("📥 Detected Log:", name, time);

        await saveLog(name, time);
    });
}

module.exports = { saveLog, initializeLogListener };
