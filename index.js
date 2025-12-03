// index.js (ไฟล์หลัก)

require("dotenv").config();
const fs = require("fs");
const http = require("http");
const {
    Client,
    GatewayIntentBits
} = require("discord.js");

// ⭐️ โหลดโมดูลที่แยกออกมา
const { initializeWelcomeModule } = require('./welcome.js');
const { initializeCountCase } = require('./CountCase.js');
// 🌟 เพิ่มโมดูลใหม่สำหรับบันทึกเวลาเข้าเวร
const { initializeShiftReportSaver } = require('./ShiftReportSaver.js'); 

// =========================================================
// 🌐 CONFIG & INITIALIZATION
// =========================================================

// ใช้ค่าจาก Environment Variables
const COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID || '1433450340564340889';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // สำคัญมากสำหรับการอ่านข้อความ
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildPresences, 
    ],
});

// ⭐️ เรียกใช้โมดูลทั้งหมด
initializeWelcomeModule(client);
initializeCountCase(client, COMMAND_CHANNEL_ID); 
// 🌟 เรียกใช้โมดูลใหม่ของคุณ
initializeShiftReportSaver(client); 

// =========================================================
// 🌐 KEEP-ALIVE SERVER & LOGIN
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(process.env.PORT || 3000, () => console.log("🌐 Web server running."));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
