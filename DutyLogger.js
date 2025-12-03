// DutyLogger.js
require("dotenv").config();
const { google } = require("googleapis");

const DUTY_LOG_CHANNEL_ID = process.env.DUTY_LOG_CHANNEL_ID;

module.exports.initializeDutyLogger = function (client) {

    client.on("messageCreate", async (msg) => {

        // ⭐️ ฟังเฉพาะห้องนี้เท่านั้น
        if (msg.channelId !== DUTY_LOG_CHANNEL_ID) return;

        if (!msg.embeds.length) return;

        const embed = msg.embeds[0];

        if (!embed.title?.includes("รายงานเข้าเวร")) return;

        try {
            const name = embed.fields.find(f => f.name === "ชื่อ")?.value || "-";
            const start = embed.fields.find(f => f.name === "เวลาเข้าทำงาน")?.value;
            const end = embed.fields.find(f => f.name === "เวลาเลิกงาน")?.value;

            const startDate = new Date(start.replace("พุธ - ", "").trim());
            const endDate = new Date(end.replace("พุธ - ", "").trim());

            const diffMs = endDate - startDate;
            const hours = diffMs / (1000 * 60 * 60);

            const weekday = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
            const dayName = weekday[startDate.getDay()];

            await appendToSheet([name, dayName, hours]);
            console.log("Duty logged:", name, dayName, hours);

        } catch (err) {
            console.error("DutyLogger error:", err);
        }
    });
};

async function appendToSheet(row) {
    const auth = new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        process.env_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        ["https://www.googleapis.com/auth/spreadsheets"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
        spreadsheetId: "YOUR_GOOGLE_SHEET_ID",
        range: "เวลางาน!A1",
        valueInputOption: "USER_ENTERED",
        resource: { values: [row] }
    });
}
