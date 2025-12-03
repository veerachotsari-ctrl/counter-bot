// DutyLogger.js
require("dotenv").config();
const { google } = require("googleapis");

// ⭐ ใช้ Channel ID ที่ให้ไว้
const DUTY_LOG_CHANNEL_ID = "1445640443986710548";

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

            const startRaw = embed.fields.find(f => f.name === "เวลาเข้าทำงาน")?.value;
            const endRaw   = embed.fields.find(f => f.name === "เวลาเลิกงาน")?.value;

            // "พุธ - 03/12/2025 16:18:05" → ลบ "พุธ - "
            const start = new Date(startRaw.replace(/^\S+ - /, "").trim());
            const end   = new Date(endRaw.replace(/^\S+ - /, "").trim());

            // คำนวณชั่วโมง
            const diffMs = end - start;
            const hours = diffMs / (1000 * 60 * 60);

            // วันในสัปดาห์ภาษาไทย
            const weekdays = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
            const dayName = weekdays[start.getDay()];

            // ส่งลงชีต
            await appendToSheet([name, dayName, hours]);

            console.log(`✔ ลงข้อมูล: ${name} | ${dayName} | ${hours.toFixed(2)} ชม.`);

        } catch (err) {
            console.error("❌ DutyLogger error:", err);
        }
    });
};


// ====================== GOOGLE SHEET ======================

async function appendToSheet(row) {
    const auth = new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
        ["https://www.googleapis.com/auth/spreadsheets"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
        spreadsheetId: "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM",  // ⭐ ชีตที่ให้มา
        range: "DutyLogger!A1",  // ⭐ ชื่อชีต DutyLogger
        valueInputOption: "USER_ENTERED",
        resource: { values: [row] }
    });
}
