// DutyLogger.js (แก้ไขการ Parse วันที่ด้วย RegEx)
require("dotenv").config();
const { google } = require("googleapis");

const DUTY_LOG_CHANNEL_ID = "1445640443986710548";
const SPREADSHEET_ID = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
const SHEET_NAME = "DutyLogger";
const NAMES_RANGE = `${SHEET_NAME}!B3:B`; 

/**
 * ฟังก์ชันช่วยแปลงสตริงวันที่จาก Embed (DD/MM/YYYY) ให้เป็น Date Object ที่ถูกต้อง
 * ใช้ Regular Expression เพื่อความแม่นยำสูง
 */
function parseDateFromEmbed(rawDateString) {
    // RegEx: ดึง (วัน)/(เดือน)/(ปี) เว้นวรรค (HH:mm:ss) จากสตริงที่สะอาดแล้ว
    // เช่น: "พุธ - 03/12/2025 17:20:04"
    const regex = /(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}:\d{2}:\d{2})/;
    
    // 1. ทำความสะอาดสตริงโดยลบชื่อวันนำหน้า
    const cleaned = rawDateString.replace(/^\S+\s-\s/, "").trim(); // ลบ "พุธ - "
    
    // 2. ใช้ RegEx จับคู่
    const match = cleaned.match(regex);
    
    if (!match) {
        throw new Error(`Date string format mismatch: ${rawDateString}`);
    }
    
    // match[1]=วัน (DD), match[2]=เดือน (MM), match[3]=ปี (YYYY), match[4]=เวลา (HH:mm:ss)
    const [, day, month, year, timePart] = match;
    
    // 3. สร้างรูปแบบ ISO 8601 YYYY-MM-DDTHH:mm:ss เพื่อการ Parse ที่เชื่อถือได้
    // เราใช้ช่องว่างแทน 'T' เพื่อให้ JS Date ตีความเป็น Local Time: YYYY-MM-DD HH:mm:ss
    const isoString = `${year}-${month}-${day} ${timePart}`;
    
    // 4. สร้าง Date Object
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
            const endField   = embed.fields.find(f => f.name === "เวลาออกงาน");

            if (!startField || !endField || !startField.value || !endField.value) {
                console.warn(`⚠ ข้อมูลเวลาไม่ครบถ้วนในข้อความของ ${name}`);
                return;
            }
            
            const startRaw = startField.value;
            const endRaw   = endField.value;
            
            // ⭐ ใช้ฟังก์ชันใหม่ในการแปลงเวลา
            const start = parseDateFromEmbed(startRaw);
            const end   = parseDateFromEmbed(endRaw);
            
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

// ====================== GOOGLE SHEET LOGIC (ไม่เปลี่ยนแปลง) ======================

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
    const auth = new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
        ["https://www.googleapis.com/auth/spreadsheets"]
    );
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
