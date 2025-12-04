// logtime.js
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// ===============================
// DEBUG
// ===============================
console.log("🔍 DEBUG CHECK");
console.log("CLIENT_EMAIL:", process.env.CLIENT_EMAIL || "(missing)");
console.log(
    "PRIVATE_KEY length:",
    process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.length : "(missing)"
);
console.log(
    "PRIVATE_KEY first 30 chars:",
    process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.substring(0, 30) : "(missing)"
);

// ===============================
// Create Google Sheets Client (เหมือน CountCase.js)
// ===============================
function getSheetsClient() {
    const credentials = {
        client_email: process.env.CLIENT_EMAIL,
        private_key: process.env.PRIVATE_KEY
            ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n")
            : null,
    };

    if (!credentials.client_email || !credentials.private_key) {
        console.log("❌ Missing Google credentials");
        return null;
    }

    console.log("🔑 PRIVATE_KEY sanitized. New length:", credentials.private_key.length);

    return new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
}

// ===============================
// Append To Google Sheet
// ===============================
async function saveLog(name, time) {
    console.log(`📝 saveLog() → ${name}, ${time}`);

    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return false;

    try {
        await auth.authorize();
        console.log("✅ Google Auth Success");
    } catch (err) {
        console.log("❌ Google Auth FAILED:", err.message);
        return false;
    }

    const sheets = google.sheets({ version: "v4", auth });

    try {
        const res = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A2`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, time]] },
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
// Discord Listener
// ===============================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    console.log("[LogTime] Listener attached to channel:", LOG_CHANNEL);

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        if (message.author.bot) return;

        console.log("📥 Incoming Log Message:", message.content);

        const nameLine = message.content.match(/รายงานเข้าเวรของ\s*-\s*(.+)/);
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
