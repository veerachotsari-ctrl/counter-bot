// index.js (ไฟล์หลัก - เป็นตัวเชื่อมต่อเท่านั้น)

require("dotenv").config();
const fs = require("fs"); // ยังคงใช้ fs สำหรับ config.json
const http = require("http");
const { 
    Client, 
    GatewayIntentBits 
} = require("discord.js"); // 🗑️ ลบ Components ที่ไม่จำเป็นออก

// ⭐️ โหลดโมดูลที่แยกออกมา
const { initializeWelcomeModule } = require('./welcome.js'); 
const { initializeCountCase } = require('./CountCase.js'); 

// =========================================================
// 🌐 INITIALIZATION & SETUP (เหลือแค่ส่วน Discord Client)
// =========================================================

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildPresences, // สำหรับ status/Welcome
        GatewayIntentBits.GuildMembers,   // สำหรับ welcome/fetch members
    ],
});

// ⭐️ เรียกใช้โมดูลทั้งหมด
initializeWelcomeModule(client);
initializeCountCase(client); 

// =========================================================
// 🌐 KEEP-ALIVE SERVER & LOGIN
// =========================================================

// โค้ดส่วนนี้ยังคงเดิม
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server running on port 3000."));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
