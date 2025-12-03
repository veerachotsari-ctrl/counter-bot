// DutyLogger.js (ฉบับแก้ไขที่ถูกต้อง: เพิ่ม .replace() กลับเข้าไป)
require("dotenv").config();
const { google } = require("googleapis");
const { JWT } = require("google-auth-library"); // เพิ่มการเรียกใช้ JWT ถ้าจำเป็น

const DUTY_LOG_CHANNEL_ID = "1445640443986710548";
const SPREADSHEET_ID = "1QnXWv7QIh4QdaeNcMR6sybUMt9Sd3vzmU6Id6Fz8UiQ"; 
const SHEET_NAME = "DutyLogger";
const NAMES_RANGE = `${SHEET_NAME}!B3:B`; 

/**
 * ฟังก์ชันช่วยแปลงสตริงวันที่จาก Embed (DD/MM/YYYY) ให้เป็น Date Object ที่ถูกต้อง
 * ใช้ Regular Expression เพื่อความแม่นยำสูง
 */
function parseDateFromEmbed(rawDateString) {
    const regex = /(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}:\d{2}:\d{2})/;
    
    const cleaned = rawDateString.replace(/^\S+\s-\s/, "").trim();
    
    const match = cleaned.match(regex);
    
    if (!match) {
        throw new Error(`Date string format mismatch: ${rawDateString}`);
    }
    
    const [, day, month, year, timePart] = match;
    
    const isoString = `${year}-${month}-${day} ${timePart}`;
    
    return new Date(isoString);
}


module.exports.initializeDutyLogger = function (client) {

    client.on("messageCreate", async (msg) => {

        if (msg.channelId !== DUTY_LOG_CHANNEL_ID) return;
        if (!msg.embeds.length) return;

        const embed = msg.embeds[0];

        if (!embed.title?.includes("รายงานเข้าเวร")) return;

        try {
            const name = embed.fields.find(f => f.name === "ชื่อ")?.value || "-";

            const startField = embed.fields.find(f => f.name === "เวลาเข้างาน");
            const endField   = embed.fields.find(f => f.name === "เวลาออกงาน");

            if (!startField || !endField || !startField.value || !endField.value) {
                console.warn(`⚠ ข้อมูลเวลาไม่ครบถ้วนในข้อความของ ${name}`);
                return;
            }
            
            const startRaw = startField.value;
            const endRaw   = endField.value;
            
            // ใช้ฟังก์ชันแปลงเวลา
            const start = parseDateFromEmbed(startRaw);
            const end   = parseDateFromEmbed(endRaw);
            
            // ตรวจสอบความถูกต้องอีกครั้งหลังแปลง
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.error(`❌ ไม่สามารถแปลงเวลาเป็น Date ได้: Start=${startRaw}, End=${endRaw}`);
                return;
            }

            const diffMs = end - start;
            const hours = diffMs / (1000 * 60 * 60);

            const weekdays = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
            const dayName = weekdays[start.getDay()];
            
            await logDutyHours(name, dayName, parseFloat(hours.toFixed(2))); 

            console.log(`✔ ลงข้อมูล: ${name} | ${dayName} | ${hours.toFixed(2)} ชม.`);

        } catch (err) {
            console.error("❌ DutyLogger error:", err);
        }
    });
};

// ====================== GOOGLE SHEET LOGIC ======================

function getDayColumn(dayName) {
    switch (dayName) {
        case "จันทร์": return "C";
        case "อังคาร": return "D";
        case "พุธ": return "E";
        case "พฤหัสบดี": return "F";
        case "ศุกร์": return "G";
        case "เสาร์": return "H";
        case "อาทิตย์": return "I";
        default: return null;
    }
}

async function logDutyHours(name, dayName, hours) {
    // ⭐⭐⭐ ต้องใช้ .replace() เพื่อจัดการกับ \\n ที่มาจาก Render ⭐⭐⭐
    const auth = new google.auth.JWT({
        email: process.env.CLIENT_EMAIL,
        key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    
    const sheets = google.sheets({ version: "v4", auth });
    
    const targetColumn = getDayColumn(dayName);
    if (!targetColumn) {
        throw new Error(`Invalid day name: ${dayName}`);
    }
    
    let rowNum = -1;

    let namesResponse;
    try {
        namesResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: NAMES_RANGE,
        });
    } catch (e) {
        // หากเกิดข้อผิดพลาดในการเรียก API (เช่น 401), ให้แสดง error และใช้ค่าเริ่มต้น
        console.error("Error reading names from sheet. Check authentication and sharing permissions.", e.message);
        namesResponse = { data: { values: [] } };
    }

    const nameRows = namesResponse.data.values || [];
    const nameIndex = nameRows.findIndex(row => row[0] === name);
    
    if (nameIndex !== -1) {
        rowNum = nameIndex + 3; 
    } else {
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!B3`, 
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name]] } 
        });

        const updatedRange = appendResponse.data.updates.updatedRange; 
        rowNum = parseInt(updatedRange.match(/\d+$/)[0]); 
        
        const totalFormula = `=SUM(C${rowNum}:I${rowNum})`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!J${rowNum}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[totalFormula]] }
        });
    }

    const targetRange = `${SHEET_NAME}!${targetColumn}${rowNum}`;
    
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: targetRange,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[hours]] }
    });
}
