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
// ค้นหาแถวแบบ SMART (ปรับปรุงประสิทธิภาพ: รวมการอ่าน API)
//
// ลดการเรียก API get จาก 2 ครั้ง เหลือ 1 ครั้ง
// ========================================================================
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {

    // ------------------------------------
    // ----- รวมการอ่าน B และ C ในครั้งเดียว (B3:C) -----
    // ------------------------------------
    const range = `${sheetName}!B3:C`;
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: range
    });
    
    const rowData = resp.data.values || []; // rowData = [[B3, C3], [B4, C4], ...]
    const lowerCaseName = name.trim().toLowerCase();

    // ------------------------------------
    // ----- STEP 1: หาใน B (B3:B) -----
    // ------------------------------------
    // row[0] คือคอลัมน์ B
    let rowIndex = rowData.findIndex(row => 
        row[0] && row[0].toLowerCase().includes(lowerCaseName)
    );

    if (rowIndex !== -1) {
        // พบชื่อใน B → ส่งคืนหมายเลขแถว
        return rowIndex + 3;
    }


    // ------------------------------------
    // ----- STEP 2: หาใน C (C3:C) -----
    // ------------------------------------
    // row[1] คือคอลัมน์ C
    rowIndex = rowData.findIndex(row => 
        row[1] && row[1].trim().toLowerCase() === lowerCaseName
    );

    if (rowIndex !== -1) {
        // พบชื่อใน C → ส่งคืนหมายเลขแถว
        return rowIndex + 3;
    }


    // ------------------------------------
    // ----- STEP 3: หาแถวว่างใน B และ C -----
    // ------------------------------------
    const emptyRowIndex = rowData.findIndex(row => {
        // row[0] คือ B, row[1] คือ C
        const bIsEmpty = !row[0] || row[0].trim() === "";
        const cIsEmpty = !row[1] || row[1].trim() === "";
        
        // ใช้แถวนี้ได้เมื่อ B และ C ว่างพร้อมกัน
        return bIsEmpty && cIsEmpty;
    });

    if (emptyRowIndex !== -1) {
        // พบแถวว่างที่ B และ C ว่าง → ส่งคืนหมายเลขแถว
        return emptyRowIndex + 3;
    }


    // ------------------------------------
    // ----- STEP 4: ถ้าไม่มีแถวว่าง → append แถวใหม่ -----
    // ------------------------------------
    return rowData.length + 3;
}


// ========================================================================
// SAVE OR UPDATE LOG (แก้ไข: รับ 'id' และเพิ่มบันทึกใน G)
// ========================================================================
async function saveLog(name, date, time, id) {
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // ประสิทธิภาพดีขึ้นเพราะ findRowSmart เรียก API น้อยลง
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
    
    // บันทึก ID ลงใน G
    if (id) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!G${row}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[id]] },
        });
    }

    console.log(`✔ Saved @ Row ${row} →`, name, date, time, id ? `[ID: ${id}]` : '');
}


// ========================================================================
// EXTRACT MINIMAL (แก้ไข: เพิ่มการดึง ID)
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

    // 3) ID (เพิ่มส่วนนี้)
    const idMatch = text.match(/(steam:\w+)/i);
    const id = idMatch ? idMatch[1] : null;

    return { name, date, time, id };
}


// ========================================================================
// DISCORD LOG LISTENER (แก้ไข: รับ 'id' และส่งต่อไปยัง saveLog)
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
        const { name, date, time, id } = extractMinimal(text);

        if (!name) return console.log("❌ NAME NOT FOUND");
        if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");

        console.log("🟩 NAME:", name);
        console.log("🟩 TIME:", date, time);
        if (id) console.log("🟩 ID:", id); // แสดง ID ใน Log

        // Save → Sheets
        await saveLog(name, date, time, id);

        console.log("✔ DONE");
    });
}


module.exports = { initializeLogListener };
