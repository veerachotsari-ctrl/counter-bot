// logtime.js
const { google } = require("googleapis");

// ===============================
// DEBUG: แสดงค่าเข้ามา
// ===============================
console.log("🔍 DEBUG CHECK");
console.log("CLIENT_EMAIL:", process.env.CLIENT_EMAIL || "(missing)");
console.log("PRIVATE_KEY length:", process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.length : "(missing)");
console.log("PRIVATE_KEY first 30 chars:", process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.substring(0, 30) : "(missing)");

// ===============================
// Create Google Sheets Client
// ===============================
function getSheetsClient() {
    let key = process.env.PRIVATE_KEY;

    if (!key) {
        console.log("❌ PRIVATE_KEY missing in environment!");
        return null;
    }

    // convert \n → newline
    key = key.replace(/\\n/g, "\n");

    console.log("🔑 PRIVATE_KEY sanitized. New length:", key.length);

    const client = new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        key,
        ["https://www.googleapis.com/auth/spreadsheets"]
    );

    return client;
}

// ===============================
// Append To Google Sheet
// ===============================
async function saveLog(name, time) {
    console.log(`📝 saveLog() called → ${name}, ${time}`);

    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const client = getSheetsClient();
    if (!client) {
        console.log("❌ Google client not created!");
        return false;
    }

    try {
        await client.authorize();
        console.log("✅ Google Auth Success");
    } catch (e) {
        console.log("❌ Google Auth FAILED:", e.message);
        return false;
    }

    const sheets = google.sheets({ version: "v4", auth: client });

    try {
        const res = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A2`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, time]] }
        });

        console.log("📌 Google Sheets Append Result:", JSON.stringify(res.data));
        console.log("✔ Saved to Google Sheets!");
        return true;
    } catch (err) {
        console.log("❌ Google Sheets ERROR:", err);
        return false;
    }
}

// ===============================
// Discord Listener (Auto Capture)
// ===============================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    console.log("[LogTime] Listener attached to channel:", LOG_CHANNEL);

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        if (message.author.bot) return;

        console.log("📥 Incoming Log Message:", message.content);

        // ===============================
        // Extract Name
        // ===============================
        const nameLine = message.content.match(/รายงานเข้าเวรของ\s*-\s*(.+)/);

        // ===============================
        // Extract Time 00:00:00
        // ===============================
        const timeLine = message.content.match(/(\d{2}:\d{2}:\d{2})/);

        if (!nameLine || !timeLine) {
            console.log("⛔ Pattern not matched. Log format incorrect.");
            return;
        }

        const name = nameLine[1].trim();
        const time = timeLine[1].trim();

        console.log("📥 Parsed →", name, time);

        await saveLog(name, time);
    });
}

module.exports = { saveLog, initializeLogListener };
