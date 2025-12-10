// LogTime.js (เวอร์ชันแก้สมบูรณ์)
// คอยอ่านข้อมูลจาก Log และเขียนลง Google Sheets

function initializeLogListener(client, sheets) {
    const channelId = "1445640443986710548"; // ห้องที่อ่าน log

    // ---------------------------
    // ฟังก์ชันมาตรฐานสำหรับล้างชื่อ
    // ---------------------------
    function normalizeName(str) {
        return str
            .toLowerCase()
            .replace(/\d+/g, "")           // ลบเลขนำหน้า เช่น 00 01
            .replace(/\[.*?\]/g, "")       // ลบ [FTPD]
            .replace(/\s+/g, " ")          // ลบช่องเกิน
            .trim();
    }

    // ---------------------------
    // ฟังก์ชันแปลงเวลา
    // ---------------------------
    function parseThaiDate(text) {
        // ตัวอย่าง:
        // "พฤหัสบดี - 04/12/2025 22:46:43"
        try {
            const parts = text.split("-")[1].trim();
            const [date, time] = parts.split(" ");
            const [d, m, y] = date.split("/").map(x => parseInt(x));
            return new Date(`${y}-${m}-${d} ${time}`);
        } catch (e) {
            return null;
        }
    }

    // ---------------------------
    // อ่านข้อความจาก Discord
    // ---------------------------
    client.on("messageCreate", async (message) => {
        if (message.channel.id !== channelId) return;
        if (!message.embeds.length) return;

        const embed = message.embeds[0];

        const playerName = embed.title?.trim() || "";       // ชื่อ เช่น Baigapow Mookrob
        const timeText = embed.description?.trim() || "";   // เวลาแบบไทย
        const action = embed.fields?.[0]?.value || "";      // "เข้าเวร" หรือ "ออกเวร"

        if (!playerName || !timeText) return;

        const eventTime = parseThaiDate(timeText);
        if (!eventTime) return;

        console.log("✨ LOG:", playerName, action, eventTime);

        // โหลดชีต
        const sheet = await sheets.sheetsByTitle["รายชื่อตำรวจ (FTPD)"];
        const rows = await sheet.getRows({ offset: 2 });

        const normName = normalizeName(playerName);

        // ---------------------------
        // 🔍 ค้นหาชื่อใน B แบบ normalize
        // ---------------------------
        const target = rows.find(r => {
            const raw = r["รายชื่อตำรวจ"] ?? "";
            const cleaned = normalizeName(raw);
            return cleaned.includes(normName);
        });

        if (!target) {
            console.log("❌ หาแถวไม่เจอใน Sheet:", playerName);
            return;
        }

        // ---------------------------
        // ✏ เติมชื่อในคอลัมน์ C ถ้ายังว่าง
        // ---------------------------
        if (!target["ชื่อ"] || target["ชื่อ"].trim() === "") {
            target["ชื่อ"] = playerName;
        }

        // ---------------------------
        // บันทึกเวลาเข้า–ออกเวร
        // ---------------------------
        if (action.includes("เข้า")) {
            target["ออกเวรล่าสุด"] = "-";
            target["เวลา"] = new Date(eventTime);
            target["ไม่เข้าเวร"] = "";
            target["เข้า-ไม่เข้า"] = "เข้า";
        }

        if (action.includes("ออก")) {
            target["ออกเวรล่าสุด"] = new Date(eventTime);
            target["เข้า-ไม่เข้า"] = "ออก";
        }

        await target.save();
        console.log("✅ บันทึกสำเร็จ:", playerName);
    });
}

module.exports = { initializeLogListener };
