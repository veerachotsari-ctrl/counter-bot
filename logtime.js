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
        console.log("CLIENT_EMAIL:", process.env.CLIENT_EMAIL);
        console.log("PRIVATE_KEY:", privateKey ? "Loaded" : "Missing");
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
// Discord Log Listener (UPGRADED PRODUCTION VERSION)
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    // ป้องกันข้อความซ้ำภายในช่วงสั้น ๆ
    let lastMessageHash = "";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;
        if (!message.embeds?.length) return;  // ต้องมี embed
        if (message.author.bot) return;       // ข้ามบอท

        console.log("\n📥 NEW MESSAGE");

        // =========================================================================
        // 1) Extract all text content from embed
        // =========================================================================
        let buffer = [];

        if (message.content) buffer.push(message.content);

        for (const embed of message.embeds) {
            const e = embed.data ?? embed;

            if (e.title) buffer.push(e.title);
            if (e.description) buffer.push(e.description);

            const fields = e.fields || [];
            for (const f of fields) {
                if (!f) continue;
                if (f.name) buffer.push(f.name);
                if (f.value) buffer.push(f.value);
            }
        }

        // รวมเป็นข้อความเดียว
        let text = buffer.join("\n")
            .replace(/`/g, "")
            .replace(/\*/g, "")
            .replace(/\u200B/g, "")
            .trim();

        console.log("📜 PARSED TEXT:\n" + text);


        // =========================================================================
        // 1.1 Anti-Duplicate System (SHA Hash)
        // =========================================================================
        const currentHash = require("crypto")
            .createHash("sha1")
            .update(text)
            .digest("hex");

        if (currentHash === lastMessageHash) {
            console.log("⚠️ Duplicate message ignored.");
            return;
        }
        lastMessageHash = currentHash;


        // =========================================================================
        // 2) Extract NAME
        // =========================================================================
        let name = null;

        const nameField = text.match(/(?:^|\n)ชื่อ\s*\n([\s\S]+?)(?:\n\S|$)/i);
        if (nameField) name = nameField[1].trim();

        if (!name) {
            const titleMatch = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+?)(?:\n|$)/i);
            if (titleMatch) name = titleMatch[1].trim();
        }

        if (!name) {
            console.log("❌ NAME not found.");
            return;
        }

        console.log("🟩 NAME:", name);


        // =========================================================================
        // 3) Extract DATE + TIME
        // =========================================================================
        let date = null, time = null;

        const dtRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/g;

        let m, last = null;
        while ((m = dtRegex.exec(text)) !== null) last = m;

        if (last) {
            date = last[1];
            time = last[2];
            console.log("🟩 DATE+TIME:", date, time);
        } else {
            console.log("❌ datetime not found.");
            console.log(text.split("\n").slice(-8).join("\n"));
            return;
        }


        // =========================================================================
        // 4) Save to Sheet
        // =========================================================================
        await saveLog(name, date, time);
        console.log("✔ LOG COMPLETE:", name, date, time);
    });
}

module.exports = { initializeLogListener };
