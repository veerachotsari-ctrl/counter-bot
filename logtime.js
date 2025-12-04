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
// Discord Log Listener (รองรับ embeds v14 ทั้งหมด)
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE");

        // =========================================================================
        // 1) รวมข้อความจาก content + embed (เวอร์ชัน robust เต็ม)
        // =========================================================================
        let text = message.content ? message.content + "\n" : "";

        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;

                if (e.title) text += e.title + "\n";
                if (e.description) text += e.description + "\n";

                const fields = e.fields || [];
                for (const f of fields) {
                    if (!f) continue;
                    const name = f.name?.toString().trim() || "";
                    const value = f.value?.toString().trim() || "";
                    if (name || value) text += `${name}\n${value}\n`;
                }
            }
        }

        text = text
            .replace(/`/g, "")       // remove backticks
            .replace(/\*/g, "")     // remove bold/italic stars
            .replace(/\u200B/g, ""); // remove zero-width chars

        console.log("📜 PARSED TEXT:\n" + text);



        // =========================================================================
        // 2) Extract NAME
        // =========================================================================
        let name = null;

        // ผ่าน field "ชื่อ"
        const nameField = text.match(/(?:^|\n)ชื่อ\s*\n([\s\S]+?)(?:\n\S|$)/i);
        if (nameField) {
            name = nameField[1].trim();
        }

        // ผ่าน title: "รายงานเข้าเวรของ - NAME"
        if (!name) {
            const t = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+?)(?:\n|$)/i);
            if (t) name = t[1].trim();
        }

        if (!name) {
            console.log("❌ NAME not found.");
            return;
        }

        console.log("🟩 NAME:", name);



        // =========================================================================
        // 3) Extract Date + Time
        // =========================================================================
        let date = null, time = null;

        const dtRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/g;
        let match, last = null;

        while ((match = dtRegex.exec(text)) !== null) {
            last = match;
        }

        if (last) {
            date = last[1];
            time = last[2];
            console.log("🟩 DateTime (pattern):", date, time);
        } else {
            console.log("❌ No datetime matched.");
            const lastLines = text.split("\n").slice(-10).join("\n");
            console.log(lastLines);
            return;
        }


        // =========================================================================
        // Save to Sheet
        // =========================================================================
        await saveLog(name, date, time);
        console.log("✔ LOG COMPLETE:", name, date, time);

    });
}

module.exports = { initializeLogListener };
