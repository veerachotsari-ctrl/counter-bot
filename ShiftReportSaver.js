// ShiftReportSaver.js

const { GoogleSpreadsheet } = require('google-spreadsheet');
const appConfig = require('./config.json'); 

// ⭐️ ตั้งค่าสำหรับ Google Service Account จาก Environment Variables
const creds = {
    client_email: process.env.CLIENT_EMAIL,
    // สำคัญ: ต้องแทนที่ \n ใน private key ด้วย newline จริง
    private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'), 
};

// ⭐️ ตั้งค่าสำหรับบอท 
// ดึง Channel ID จาก Environment
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID; 

// ใช้ค่าจาก config.json
const SPREADSHEET_ID = appConfig.SPREADSHEET_ID; 
// 🌟 เปลี่ยนมาใช้คีย์ใหม่สำหรับชื่อชีต
const SHEET_TITLE = appConfig.SHIFT_SHEET_NAME; 

// =========================================================
// ⏱️ LOGIC: Time/Date & Parsing Functions
// =========================================================

function parseThaiDateTime(dateTimeString) {
    const parts = dateTimeString.split(' - ');
    if (parts.length < 2) return null;

    const [datePart, timePart] = parts[1].split(' ');
    const [day, month, year] = datePart.split('/');

    const isoString = `${year}-${month}-${day}T${timePart}`;
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return null;

    return date; 
}

function getThaiDay(dateObject) {
    const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    return days[dateObject.getDay()];
}

function timeToSeconds(duration) {
    const parts = duration.split(':').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return 0;
    
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
}

function secondsToTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// ฟังก์ชันหลัก: คำนวณและแบ่งเวลาเข้าเวรที่คร่อมวัน (Overnight Split Logic)
function calculateDutyTimeSplits(entryTimeStr, exitTimeStr) {
    const entryTime = parseThaiDateTime(entryTimeStr);
    const exitTime = parseThaiDateTime(exitTimeStr);
    if (!entryTime || !exitTime) return [];

    const splits = [];
    const entryDate = new Date(entryTime.getFullYear(), entryTime.getMonth(), entryTime.getDate());
    const exitDate = new Date(exitTime.getFullYear(), exitTime.getMonth(), exitTime.getDate());
    const isOvernight = entryDate.getTime() !== exitDate.getTime();

    if (!isOvernight) {
        // กรณี 1: ไม่คร่อมวัน
        const durationMs = exitTime.getTime() - entryTime.getTime();
        splits.push({
            day: getThaiDay(entryTime),
            durationSeconds: Math.round(durationMs / 1000)
        });
    } else {
        // กรณี 2: คร่อมวัน (ต้องแบ่งเวลา)
        const midnight = new Date(entryDate);
        midnight.setDate(entryDate.getDate() + 1);

        // ส่วนที่ 1: ตั้งแต่เวลาเข้าจนถึงเที่ยงคืนของวันแรก
        const duration1Ms = midnight.getTime() - entryTime.getTime();
        splits.push({
            day: getThaiDay(entryTime),
            durationSeconds: Math.round(duration1Ms / 1000)
        });

        // ส่วนที่ 2: ตั้งแต่เที่ยงคืนจนถึงเวลาออกงานของวันที่สอง
        const duration2Ms = exitTime.getTime() - midnight.getTime();
        splits.push({
            day: getThaiDay(exitTime),
            durationSeconds: Math.round(duration2Ms / 1000)
        });
    }

    return splits;
}

function parseReportMessage(content) {
    // ⭐️ ใช้ Regex ดึงข้อมูล: 
    const nameMatch = content.match(/ชื่อ\s*[\r\n]+(.*?)(?:\n|$)/i);
    const entryTimeMatch = content.match(/เวลาเข้างาน\s*[\r\n]+(.*?)(?:\n|$)/i);
    const exitTimeMatch = content.match(/เวลาออกงาน\s*[\r\n]+(.*?)(?:\n|$)/i);

    const name = nameMatch ? nameMatch[1].trim() : null;
    const entryTimeStr = entryTimeMatch ? entryTimeMatch[1].trim() : null;
    const exitTimeStr = exitTimeMatch ? exitTimeMatch[1].trim() : null;

    if (!name || !entryTimeStr || !exitTimeStr) return null;

    const timeSplits = calculateDutyTimeSplits(entryTimeStr, exitTimeStr);
    return { name, timeSplits };
}

// =========================================================
// 💾 LOGIC: Google Sheets Integration
// =========================================================

async function updateSheet(name, day, durationSeconds) {
    try {
        const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
        await doc.useServiceAccountAuth(creds); 
        
        // ใช้ SHEET_TITLE ที่ดึงมาจาก SHIFT_SHEET_NAME
        const sheet = doc.sheetsByTitle[SHEET_TITLE]; 
        if (!sheet) throw new Error(`Sheet with title "${SHEET_TITLE}" not found.`);

        // 1. ดึงแถวข้อมูลทั้งหมด
        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();
        
        // 2. ค้นหาแถวของผู้เล่น
        let targetRow = rows.find(r => r['ชื่อ'] === name); 

        if (!targetRow) {
            // ถ้าไม่พบ ให้สร้างแถวใหม่ (สมมติว่าคอลัมน์แรกในชีตชื่อ 'ชื่อ')
            targetRow = await sheet.addRow({ 'ชื่อ': name });
        }
        
        // 3. คำนวณและอัปเดตเวลา
        // ดึงค่าปัจจุบันในคอลัมน์ของวันนั้น (เช่น 'จันทร์', 'อังคาร')
        const currentCellValue = targetRow[day] || '00:00:00'; 
        
        // แปลงเวลาปัจจุบัน + เวลาใหม่ เป็นวินาที
        const currentSeconds = timeToSeconds(currentCellValue);
        const newTotalSeconds = currentSeconds + durationSeconds;
        
        // อัปเดตค่าในแถวด้วยเวลาใหม่ที่รวมแล้ว
        targetRow[day] = secondsToTime(newTotalSeconds); 
        await targetRow.save(); 

        console.log(`[SHEET] Updated ${name}'s total time for ${day} to ${targetRow[day]}`);

    } catch (error) {
        console.error("Error updating Google Sheet:", error.message);
    }
}

// =========================================================
// ⭐️ MAIN MODULE INITIALIZER
// =========================================================

function initializeShiftReportSaver(client) {
    if (!REPORT_CHANNEL_ID) {
        console.error("❌ ERROR: REPORT_CHANNEL_ID is not set in environment variables!");
        return;
    }
    
    client.on('messageCreate', async message => {
        // กรอง: เฉพาะ Channel รายงาน, ไม่ใช่บอทตัวนี้เอง, และต้องมีเนื้อหา
        if (message.channelId !== REPORT_CHANNEL_ID || message.author.id === client.user.id || !message.content) {
            return;
        }

        // 1. แยกและคำนวณข้อมูลทั้งหมด
        const reportData = parseReportMessage(message.content);

        if (!reportData || reportData.timeSplits.length === 0) {
            console.log("Could not parse all required data or time splits are empty.");
            return;
        }

        // 2. บันทึกลง Sheet: วนลูปสำหรับเวลาที่ถูกแบ่งแล้ว
        for (const split of reportData.timeSplits) {
            await updateSheet(reportData.name, split.day, split.durationSeconds);
        }
    });

    console.log("✅ Shift Report Saver module initialized. Listening to channel:", REPORT_CHANNEL_ID);
}

module.exports = { initializeShiftReportSaver };
