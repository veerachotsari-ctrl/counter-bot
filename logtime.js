// ... (ส่วนบนคงเดิม) ...

// -----------------------------
// SMART row finder (ปรับปรุงให้รองรับข้อมูลเกิน 500 แถว)
// -----------------------------
async function findRowSmart(sheets, spreadsheetId, sheetName, name) {
    const range = `${sheetName}!B:C`; // ดึงทั้งหมดเพื่อความแม่นยำ หรือระบุ B2:C1000
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rowData = resp.data.values || [];
    const lowerCaseName = (name || "").trim().toLowerCase();

    // ค้นจากคอลัมน์ B (ชื่อในเกม/ชื่อเล่น)
    let rowIndexB = rowData.findIndex((r, idx) =>
        idx >= 1 && r[0] && r[0].toLowerCase().includes(lowerCaseName)
    );
    if (rowIndexB !== -1) return { row: rowIndexB + 1, isNew: false };

    // ค้นจากคอลัมน์ C (ชื่อจริง/ชื่อที่บันทึก)
    let rowIndexC = rowData.findIndex((r, idx) =>
        idx >= 1 && r[1] && r[1].trim().toLowerCase() === lowerCaseName
    );
    if (rowIndexC !== -1) return { row: rowIndexC + 1, isNew: false };

    // หาแถวว่าง (เริ่มที่ 200 ตามที่คุณต้องการ)
    const START_ROW = 200;
    let targetRow = START_ROW;
    
    // วนลูปหาแถวว่างที่แท้จริง
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
// Extract Info (ปรับ Regex ให้ดึง ID แม่นยำขึ้น)
// -----------------------------
function extractMinimal(text) {
    text = text.replace(/[`*]/g, "").replace(/\u200B/g, "");

    const n = text.match(/รายงานเข้าเวรของ\s*[:\-–—]?\s*(.+)/i);
    const name = n ? n[1].trim() : null;

    const out = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const date = out ? out[1] : null;
    const time = out ? out[2] : null;

    // แก้ไข: ดึงเอาเฉพาะค่าหลัง steam: (ถ้าต้องการ) หรือเอาทั้งหมดแบบเดิมก็ได้
    const idMatch = text.match(/steam:(\w+)/i);
    const id = idMatch ? idMatch[0] : null; // ใช้ [0] เพื่อเอา "steam:..." ตามเดิม

    return { name, date, time, id };
}

// -----------------------------
// Discord listener (จุดเช็คเรื่อง Bot)
// -----------------------------
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", message => {
        // ⚠️ ถ้า "รายงานเข้าเวร" ส่งมาจากบอทตัวอื่น ให้คอมเมนต์บรรทัดข้างล่างนี้ทิ้ง
        // if (message.author?.bot) return; 

        if (message.channel.id !== LOG_CHANNEL) return;

        process.nextTick(() => {
            handleLog(message).catch(err => console.error("❌ handleLog error:", err));
        });
    });
    
    // ... (ส่วน handleLog คงเดิม) ...
}
