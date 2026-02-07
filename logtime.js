const { google } = require("googleapis");

// ตั้งค่า Google Sheets (ใช้ค่าจาก .env)
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = "LogTime"; // เปลี่ยนให้ตรงกับชื่อ Sheet ของคุณ

// -----------------------------
// saveLog (สำหรับคำสั่ง /ออกเวร)
// -----------------------------
async function saveLog(name, date, time, id) {
    try {
        const { row } = await findRowSmart(sheets, SPREADSHEET_ID, SHEET_NAME, name);
        // เลือกบันทึกลงคอลัมน์ที่ต้องการ (ตัวอย่างคือบันทึกทับในแถวที่เจอ)
        // คุณสามารถปรับแก้ Range [!A${row}] ตามโครงสร้าง Sheet ของคุณ
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!D${row}:F${row}`, // บันทึกวันที่ เวลา ID ลงคอลัมน์ D, E, F
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[date || "ไมระบุ", time, id || "N/A"]] },
        });
        return true;
    } catch (err) {
        console.error("❌ saveLog Error:", err);
        return false;
    }
}

// -----------------------------
// SMART row finder
// -----------------------------
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rowData = resp.data.values || [];
    const lowerCaseName = (name || "").trim().toLowerCase();

    // ค้นจากคอลัมน์ B
    let rowIndexB = rowData.findIndex((r, idx) =>
        idx >= 1 && r[0] && r[0].toLowerCase().includes(lowerCaseName)
    );
    if (rowIndexB !== -1) return { row: rowIndexB + 1, isNew: false };

    // ค้นจากคอลัมน์ C
    let rowIndexC = rowData.findIndex((r, idx) =>
        idx >= 1 && r[1] && r[1].trim().toLowerCase() === lowerCaseName
    );
    if (rowIndexC !== -1) return { row: rowIndexC + 1, isNew: false };

    const START_ROW = 200;
    let targetRow = START_ROW;
    for (let i = START_ROW - 1; i < Math.max(rowData.length, START_ROW); i++) {
        const row = rowData[i];
        if (!row || (!row[0] && !row[1])) {
            targetRow = i + 1;
            break;
        }
        if (i === rowData.length - 1) targetRow = rowData.length + 1;
    }
    return { row: targetRow, isNew: true };
}

// -----------------------------
// Extract Info (Regex)
// -----------------------------
function extractMinimal(text) {
    text = text.replace(/[`*]/g, "").replace(/\u200B/g, "");
    const n = text.match(/รายงานเข้าเวรของ\s*[:\-–—]?\s*(.+)/i);
    const name = n ? n[1].trim() : null;
    const out = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const date = out ? out[1] : null;
    const time = out ? out[2] : null;
    const idMatch = text.match(/steam:(\w+)/i);
    const id = idMatch ? idMatch[0] : null;
    return { name, date, time, id };
}

// -----------------------------
// Handle Log (ประมวลผลข้อความ)
// -----------------------------
async function handleLog(message) {
    const info = extractMinimal(message.content);
    if (!info.name) return; // ถ้าดึงชื่อไม่ได้ ไม่ต้องทำต่อ

    console.log(`📝 กำลังบันทึก Log ของ: ${info.name}`);
    const success = await saveLog(info.name, info.date, info.time, info.id);
    if (success) {
        await message.react("✅");
    } else {
        await message.react("❌");
    }
}

// -----------------------------
// Discord listener
// -----------------------------
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", message => {
        // ถ้าข้อความมาจากบอทตัวอื่น (เช่น Webhook รายงานเข้าเวร) ให้เอาบรรทัดข้างล่างออก
        // if (message.author.bot) return; 

        if (message.channel.id !== LOG_CHANNEL) return;

        process.nextTick(() => {
            handleLog(message).catch(err => console.error("❌ handleLog error:", err));
        });
    });
}

// ==========================================
// 🚀 หัวใจสำคัญ: ส่งออกฟังก์ชันไปให้ index.js ใช้
// ==========================================
module.exports = { 
    saveLog, 
    initializeLogListener 
};
