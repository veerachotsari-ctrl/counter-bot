// index.js (ไฟล์หลัก - ปรับปรุงความเสถียรของ Event Loop)

require("dotenv").config();
const fs = require("fs");
const http = require("http");
const {
    Client,
    GatewayIntentBits
} = require("discord.js");

// ⭐ โหลดโมดูล
const { initializeWelcomeModule } = require('./welcome.js');
const { initializeCountCase } = require('./CountCase.js');

// ⭐ โหลดระบบ LogTime
// ต้องโหลด saveLog มาใช้ในคำสั่ง /ออกเวร ด้วย
const { saveLog, initializeLogListener } = require("./logtime.js"); 

// =========================================================
// 🌐 CONFIG & INITIALIZATION
// =========================================================

const COMMAND_CHANNEL_ID = '1433450340564340889';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        // GuildPresences ถูกลบออกหากไม่จำเป็น เพื่อประหยัดทรัพยากร
    ],
});

// ⭐ เรียกใช้โมดูล
initializeWelcomeModule(client);
initializeCountCase(client, COMMAND_CHANNEL_ID);

// ⭐ เปิดระบบจับข้อความในห้อง log
initializeLogListener(client);

// =========================================================
// ✨ คำสั่ง /ออกเวร (ปรับปรุง: เลื่อนงานหนักไปทำทีหลัง)
// =========================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ออกเวร") {

        const name = interaction.options.getString("ชื่อ");
        const time = interaction.options.getString("เวลา");

        // 1. Reply ทันที (Deferral) เพื่อบอก Discord ว่าได้รับคำสั่งแล้ว
        await interaction.reply({
            content: `⏳ กำลังบันทึกข้อมูลออกเวรของคุณ (${name})...`,
            ephemeral: true
        });

        // 2. เลื่อนงานหนัก (I/O call to Google Sheets) ออกไปจาก Event Loop หลัก
        //    วิธีนี้ช่วยให้บอทไม่ "ค้าง" ระหว่างรอ API ตอบกลับ
        setTimeout(async () => {
            try {
                // saveLog(name, date, time, id); -> date/id เป็น null
                // ต้องส่ง date เป็น null เพราะคำสั่ง /ออกเวร ไม่มี date
                const ok = await saveLog(name, null, time, null); 

                if (ok) {
                    await interaction.editReply(`✔ บันทึกแล้ว\n**ชื่อ:** ${name}\n**เวลา:** ${time}`);
                } else {
                    await interaction.editReply("❌ บันทึกไม่สำเร็จ (Google Sheets ไม่ตอบสนอง)");
                }
            } catch (err) {
                console.error("❌ Error in /ออกเวร:", err);
                await interaction.editReply("❌ บันทึกไม่สำเร็จ: เกิดข้อผิดพลาดภายใน");
            }
        }, 0); // ใส่ 0 เพื่อให้รันใน Tick ถัดไป
    }
});

// =========================================================
// 🌐 KEEP ALIVE
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server running on port 3000."));

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!token) {
    console.error("❌ หา Token ไม่เจอ! เช็คชื่อใน Render Environment ด่วน");
} else {
    client.login(token)
        .then(() => console.log("✅ [SUCCESS] บอทออนไลน์เรียบร้อยแล้ว!"))
        .catch(err => {
            console.error("❌ [LOGIN ERROR] เข้าสู่ระบบไม่ได้ เพราะ:");
            console.error(err);
        });
}
