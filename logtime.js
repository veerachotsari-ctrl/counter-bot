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
// Google Sheets Client
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

    return new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
}

// ===============================
// Save to Google Sheet
// ===============================
async function saveLog(name, date, time) {
    console.log(`📝 saveLog() → ${name}, ${date}, ${time}`);

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
            range: `${sheetName}!B2`,  // เริ่ม B2 (B-C-D)
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, date, time]] },
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

        // ชื่อ (ตรงตามรูป)
        const nameMatch = message.content.match(/ชื่อ\s*\n(.+)/);

        // เวลาออกงาน (ตรงตามรูป)
        const outMatch = message.content.match(/เวลาออกงาน\s*\n(.+)/);

        if (!nameMatch || !outMatch) {
            console.log("⛔ Pattern not matched. Log format incorrect.");
            return;
        }

        const name = nameMatch[1].trim();

        // ข้อมูลเวลาออกงาน เช่น:
        // พฤหัสบดี - 04/12/2025 23:28:20
        let rawOut = outMatch[1].trim();

        // ลบชื่อวันไทย เช่น "พฤหัสบดี - "
        rawOut = rawOut.replace(/^[ก-ฮ]+ -\s*/, "").trim();

        const [date, time] = rawOut.split(" ");

        console.log("📥 Parsed →", name, date, time);

        await saveLog(name, date, time);
    });
}

module.exports = { saveLog, initializeLogListener };
