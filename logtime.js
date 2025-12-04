const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// ========================================================================
// Google Sheets Client (ไม่ได้ถูกแก้ไข)
// ========================================================================
function getSheetsClient() {
    const privateKey = process.env.PRIVATE_KEY
        ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n")
        : null;

    if (!process.env.CLIENT_EMAIL || !privateKey) {
        console.log("❌ Missing GOOGLE ENV");
        console.log("CLIENT_EMAIL:", process.env.CLIENT_EMAIL);
        console.log("PRIVATE_KEY:", privateKey ? "Loaded" : "Missing");
        return null;
    }

    return new JWT({
        email: process.env.CLIENT_EMAIL,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
}

// ========================================================================
// 💡 ฟังก์ชันใหม่: ค้นหาเลขแถวจากชื่อ
// ========================================================================
async function findRowByName(sheets, spreadsheetId, sheetName, name) {
    // อ่านข้อมูลทั้งหมดจากคอลัมน์ A (ชื่อ) ตั้งแต่แถวที่ 2
    const range = `${sheetName}!B2:B`; // อ่านคอลัมน์ชื่อทั้งหมด (เริ่มที่ B2)
    
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });

    const values = response.data.values || [];
    
    // ค้นหาดัชนีของชื่อที่ตรงกัน
    // value[0] คือค่าในคอลัมน์ B (ชื่อ)
    const rowIndexInValuesArray = values.findIndex(value => 
        value.length > 0 && value[0].trim().toLowerCase() === name.trim().toLowerCase()
    );

    if (rowIndexInValuesArray !== -1) {
        // แถวที่แท้จริง = B2 (เริ่มต้นที่ 2) + ดัชนีที่เจอ (0-based)
        // เช่น ถ้าเจอที่ index 0 คือแถวที่ 2, ถ้า index 1 คือแถวที่ 3
        const actualRowNumber = 2 + rowIndexInValuesArray; 
        return actualRowNumber;
    }

    return null; // ไม่พบชื่อ
}

// ========================================================================
// Google Sheets Client - ปรับปรุงการทำงานเป็น Find & Update
// ========================================================================
async function saveLog(name, date, time) {
    // ใช้ค่า Hardcoded เดิมตามโค้ดต้นฉบับ
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
    const sheetName = "logtime";

    const auth = getSheetsClient();
    if (!auth) return;

    try {
        await auth.authorize();
        const sheets = google.sheets({ version: "v4", auth });

        // 1. ค้นหาชื่อ
        const existingRow = await findRowByName(sheets, spreadsheetId, sheetName, name);

        if (existingRow) {
            // 2. ถ้าเจอชื่อ: ใช้วิธี UPDATE ข้อมูลในแถวเดิม
            // อัปเดตข้อมูลในคอลัมน์ B (ชื่อ), C (วันที่), D (เวลา) ในแถวที่พบ
            const updateRange = `${sheetName}!B${existingRow}`; 

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: updateRange,
                valueInputOption: "USER_ENTERED",
                resource: { values: [[name, date, time]] }, // ใส่ข้อมูลทั้ง 3 คอลัมน์
            });
            console.log(`✅ Updated existing log for ${name} at Row ${existingRow}:`, date, time);

        } else {
            // 3. ถ้าไม่เจอชื่อ: ใช้วิธี APPEND เพิ่มแถวใหม่ (แบบเดิม)
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${sheetName}!B2`,
                valueInputOption: "USER_ENTERED",
                resource: { values: [[name, date, time]] },
            });
            console.log("✔ Saved new log to Google Sheets:", name, date, time);
        }
    } catch (error) {
        console.error("❌ ERROR saving/updating to Google Sheets:", error.message);
    }
}


// ========================================================================
// Discord Log Listener (ไม่มีการแก้ไขการดึงข้อมูล)
// ========================================================================
function initializeLogListener(client) {
    const LOG_CHANNEL = "1445640443986710548";

    client.on("messageCreate", async message => {
        if (message.channel.id !== LOG_CHANNEL) return;

        console.log("\n📥 NEW MESSAGE");

        // ... (ส่วนการรวมข้อความจาก content + embed ยังคงเดิม) ...
        let text = message.content ? message.content + "\n" : "";

        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                const e = embed.data ?? embed;

                if (e.title) text += e.title + "\n";
                if (e.description) text += e.description + "\n";

                const fields = e.fields || [];
                for (const f of fields) {
                    if (!f) continue;
                    const fname = f.name?.toString().trim() || "";
                    const fvalue = f.value?.toString().trim() || "";
                    if (fname || fvalue) {
                        text += `${fname}\n${fvalue}\n`;
                    }
                }
            }
        }

        // clean markdown noise
        text = text
            .replace(/`/g, "")
            .replace(/\*/g, "")
            .replace(/\u200B/g, "");

        console.log("📜 PARSED TEXT:\n" + text);

        // ... (ส่วน Extract NAME ยังคงเดิม) ...
        let name = null;
        const nameField = text.match(/(?:^|\n)ชื่อ\s*\n(.+?)(?:\n\S|$)/i);
        if (nameField) {
            name = nameField[1].trim();
        }
        if (!name) {
            const t = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+?)(?:\n|$)/i);
            if (t) name = t[1].trim();
        }
        if (!name) {
            console.log("❌ NAME not found.");
            return;
        }
        console.log("🟩 NAME:", name);

        // ... (ส่วน Extract Date + Time ยังคงเดิม) ...
        let date = null, time = null;
        const dtRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/g;
        let match, last = null;
        while ((match = dtRegex.exec(text)) !== null) {
            last = match;
        }
        if (last) {
            date = last[1];
            time = last[2];
            console.log("🟩 DateTime (pattern):", date, time);
        } else {
            console.log("❌ No datetime matched.");
            const lastLines = text.split("\n").slice(-10).join("\n");
            console.log(lastLines);
            return;
        }

        // =========================================================================
        // 4) Save/Update to Sheet
        // =========================================================================
        await saveLog(name, date, time);
        console.log("✔ LOG COMPLETE:", name, date, time);

    });
}

module.exports = { initializeLogListener };
