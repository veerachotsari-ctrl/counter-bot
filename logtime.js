// LogTime.js (ฉบับรวม Google Sheets Client ในตัว)

const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// ===============================================
// 1. Google Sheets Client (จัดการการเชื่อมต่อและการตรวจสอบสิทธิ์)
// ===============================================

/**
 * สร้าง JWT client เพื่อตรวจสอบสิทธิ์กับ Google Sheets API
 * โดยใช้ตัวแปรสภาพแวดล้อม (Environment Variables) CLIENT_EMAIL และ PRIVATE_KEY
 */
function getSheetsAuthClient() {
    const credentials = {
        client_email: process.env.CLIENT_EMAIL,
        // แทนที่ \n ด้วย \n จริงใน Private Key
        private_key: process.env.PRIVATE_KEY 
            ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n")
            : null,
    };

    if (!credentials.client_email || !credentials.private_key) {
        console.error("❌ ERROR: Missing Google credentials (CLIENT_EMAIL or PRIVATE_KEY).");
        return null;
    }

    return new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
}


// ===============================================
// 2. Save Log to Google Sheets
// ===============================================

const SPREADSHEET_ID = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
const SHEET_RANGE = "logtime!A:F";

/**
 * บันทึกข้อมูลเข้า Google Sheets
 * บันทึก 6 คอลัมน์: A=ชื่อ, B=วันที่เข้า, C=เวลาเข้า, D=วันที่ออก, E=เวลาออก, F=ระยะเวลา
 */
async function saveLog(name, duration, timeIn, timeOut) {
    console.log(`📝 Attempting to save log → ${name}, Duration: ${duration}`);

    const auth = getSheetsAuthClient();
    if (!auth) return false;

    // 1. ตรวจสอบสิทธิ์
    try {
        await auth.authorize();
        console.log("✅ Google Auth Success");
    } catch (err) {
        console.error("❌ Google Auth FAILED:", err.message);
        return false;
    }

    const sheets = google.sheets({ version: "v4", auth });

    // 2. แยกวันที่และเวลา
    const [dateIn, timeInTime] = timeIn.split(" ");
    const [dateOut, timeOutTime] = timeOut.split(" ");

    const values = [[
        name,
        dateIn,
        timeInTime,
        dateOut,
        timeOutTime,
        duration
    ]];

    // 3. บันทึกข้อมูล
    try {
        const res = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_RANGE, 
            valueInputOption: "RAW",
            requestBody: { values }
        });

        console.log("✔ Saved to Google Sheets! Rows updated:", res.data.updates.updatedRows);
        return true;
    } catch (err) {
        console.error("❌ Google Sheets APPEND ERROR:", err.message || JSON.stringify(err));
        return false;
    }
}


// ===============================================
// 3. Discord Listener (Export Module)
// ===============================================

/**
 * ฟังก์ชันหลักที่ส่งออกไปเพื่อตั้งค่า Discord Listener
 * @param {Client} client Discord Client object
 */
module.exports = (client) => {
    const channelId = "1445640443986710548";
    
    console.log(`[LogTime] Listener initialized for channel: ${channelId}`);

    client.on("messageCreate", async (message) => {
        // 1. กรองข้อความ
        if (message.channel.id !== channelId) return;
        if (!message.embeds.length) return;
        if (message.author.bot) return;

        const embed = message.embeds[0];

        let name = "";
        let timeIn = "";
        let timeOut = "";
        let duration = "";

        // 2. ดึงข้อมูลจาก Embed
        embed.fields.forEach(f => {
            const label = f.name.trim();
            const value = f.value.trim();

            if (label === "ชื่อ") name = value;
            if (label === "เวลาทำงาน") timeIn = value;
            if (label === "เวลาออกงาน") timeOut = value;
            if (label === "ระยะเวลาที่เข้าเวร") duration = value;
        });

        if (!name || !timeIn || !timeOut || !duration) {
            console.log("❌ Missing fields. Skip.");
            return;
        }

        // 3. ฟังก์ชันทำความสะอาดข้อความ (ตัดส่วนที่เป็นวันไทยทิ้ง)
        // เช่น "พฤหัสบดี - 04/12/2025 22:46:43"
        const clean = (text) => {
            const parts = text.split("-");
            return parts.length > 1 ? parts[1].trim() : text.trim();
        };

        const timeInClean = clean(timeIn);
        const timeOutClean = clean(timeOut);
        
        console.log(`📌 Parsed → Name: ${name}, Duration: ${duration}, TimeIn: ${timeInClean}, TimeOut: ${timeOutClean}`);

        // 4. เรียกฟังก์ชันบันทึก
        await saveLog(name, duration, timeInClean, timeOutClean);
    });
};
