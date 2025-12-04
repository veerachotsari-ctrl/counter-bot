const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// ========================================================================
// 1) DEBUG — เช็คว่า ENV ของ GOOGLE SERVICE ACCOUNT ถูกต้องไหม
// ========================================================================
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

// ========================================================================
// 2) Google Sheets Client
// ========================================================================
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

// ========================================================================
// 3) Save Log to Google Sheets (B = name, C = date, D = time)
// ========================================================================
async function saveLog(name, date, time) {
    console.log(`📝 saveLog() → NAME:${name} | DATE:${date} | TIME:${time}`);

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
            range: `${sheetName}!B2`, // บันทึกลง B–C–D
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name, date, time]] },
        });

        console.log("📌 Append Result:", JSON.stringify(res.data));
        return true;
    } catch (err) {
        console.log("❌ Google Sheets ERROR:", err);
        return false;
    }
}

// ========================================================================
// 4) Discord Listener — ดึง embed + ดึงข้อความแล้วแปลงเป็น string
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";
    console.log("[LogTime] Listener attached to channel:", LOG_CHANNEL);

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        if (message.author.bot) return;

        console.log("\n===================================================");
        console.log("📥 NEW LOG MESSAGE RECEIVED");
        console.log("===================================================");

        // --------------------------------------------------------
        // 1) รวมข้อความจาก discord embed / message content
        // --------------------------------------------------------
        let text = message.content || "";

        if (message.embeds.length > 0) {
            console.log("🟦 Processing EMBED");

            for (const embed of message.embeds) {
                if (embed.title) text += embed.title + "\n";
                if (embed.description) text += embed.description + "\n";

                if (embed.fields) {
                    for (const f of embed.fields) {
                        text += `${f.name}\n${f.value}\n`;
                    }
                }
            }
        }

        console.log("📜 RAW PARSED TEXT:\n" + text);

        // --------------------------------------------------------
        // 2) Extract Name
        // --------------------------------------------------------
        const nameMatch = text.match(/ชื่อ\s*\n(.+)/);
        if (!nameMatch) {
            console.log("❌ No NAME found");
            return;
        }
        const name = nameMatch[1].trim();
        console.log("🟩 NAME:", name);

        // --------------------------------------------------------
        // 3) Extract "เวลาออกงาน"
        // --------------------------------------------------------
        const outMatch = text.match(/เวลาออกงาน\s*\n(.+)/);
        if (!outMatch) {
            console.log("❌ No OUT TIME found");
            return;
        }

        let rawOut = outMatch[1].trim();
        console.log("🟧 RAW OUT:", rawOut);

        // Example rawOut:
        // พฤหัสบดี - 04/12/2025 23:37:18
        rawOut = rawOut.replace(/^[ก-ฮ]+ -\s*/, "").trim(); // remove day

        console.log("🟦 CLEAN OUT:", rawOut);

        const [date, time] = rawOut.split(" ");

        if (!date || !time) {
            console.log("❌ Cannot split date/time");
            return;
        }

        console.log("🟩 DATE:", date);
        console.log("🟩 TIME:", time);

        // --------------------------------------------------------
        // 4) Save to Sheets
        // --------------------------------------------------------
        await saveLog(name, date, time);

        console.log("✔ FINISHED SAVING TO GOOGLE SHEETS");
        console.log("===================================================");
    });
}

// ========================================================================
// EXPORT MODULE
// ========================================================================
module.exports = { saveLog, initializeLogListener };
