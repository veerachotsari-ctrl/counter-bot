// ShiftReportSaver.js

const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./config.json'); // ต้องมีไฟล์ config.json ที่มี key Google Service Account

// ⭐️ ตั้งค่าสำหรับบอท 
const REPORT_CHANNEL_ID = 'YOUR_REPORT_CHANNEL_ID_HERE'; // ⚠️ เปลี่ยนเป็น Channel ID ของรายงานเข้าเวร
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ⚠️ เปลี่ยนเป็น ID ของ Google Sheet
const SHEET_TITLE = 'รายงานเวลาเข้าเวร'; // ชื่อ Sheet ที่คุณใช้เก็บข้อมูล

// แมปชื่อวันไทยกับดัชนีคอลัมน์ใน Sheet (A=1, B=2, C=3, ...)
const DAY_COLUMNS = {
    'จันทร์': 'B', 'อังคาร': 'C', 'พุธ': 'D', 'พฤหัสบดี': 'E',
    'ศุกร์': 'F', 'เสาร์': 'G', 'อาทิตย์': 'H'
};
const NAME_COLUMN = 'A'; // คอลัมน์ A เก็บชื่อผู้เล่น

// =========================================================
// ⏱️ LOGIC: Time/Date & Parsing Functions
// =========================================================

// ฟังก์ชันสำหรับแปลงข้อความเวลา/วันที่ไทยให้เป็น JavaScript Date object
function parseThaiDateTime(dateTimeString) {
    // ต้องแปลงรูปแบบวันที่ให้เป็นที่ยอมรับของ JS (เช่น 2025-12-02T22:51:48)
    const parts = dateTimeString.split(' - ');
    if (parts.length < 2) return null;

    const [datePart, timePart] = parts[1].split(' ');
    const [day, month, year] = datePart.split('/');

    // สร้าง ISO-like string
    const isoString = `${year}-${month}-${day}T${timePart}`;
    return new Date(isoString); 
}

// ฟังก์ชันแปลง Date object เป็นชื่อวันไทย
function getThaiDay(dateObject) {
    const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    return days[dateObject.getDay()];
}

// ฟังก์ชันแปลง HH:MM:SS เป็นวินาทีทั้งหมด
function timeToSeconds(duration) {
    const parts = duration.split(':').map(Number);
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
}

// ฟังก์ชันแปลงวินาทีกลับเป็น HH:MM:SS สำหรับเขียนลง Sheet
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

    // ตรวจสอบว่าคร่อมวันหรือไม่
    const isOvernight = entryDate.getTime() !== exitDate.getTime();

    if (!isOvernight) {
        // กรณี 1: ไม่คร่อมวัน (ง่าย)
        const durationMs = exitTime.getTime() - entryTime.getTime();
        splits.push({
            day: getThaiDay(entryTime),
            durationSeconds: Math.round(durationMs / 1000)
        });
    } else {
        // กรณี 2: คร่อมวัน (ต้องแบ่งเวลา)
        
        // 1. ส่วนที่ 1: ตั้งแต่เวลาเข้าจนถึงเที่ยงคืนของวันแรก
        const midnight = new Date(entryDate);
        midnight.setDate(entryDate.getDate() + 1); // เที่ยงคืนวันถัดไป

        const duration1Ms = midnight.getTime() - entryTime.getTime();
        splits.push({
            day: getThaiDay(entryTime), // วันแรก (อังคาร)
            durationSeconds: Math.round(duration1Ms / 1000)
        });

        // 2. ส่วนที่ 2: ตั้งแต่เที่ยงคืนจนถึงเวลาออกงานของวันที่สอง
        const duration2Ms = exitTime.getTime() - midnight.getTime();
        splits.push({
            day: getThaiDay(exitTime), // วันที่สอง (พุธ)
            durationSeconds: Math.round(duration2Ms / 1000)
        });
    }

    return splits;
}

