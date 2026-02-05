require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");

// ⭐ โหลดโมดูล
const { initializeWelcomeModule } = require('./welcome.js');
const { initializeCountCase } = require('./CountCase.js');
const { saveLog, initializeLogListener } = require("./logtime.js"); 

const COMMAND_CHANNEL_ID = '1433450340564340889';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// =========================================================
// ✨ คำสั่ง /ออกเวร (ยึดตามโครงสร้างที่คุณให้มา)
// =========================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ออกเวร") {
        const name = interaction.options.getString("ชื่อ");
        const time = interaction.options.getString("เวลา");

        await interaction.reply({
            content: `⏳ กำลังบันทึกข้อมูลออกเวรของคุณ (${name})...`,
            ephemeral: true
        });

        setTimeout(async () => {
            try {
                // ส่ง date/id เป็น null ตามที่คุณระบุในคอมเมนต์
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
        }, 0); 
    }
});

// =========================================================
// 🌐 INITIALIZATION & KEEP ALIVE
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server running 5on port 3000."));

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!token) {
    console.error("❌ หา Token ไม่เจอ! เช็คชื่อใน Render Environment ด่วน");
} else {
    client.login(token)
        .then(() => {
            console.log("✅ [SUCCESS] บอทออนไลน์เรียบร้อยแล้ว!");
            
            // เรียกใช้ Module ต่างๆ เมื่อ Login สำเร็จ
            initializeWelcomeModule(client);
            initializeCountCase(client, COMMAND_CHANNEL_ID);
            initializeLogListener(client);
        })
        .catch(err => {
            console.error("❌ [LOGIN ERROR] เข้าสู่ระบบไม่ได้ เพราะ:");
            console.error(err);
        });
}
