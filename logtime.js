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

    
    // ======= Robust listener (replace your existing messageCreate handler) =======
client.on("messageCreate", async message => {
    if (message.channel.id !== LOG_CHANNEL) return;
    if (message.author.bot) return;

    console.log("\n📥 NEW MESSAGE");
    // build text from embed (support discord.js v14 embed.data and older embed.fields)
    let text = message.content || "";

    if (message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            // v14: embed.data, older: embed.title/fields directly
            const e = embed.data ? embed.data : embed;
            if (e.title) text += e.title + "\n";
            if (e.description) text += e.description + "\n";
            const fields = e.fields || e.fields; // already normalized
            if (fields && fields.length) {
                for (const f of fields) {
                    // some fields might be objects or arrays; handle gracefully
                    const name = f.name || f[0] || "";
                    const value = f.value || f[1] || "";
                    text += `${name}\n${value}\n`;
                }
            }
        }
    }

    console.log("📜 PARSED TEXT:\n" + text);

    // --------- 1) Extract NAME robustly ----------
    // prefer field under "ชื่อ", else try "รายงานเข้าเวรของ - <Name>" in title
    let name = null;
    const nameField = text.match(/(?:^|\n)ชื่อ\s*\n(.+?)(?:\n|$)/i);
    if (nameField) {
        name = nameField[1].trim();
    } else {
        // try title style: "รายงานเข้าเวรของ - <Name>"
        const titleMatch = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+?)(?:\n|$)/i);
        if (titleMatch) name = titleMatch[1].trim();
    }

    if (!name) {
        console.log("❌ Could not extract NAME (no 'ชื่อ' field nor title).");
        // optional: try first non-empty line as fallback
        const firstLine = text.split("\n").map(s=>s.trim()).find(s=>s.length>0);
        if (firstLine) {
            console.log("ℹ️ Fallback: using first non-empty line as name:", firstLine);
            name = firstLine;
        } else return;
    }
    console.log("🟩 NAME:", name);

    // --------- 2) Extract DATE+TIME robustly ----------
    // 1) try to find DD/MM/YYYY HH:MM:SS (choose last match if multiple)
    const dtRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/g;
    let match, lastMatch = null;
    while ((match = dtRegex.exec(text)) !== null) {
        lastMatch = match; // keep last occurrence
    }

    let date = null, time = null;
    if (lastMatch) {
        date = lastMatch[1];
        time = lastMatch[2];
        console.log("🟩 Found DATE+TIME (by pattern):", date, time);
    } else {
        // 2) fallback: find line after "เวลาออกงาน" (and strip day + dash)
        const outMatch = text.match(/เวลาออกงาน\s*\n(.+)/i);
        if (outMatch) {
            let rawOut = outMatch[1].trim();
            // remove everything up to a dash (hyphen/en-dash/em-dash) — robust to emoji/etc.
            rawOut = rawOut.replace(/^.*?[–—-]\s*/, "").trim();
            // now try extract date+time from rawOut
            const m = rawOut.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
            if (m) {
                date = m[1]; time = m[2];
                console.log("🟩 Found DATE+TIME (from outMatch):", date, time);
            } else {
                // maybe rawOut is only datetime without slash format, try other patterns:
                const alt = rawOut.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
                if (alt) {
                    date = alt[1]; time = alt[2];
                    console.log("🟩 Found DATE+TIME (alt ISO):", date, time);
                }
            }
        }
    }

    if (!date || !time) {
        console.log("❌ Could not extract date/time. Showing hints:");
        // print small helpful snippets for debugging
        const lines = text.split("\n").slice(-8).join("\n");
        console.log("Last 8 lines of parsed text:\n", lines);
        return;
    }

    // --------- 3) Save to sheet ----------
    await saveLog(name, date, time);
    console.log("✔ Saved:", name, date, time);
});
