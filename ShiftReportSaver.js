// ShiftReportSaver.js

const { GoogleSpreadsheet } = require('google-spreadsheet'); // หรือ googleapis

// ⭐️ ต้องกำหนด ID ของ Channel ที่บอทรายงานเข้าเวรใช้
const REPORT_CHANNEL_ID = 'YOUR_REPORT_CHANNEL_ID_HERE'; 

// ⭐️ ฟังก์ชันหลักที่ต้อง Export
function initializeShiftReportSaver(client) {
    // 1. ตั้งค่า Google Sheets (ต้องทำ Authentication ตรงนี้)
    // ... โค้ดสำหรับ AUTH Google Sheets ...

    // 2. ตั้งค่า Message Listener
    client.on('messageCreate', async message => {
        // ตรวจสอบว่าเป็นข้อความที่อยู่ใน Channel ที่กำหนด และไม่ใช่ข้อความจากบอทตัวนี้เอง
        if (message.channelId !== REPORT_CHANNEL_ID || message.author.bot) {
            return;
        }

        // ⚠️ ต้องกรองเฉพาะข้อความที่มาจาก 'บอทรายงานเข้าเวร' ด้วย
        // if (message.author.id !== 'REPORT_BOT_ID') return; 

        console.log(`Received report from channel ${REPORT_CHANNEL_ID}`);

        // 3. ดึงและประมวลผลข้อมูล
        const reportContent = message.content; // หรือ message.embeds[0].description ถ้าใช้ Embed
        
        // ⭐️ เรียกใช้ตรรกะการแยกข้อความ, การแบ่งเวลา, และการรวมเวลา ที่เราคุยกัน
        // const { name, day, durationSeconds } = parseAndAggregate(reportContent); 

        // 4. บันทึกลง Google Sheets
        // await saveToGoogleSheet(name, day, durationSeconds);
    });

    console.log("✅ Shift Report Saver module initialized.");
}

module.exports = { initializeShiftReportSaver };
