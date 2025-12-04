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

async function saveLog(name, date, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!B2`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[name, date, time]] },
    });

    console.log("✔ Saved to Google Sheets:", name, date, time);
}

// ========================================================================
// Discord Log Listener (รองรับ embeds รุ่นใหม่เต็มรูปแบบ)
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";
    
    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        if (message.author.bot) return;

        console.log("\n📥 NEW MESSAGE");
        
        let text = "";

        // ----------------------------------------------------------
        // ดึง EMBED แบบ discord.js v14
        // ----------------------------------------------------------
        for (const embed of message.embeds) {

            // title & description
            if (embed.data.title) text += embed.data.title + "\n";
            if (embed.data.description) text += embed.data.description + "\n";

            // fields
            if (embed.data.fields) {
                for (const f of embed.data.fields) {
                    text += `${f.name}\n${f.value}\n`;
                }
            }
        }

        console.log("📜 PARSED TEXT:\n" + text);

        // ==========================================================
        // 1) ดึงชื่อ
        // ==========================================================
        const nameMatch = text.match(/ชื่อ\s*\n(.+)/);
        if (!nameMatch) {
            console.log("❌ ชื่อ ไม่พบใน embed");
            return;
        }

        const name = nameMatch[1].trim();
        console.log("🟩 NAME:", name);

        // ==========================================================
        // 2) ดึงเวลาออกงาน
        // ==========================================================
        const outMatch = text.match(/เวลาออกงาน\s*\n(.+)/);
        if (!outMatch) {
            console.log("❌ เวลาออกงาน ไม่พบ");
            return;
        }

        let rawOut = outMatch[1].trim();
        console.log("🟧 RAW OUT:", rawOut);

        // เอาวันออก เช่น “ศุกร์ - 05/12/2025 00:00:58”
        // ตัดส่วน “ศุกร์ - ”
        rawOut = rawOut.replace(/^.*?[–—-]\s*/, "").trim();

        const [date, time] = rawOut.split(" ");

        if (!date || !time) {
            console.log("❌ ดึง date/time ไม่ได้");
            return;
        }

        console.log("🟩 DATE:", date);
        console.log("🟩 TIME:", time);

        await saveLog(name, date, time);
    });
}

module.exports = { saveLog, initializeLogListener };