// ฟังก์ชันหลักในการดึงข้อมูลจากข้อความ
function parseReportMessage(content) {
    // ⭐️ ตรรกะการแยกข้อความ (Regex)
    const nameMatch = content.match(/ชื่อ\s*[\r\n]+(.*?)(?:\n|$)/i);
    const entryTimeMatch = content.match(/เวลาเข้างาน\s*[\r\n]+(.*?)(?:\n|$)/i);
    const exitTimeMatch = content.match(/เวลาออกงาน\s*[\r\n]+(.*?)(?:\n|$)/i);

    const name = nameMatch ? nameMatch[1].trim() : null;
    const entryTimeStr = entryTimeMatch ? entryTimeMatch[1].trim() : null;
    const exitTimeStr = exitTimeMatch ? exitTimeMatch[1].trim() : null;

    if (!name || !entryTimeStr || !exitTimeStr) return null;

    // คำนวณการแบ่งเวลาที่คร่อมวัน
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
        
        // โหลดข้อมูล Sheet
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet with title "${SHEET_TITLE}" not found.`);

        // 1. ดึงแถวข้อมูลทั้งหมด
        const rows = await sheet.getRows();
        
        // 2. ค้นหาแถวของผู้เล่น
        let targetRow = rows.find(r => r[NAME_COLUMN] === name);

        if (!targetRow) {
            // ถ้าไม่พบ ให้สร้างแถวใหม่
            const newRowData = { [NAME_COLUMN]: name };
            targetRow = await sheet.addRow(newRowData);
        }

        // 3. คำนวณและอัปเดตเวลา
        const colLetter = DAY_COLUMNS[day];
        if (!colLetter) return; // ไม่ใช่ชื่อวันในสัปดาห์

        // ดึงค่าปัจจุบันในคอลัมน์ของวันนั้น (เช่น คอลัมน์ 'พุธ')
        const currentCellValue = targetRow[colLetter] || '00:00:00'; 
        
        // แปลงเวลาปัจจุบัน + เวลาใหม่ เป็นวินาที
        const currentSeconds = timeToSeconds(currentCellValue);
        const newTotalSeconds = currentSeconds + durationSeconds;
        
        // อัปเดตค่าในแถวด้วยเวลาใหม่ที่รวมแล้ว
        targetRow[colLetter] = secondsToTime(newTotalSeconds);
        await targetRow.save(); // บันทึกการเปลี่ยนแปลงกลับไปที่ Sheet

        console.log(`[SHEET] Updated ${name}'s total time for ${day} to ${targetRow[colLetter]}`);

    } catch (error) {
        console.error("Error updating Google Sheet:", error.message);
    }
}

// =========================================================
// ⭐️ MAIN MODULE INITIALIZER
// =========================================================

function initializeShiftReportSaver(client) {
    client.on('messageCreate', async message => {
        // กรอง: เฉพาะ Channel รายงาน, ไม่ใช่บอทตัวนี้เอง, และต้องมีเนื้อหา
        if (message.channelId !== REPORT_CHANNEL_ID || message.author.bot || !message.content) {
            return;
        }

        // ⚠️ แนะนำ: ให้กรองเฉพาะข้อความที่มาจาก 'บอทรายงานเข้าเวร' ด้วย
        // if (message.author.id !== 'ID_OF_REPORT_BOT') return; 

        // 1. แยกและคำนวณข้อมูลทั้งหมด
        const reportData = parseReportMessage(message.content);

        if (!reportData) {
            console.log("Could not parse all required data from the report.");
            return;
        }

        // 2. บันทึกลง Sheet: วนลูปสำหรับเวลาที่ถูกแบ่งแล้ว (แม้ว่าจะมีแค่ 1 ส่วน)
        for (const split of reportData.timeSplits) {
            await updateSheet(reportData.name, split.day, split.durationSeconds);
        }
    });

    console.log("✅ Shift Report Saver module initialized.");
}

module.exports = { initializeShiftReportSaver };
