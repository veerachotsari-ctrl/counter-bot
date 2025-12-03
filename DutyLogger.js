// DutyLogger.js

const { google } = require("googleapis");
const serviceAccount = require("./keys/service-account.json");

const DUTY_LOG_CHANNEL_ID = process.env.DUTY_LOG_CHANNEL_ID;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// สร้าง Google Auth
const auth = new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

module.exports.initializeDutyLogger = function (client) {
    client.on("messageCreate", async (msg) => {
        if (msg.channelId !== DUTY_LOG_CHANNEL_ID) return;
        if (!msg.embeds.length) return;

        const embed = msg.embeds[0];
        if (!embed.title || !embed.title.includes("รายงานเข้าเวร")) return;

        let name, startRaw, endRaw;

        try {
            name = embed.fields.find(f => f.name === "ชื่อ")?.value || "ไม่ระบุ";
            startRaw = embed.fields.find(f => f.name === "เวลาเข้างาน")?.value;
            endRaw = embed.fields.find(f => f.name === "เวลาออกงาน")?.value;

            if (!startRaw || !endRaw) return;

            const start = parseThaiDate(startRaw);
            const end = parseThaiDate(endRaw);

            if (!start || !end) return;

            const diffHours = (end - start) / (1000 * 60 * 60);

            const weekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
            const dayName = weekdays[start.getDay()];

            await appendToSheet([name, dayName, diffHours.toFixed(2)]);

            console.log(`✔ ลงข้อมูล: ${name} | ${dayName} | ${diffHours.toFixed(2)} ชม.`);

        } catch (err) {
            console.error("❌ DUTY LOGGER ERROR\n", err);
        }
    });
};

// =============================
// แปลงวันที่ไทยแบบ embed
// =============================
function parseThaiDate(text) {
    try {
        const [, datetime] = text.split(" - ");
        const [datePart, timePart] = datetime.split(" ");

        const [day, month, year] = datePart.split("/").map(Number);
        const [hour, minute, second] = timePart.split(":").map(Number);

        return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    } catch {
        return null;
    }
}

// =============================
// Append ลง Google Sheet
// =============================
async function appendToSheet(row) {
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "DutyLogger",
        valueInputOption: "USER_ENTERED",
        resource: {
            values: [row]
        }
    });
}
