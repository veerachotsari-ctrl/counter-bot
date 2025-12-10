// logtime.js

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
// ค้นหาแถวแบบ SMART:
//
// 1) หาใน B (B3:B)
// 2) ไม่เจอ → หาใน C (C3:C)
// 3) ไม่เจอ → หาแถวว่างใน B (แต่เขียนเฉพาะ C/D/E เท่านั้น)
// 4) ถ้า B ไม่มีแถวว่าง → append แถวใหม่ (เขียน C/D/E เท่านั้น)
//
// ❗ ห้ามแตะ B เด็ดขาด
// ========================================================================
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {

    // ----- STEP 1: หาใน B -----
    const respB = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!B3:B`
    });
    const rowsB = respB.data.values || [];

    const rowIndexB = rowsB.findIndex(row =>
        row[0] && row[0].toLowerCase().includes(name.toLowerCase())
    );

    if (rowIndexB !== -1) {
        return rowIndexB + 3;
    }


    // ----- STEP 2: หาใน C -----
    const respC = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!C3:C`
    });
    const rowsC = respC.data.values || [];

    const rowIndexC = rowsC.findIndex(row =>
        row[0] &&
        row[0].trim().toLowerCase() === name.trim().toLowerCase()
    );

    if (rowIndexC !== -1) {
        return rowIndexC + 3;
    }


    // ----- STEP 3: หาแถวว่างใน B -----
    const emptyRowInB = rowsB.findIndex(row =>
        !row[0] || row[0].trim() === ""
    );

    if (emptyRowInB !== -1) {
        return emptyRowInB + 3;
    }


    // ----- STEP 4: ถ้าไม่มีแถวว่าง → append -----
    return rowsB.length + 3;
}



// ========================================================================
// SAVE OR UPDATE LOG
// ========================================================================
async function saveLog(name, date, time) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    const row = await findRowSmart(sheets, spreadsheetId, sheetName, name);

    // อ่านค่าช่อง C เพื่อตรวจว่ามีชื่ออยู่แล้วหรือยัง
    const checkC = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!C${row}`
    });
    const existsC = checkC.data.values && checkC.data.values[0];


    // ถ้า C ยังไม่มีชื่อ → ใส่ชื่อใหม่ลง C
    if (!existsC) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!C${row}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name]] },
        });
    }

    // อัปเดตวันที่/เวลา D + E
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!D${row}:E${row}`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[date, time]] },
    });

    console.log(`✔ Saved @ Row ${row} →`, name, date, time);
}



// ========================================================================
// EXTRACT MINIMAL (ชื่อ + วัน + เวลา)
// ========================================================================
function extractMinimal(text) {
    text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

    // 1) NAME
    const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    // 2) DATE + TIME (หลังคำว่าเวลาออกงาน)
    const out = text.match(
        /เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i
    );

    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    return { name, date, time };
}



// ========================================================================
// DISCORD LOG LISTENER
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE IN LOG CHANNEL");

        let text = "";

        // message content
        if (message.content) text += message.content + "\n";

        // embeds
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

        // Extract
        const { name, date, time } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 TIME:", date, time);

        // Save → Sheets
        await saveLog(name, date, time);

        console.log("✔ DONE");
    });
}


module.exports = { initializeLogListener };
