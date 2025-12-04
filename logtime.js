const { google } = require("googleapis");

// ===============================
// Google Sheets Auth แบบเดียวกับ CountCase.js
// ===============================
async function getSheetsClient() {
    const privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, "\n");

    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.CLIENT_EMAIL,
            private_key: privateKey
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    return await auth.getClient();
}

// ===============================
// บันทึกชื่อ + เวลาออกเวร ลงชีต logtime
// ===============================
async function saveLog(name, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    try {
        const auth = await getSheetsClient();
        const sheets = google.sheets({ version: "v4", auth });

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
// อ่านข้อมูลจากห้อง Log ใน Discord
// ===============================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    console.log("[LogTime] Module ready. Listening:", LOG_CHANNEL);

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        if (message.author.bot) return;

        const text = message.content;

        // ดึงชื่อ
        const nameMatch = text.match(/ชื่อ\s+(.+)/);

        // ดึงเวลา
        const timeMatch = text.match(/เวลาออกงาน.*?(\d{2}:\d{2}:\d{2})/);

        if (!nameMatch || !timeMatch) return;

        const name = nameMatch[1].trim();
        const time = timeMatch[1].trim();

        console.log("📥 Detected Log:", name, time);

        await saveLog(name, time);
    });
}

module.exports = { saveLog, initializeLogListener };
