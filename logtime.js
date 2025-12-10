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


// ========================================================================
// 🔍 ค้นหาแถวจากช่อง B (ชื่อเต็ม)
// ========================================================================
async function findRowByFullName(sheets, spreadsheetId, sheetName, fullName) {
    const range = `${sheetName}!B3:B`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values || [];

    const index = rows.findIndex(row =>
        row[0] && row[0].trim().toLowerCase() === fullName.trim().toLowerCase()
    );

    return index === -1 ? null : index + 3;
}


// ========================================================================
// 🔍 ค้นหาแถวจากช่อง C (ชื่อย่อที่บอทดึงมา)
// ========================================================================
async function findRowByShortName(sheets, spreadsheetId, sheetName, shortName) {
    const range = `${sheetName}!C3:C`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values || [];

    const index = rows.findIndex(row =>
        row[0] && row[0].trim().toLowerCase() === shortName.trim().toLowerCase()
    );

    return index === -1 ? null : index + 3;
}


// ========================================================================
// Save or Update
// ========================================================================
async function saveLog(shortName, date, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // เตรียมชื่อเต็มจากข้อความ log
    // เช่น "Baigapow Mookrob" หาใน B ที่มีชื่อ "00 [FTPD] Baigapow MooKrob"
    const fullNameRegex = new RegExp(shortName.replace(/\s+/g, ".*"), "i");

    // อ่านช่อง B ทั้งหมด
    const colB = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!B3:B`
    });

    const rowsB = colB.data.values || [];

    let rowInB = null;

    for (let i = 0; i < rowsB.length; i++) {
        if (rowsB[i][0] && fullNameRegex.test(rowsB[i][0])) {
            rowInB = i + 3;
            break;
        }
    }


    // 1️⃣ ถ้าพบในช่อง B → อัปเดตช่อง C, D, E
    if (rowInB) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!C${rowInB}:E${rowInB}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[shortName, date, time]] },
        });

        console.log(`🔄 Updated via B → Row ${rowInB} | ${shortName}`);
        return;
    }


    // 2️⃣ ถ้าไม่เจอใน B → หาช่อง C
    const rowInC = await findRowByShortName(sheets, spreadsheetId, sheetName, shortName);

    if (rowInC) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!D${rowInC}:E${rowInC}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[date, time]] },
        });

        console.log(`🔄 Updated via C → Row ${rowInC}`);
        return;
    }


    // 3️⃣ ไม่เจอทั้ง B และ C → เพิ่มเฉพาะ C, D, E
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!C3`,
        valueInputOption: "USER_INPUT",
        resource: { values: [[shortName, date, time]] },
    });

    console.log("➕ Added new row →", shortName, date, time);
}



// ========================================================================
// PARSER
// ========================================================================
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    const out = text.match(
        /เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i
    );

    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    return { name, date, time };
}



// ========================================================================
// DISCORD Listener
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE");

        let text = "";

        if (message.content) text += message.content + "\n";

        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;

                if (e.title) text += e.title + "\n";
                if (e.description) text += e.description + "\n";

                if (e.fields) {
                    for (const f of e.fields) {
                        if (!f) continue;
                        text += `${f.name}\n${f.value}\n`;
                    }
                }
            }
        }

        const { name, date, time } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 Date/Time:", date, time);

        await saveLog(name, date, time);

        console.log("✔ DONE");
    });
}

module.exports = { initializeLogListener };
