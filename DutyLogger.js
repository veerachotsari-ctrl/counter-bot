require("dotenv").config();
const { google } = require("googleapis");

// ENV
const DUTY_LOG_CHANNEL_ID = process.env.DUTY_LOG_CHANNEL_ID;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.CLIENT_EMAIL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// ======================================================================================
// INITIALIZER
// ======================================================================================

module.exports.initializeDutyLogger = function (client) {

    client.on("messageCreate", async (msg) => {

        if (msg.channelId !== DUTY_LOG_CHANNEL_ID) return;
        if (!msg.embeds.length) return;
        if (msg.author.bot && msg.author.id === client.user.id) return;

        const embed = msg.embeds[0];

        if (!embed.title || !embed.title.includes("รายงานเข้าเวร")) return;

        let name, startRaw, endRaw, start, end;

        try {
            name = embed.fields.find(f => f.name === "ชื่อ")?.value || "ไม่ระบุ";
            startRaw = embed.fields.find(f => f.name === "เวลาเข้างาน")?.value;
            endRaw   = embed.fields.find(f => f.name === "เวลาออกงาน")?.value;

            if (!startRaw || !endRaw) {
                console.warn(`⚠️ ข้อมูลไม่ครบของ ${name}`);
                return;
            }

            start = parseThaiDate(startRaw);
            end = parseThaiDate(endRaw);

            if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.error("❌ แปลงเวลาไม่ได้:", startRaw, endRaw);
                return;
            }

            const diffMs = end - start;
            const hours = diffMs / (1000 * 60 * 60);

            if (isNaN(hours)) {
                console.error("❌ คำนวณเวลา Error (NaN)");
                return;
            }

            const weekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
            const dayName = weekdays[start.getDay()];

            await appendToSheet([name, dayName, hours.toFixed(2)]);

            console.log(`✔ ลงข้อมูลสำเร็จ: ${name} | ${dayName} | ${hours.toFixed(2)} ชม.`);

        } catch (err) {
            console.error("=========================================");
            console.error("❌ DUTY LOGGER FATAL ERROR:");
            console.error(`- Name: ${name || 'N/A'}`);
            console.error(`- Raw Start: ${startRaw || 'N/A'}`);
           	console.error(`- Raw End: ${endRaw || 'N/A'}`);
            console.error("- Error Message:", err.message);
            console.error("-----------------------------------------");
            console.error("Stack Trace:", err.stack);
            console.error("=========================================");
        }
    });
};

// ======================================================================================
// FUNCTION: แปลงวันที่ไทย
// ======================================================================================

function parseThaiDate(dateStr) {
    try {
        const parts = dateStr.split(" - ");
        if (parts.length < 2) return null;

        const dateTimeStr = parts[1].trim();
        const [datePart, timePartRaw] = dateTimeStr.split(" ");

        const dateNumbers = datePart.match(/\d+/g);
        const [day, month, year] = dateNumbers.map(Number);

        const timeNumbers = timePartRaw.match(/\d+/g);
        const [hour, minute, second] = timeNumbers.map(Number);

        return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    } catch (e) {
        return null;
    }
}

// ======================================================================================
// FUNCTION: ส่งข้อมูลไป Google Sheets
// ======================================================================================

async function appendToSheet(row) {

    // PRIVATE KEY ต้อง replace \n → newline
    const fixedKey = PRIVATE_KEY.replace(/\\n/g, "\n");

    const auth = new google.auth.JWT(
        CLIENT_EMAIL,
        null,
        fixedKey,
        ["https://www.googleapis.com/auth/spreadsheets"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "DutyLogger",
        valueInputOption: "USER_ENTERED",
        resource: { values: [row] }
    });
}
