// logtime.js
const { google } = require("googleapis");

// ===============================
// Google Sheets Client
// ===============================
function getSheetsClient() {
    return new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
        ["https://www.googleapis.com/auth/spreadsheets"]
    );
}

// ===============================
// บันทึกชื่อ + เวลาออกเวร ลงชีต logtime
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
// อ่านจากห้อง log ใน Discord
// ===============================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    console.log("[LogTime] Module ready. Listening in channel:", LOG_CHANNEL);

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        if (message.author.bot) return;

        const content = message.content;

        const nameMatch = content.match(/ชื่อ\s+(.+)/);
        const timeMatch = content.match(/เวลาออกงาน.*?(\d{2}:\d{2}:\d{2})/);

        if (!nameMatch || !timeMatch) return;

        const name = nameMatch[1].trim();
        const time = timeMatch[1].trim();

        console.log("📥 Log detected:", name, time);

        await saveLog(name, time);
    });
}

module.exports = { saveLog, initializeLogListener };
