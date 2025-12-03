// DutyLogger.js (แก้ไขชื่อ Field)
require("dotenv").config();
const { google } = require("googleapis");

const DUTY_LOG_CHANNEL_ID = "1445640443986710548";
const SPREADSHEET_ID = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
const SHEET_NAME = "DutyLogger";
const NAMES_RANGE = `${SHEET_NAME}!B3:B`; 

module.exports.initializeDutyLogger = function (client) {

    client.on("messageCreate", async (msg) => {

        if (msg.channelId !== DUTY_LOG_CHANNEL_ID) return;
        if (!msg.embeds.length) return;

        const embed = msg.embeds[0];

        if (!embed.title?.includes("รายงานเข้าเวร")) return;

        try {
            const name = embed.fields.find(f => f.name === "ชื่อ")?.value || "-";

            // ⭐⭐⭐ แก้ไขชื่อ Field ตรงนี้ ⭐⭐⭐
            const startField = embed.fields.find(f => f.name === "เวลาเข้างาน");
            const endField   = embed.fields.find(f => f.name === "เวลาออกงาน");

            if (!startField || !endField || !startField.value || !endField.value) {
                console.warn(`⚠ ข้อมูลเวลาไม่ครบถ้วนในข้อความของ ${name}`);
                return;
            }
            
            const startRaw = startField.value;
            const endRaw   = endField.value;
            
            // "พุธ - 03/12/2025 17:14:01" → ลบ "พุธ - "
            const start = new Date(startRaw.replace(/^\S+ - /, "").trim());
            const end   = new Date(endRaw.replace(/^\S+ - /, "").trim());
            
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
