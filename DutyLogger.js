// DutyLogger.js (แก้ไขการ Parse วันที่)
require("dotenv").config();
const { google } = require("googleapis");

const DUTY_LOG_CHANNEL_ID = "1445640443986710548";
const SPREADSHEET_ID = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
const SHEET_NAME = "DutyLogger";
const NAMES_RANGE = `${SHEET_NAME}!B3:B`; 

/**
 * ฟังก์ชันช่วยแปลงสตริงวันที่จาก Embed (DD/MM/YYYY) ให้เป็น Date Object ที่ถูกต้อง
 * ตัวอย่าง: "พุธ - 03/12/2025 17:18:11" -> Date Object
 */
function parseDateFromEmbed(rawDateString) {
    // 1. ลบชื่อวัน: "พุธ - 03/12/2025 17:18:11" -> "03/12/2025 17:18:11"
    const cleaned = rawDateString.replace(/^\S+ - /, "").trim();
    
    // 2. แยกวันที่และเวลา
    const [datePart, timePart] = cleaned.split(' '); // ["03/12/2025", "17:18:11"]
    
    // 3. แยกส่วนวันที่ (สมมติว่าเป็น DD/MM/YYYY)
    const [day, month, year] = datePart.split('/'); // ["03", "12", "2025"]
    
    // 4. สร้างรูปแบบ ISO 8601: YYYY-MM-DDTHH:mm:ss ซึ่งมีความแม่นยำสูง
    const isoString = `${year}-${month}-${day}T${timePart}`;
    
    // 5. สร้าง Date Object จาก ISO String
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
            
            // ⭐⭐⭐ ใช้ฟังก์ชันใหม่ในการแปลงเวลา ⭐⭐⭐
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
