// DutyLogger.js
require("dotenv").config();
const { google } = require("googleapis");

// ⭐ ใช้ Channel ID ที่ให้ไว้
const DUTY_LOG_CHANNEL_ID = "1445640443986710548";
// **ค่าคงที่ใหม่สำหรับ Google Sheet**
const SPREADSHEET_ID = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
const SHEET_NAME = "DutyLogger";
const NAMES_RANGE = `${SHEET_NAME}!B3:B`; // ชื่อจะถูกเก็บตั้งแต่ B3 ลงไป

module.exports.initializeDutyLogger = function (client) {

    client.on("messageCreate", async (msg) => {

        // ⭐ ทำงานเฉพาะห้องนี้
        if (msg.channelId !== DUTY_LOG_CHANNEL_ID) return;

        if (!msg.embeds.length) return;

        const embed = msg.embeds[0];

        // ⭐ เช็คว่าข้อความนี้เป็นรายงานเข้าเวร
        if (!embed.title?.includes("รายงานเข้าเวร")) return;

        try {
            const name = embed.fields.find(f => f.name === "ชื่อ")?.value || "-";

            const startField = embed.fields.find(f => f.name === "เวลาเข้าทำงาน");
            const endField   = embed.fields.find(f => f.name === "เวลาเลิกงาน");

            if (!startField || !endField || !startField.value || !endField.value) {
                console.warn(`⚠ ข้อมูลเวลาไม่ครบถ้วนในข้อความของ ${name}`);
                return;
            }
            
            // "พุธ - 03/12/2025 16:18:05" → ลบ "พุธ - "
            const startRaw = startField.value;
            const endRaw   = endField.value;
            
            const start = new Date(startRaw.replace(/^\S+ - /, "").trim());
            const end   = new Date(endRaw.replace(/^\S+ - /, "").trim());
            
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.error(`❌ ไม่สามารถแปลงเวลาเป็น Date ได้: Start=${startRaw}, End=${endRaw}`);
                return;
            }

            // คำนวณชั่วโมง
            const diffMs = end - start;
            const hours = diffMs / (1000 * 60 * 60);

            // วันในสัปดาห์ภาษาไทย
            const weekdays = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
            const dayName = weekdays[start.getDay()];
            
            // ⭐ เปลี่ยนไปใช้ฟังก์ชัน logDutyHours ใหม่
            await logDutyHours(name, dayName, parseFloat(hours.toFixed(2))); // ส่งค่าชั่วโมงที่ปัดเศษแล้ว

            console.log(`✔ ลงข้อมูล: ${name} | ${dayName} | ${hours.toFixed(2)} ชม.`);

        } catch (err) {
            console.error("❌ DutyLogger error:", err);
        }
    });
};


// ====================== GOOGLE SHEET LOGIC (แก้ไขใหม่) ======================

/**
 * Maps Thai Day Name to the corresponding Google Sheet Column Letter.
 * Structure: B=Name, C=จันทร์, D=อังคาร, E=พุธ, F=พฤหัสบดี, G=ศุกร์, H=เสาร์, I=อาทิตย์, J=รวม
 */
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

    // 1. ค้นหาแถวของชื่อผู้เข้าเวร
    let namesResponse;
    try {
        namesResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: NAMES_RANGE,
        });
    } catch (e) {
        // หาก Range ว่างเปล่า Google Sheet API อาจ Error
        namesResponse = { data: { values: [] } };
    }

    const nameRows = namesResponse.data.values || [];
    // ค้นหา Index ของชื่อใน Array ที่ดึงมา
    const nameIndex = nameRows.findIndex(row => row[0] === name);
    
    if (nameIndex !== -1) {
        // ชื่อเดิม: แถวข้อมูลเริ่มต้นที่ 3, ดังนั้น index 0 คือ row 3
        rowNum = nameIndex + 3; 
    } else {
        // ชื่อใหม่: Append ชื่อใหม่ในคอลัมน์ B
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!B3`, 
            valueInputOption: "USER_ENTERED",
            resource: { values: [[name]] } 
        });

        // ดึง Row Number ของแถวที่เพิ่งเพิ่มเข้ามา
        const updatedRange = appendResponse.data.updates.updatedRange; // e.g., 'DutyLogger!B5'
        rowNum = parseInt(updatedRange.match(/\d+$/)[0]); 
        
        // ตั้งสูตร "รวม" ในคอลัมน์ J (Total) สำหรับแถวใหม่
        const totalFormula = `=SUM(C${rowNum}:I${rowNum})`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!J${rowNum}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[totalFormula]] }
        });
    }

    // 2. อัปเดตชั่วโมงการทำงานในเซลล์ของวันนั้นๆ
    const targetRange = `${SHEET_NAME}!${targetColumn}${rowNum}`;
    
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: targetRange,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[hours]] }
    });
}
