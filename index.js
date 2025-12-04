// index.js (ไฟล์หลัก)

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
        GatewayIntentBits.GuildPresences,
    ],
});

// ⭐ เรียกใช้โมดูล
initializeWelcomeModule(client);
initializeCountCase(client, COMMAND_CHANNEL_ID);

// ⭐ เปิดระบบจับข้อความในห้อง log
initializeLogListener(client);

// =========================================================
// ✨ คำสั่ง /ออกเวร
// =========================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ออกเวร") {

        const name = interaction.options.getString("ชื่อ");
        const time = interaction.options.getString("เวลา");

        await interaction.reply({
            content: `กำลังบันทึกข้อมูล...`,
            ephemeral: true
        });

        const ok = await saveLog(name, time);

        if (ok) {
            await interaction.editReply(`✔ บันทึกแล้ว\n**ชื่อ:** ${name}\n**เวลา:** ${time}`);
        } else {
            await interaction.editReply("❌ บันทึกไม่สำเร็จ (Google Sheets ไม่ตอบสนอง)");
        }
    }
});

// =========================================================
// 🌐 KEEP ALIVE
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server running on port 3000."));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
