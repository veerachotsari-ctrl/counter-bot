// index.js (ไฟล์หลัก - เป็นตัวเชื่อมต่อเท่านั้น)

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

// =========================================================
// 🌐 CONFIG & INITIALIZATION
// =========================================================

// ⚠️ กำหนด Channel ID สำหรับส่งปุ่มควบคุมที่นี่
const COMMAND_CHANNEL_ID = '1433450340564340889'; 

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,   
        GatewayIntentBits.GuildPresences, 
        GatewayIntentBits.GuildMembers, 
    ],
});

// ⭐️ เรียกใช้โมดูลทั้งหมด โดยส่ง Channel ID ที่ต้องการไปด้วย
initializeWelcomeModule(client);
initializeCountCase(client, COMMAND_CHANNEL_ID); 

// =========================================================
// 🌐 KEEP-ALIVE SERVER & LOGIN
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server running on port 3000."));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
