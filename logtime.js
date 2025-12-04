// LogTime.js (เวอร์ชันแก้ใหม่เต็ม)
// รองรับข้อความแบบ "พฤหัสบดี - 04/12/2025 22:46:43"

module.exports = (client, sheets) => {
    const channelId = "1445640443986710548";

    client.on("messageCreate", async (message) => {
        if (message.channel.id !== channelId) return;
        if (!message.embeds.length) return;

        const embed = message.embeds[0];

        let name = "";
        let timeIn = "";
        let timeOut = "";
        let duration = "";

        embed.fields.forEach(f => {
            const label = f.name.trim();
            const value = f.value.trim();

            if (label === "ชื่อ") name = value;
            if (label === "เวลาทำงาน") timeIn = value;
            if (label === "เวลาออกงาน") timeOut = value;
            if (label === "ระยะเวลาที่เข้าเวร") duration = value;
        });

        if (!name || !timeIn || !timeOut) {
            console.log("❌ Missing fields. Skip.");
            return;
        }

        // แก้: หั่นวันทิ้ง เช่น "พฤหัสบดี - 04/12/2025 22:46:43"
        const clean = (text) => {
            const parts = text.split("-"); 
            return parts.length > 1 ? parts[1].trim() : text.trim();
        };

        const timeInClean = clean(timeIn);
        const timeOutClean = clean(timeOut);

        console.log(`📌 Parsed → ${name}, ${duration}, ${timeInClean}, ${timeOutClean}`);

        await saveLog(sheets, name, duration, timeOutClean);
    });
};


// ---------------------------------------------
// Save ลง Google Sheets
// ช่อง A = ชื่อ
// ช่อง B = วันที่
// ช่อง C = เวลา
// ---------------------------------------------

async function saveLog(sheets, name, duration, timeFinish) {
    // timeFinish ตัวอย่าง: "04/12/2025 22:58:49"
    const [date, time] = timeFinish.split(" ");

    const values = [[
        name,
        date,
        time,
        duration
    ]];

    try {
        const res = await sheets.spreadsheets.values.append({
            spreadsheetId: "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM",
            range: "logtime!A:C",
            valueInputOption: "RAW",
            requestBody: { values }
        });

        console.log("✔ Saved to Google Sheets!", res.data);
    } catch (e) {
        console.error("❌ Sheets Append Error:", e);
    }
}
