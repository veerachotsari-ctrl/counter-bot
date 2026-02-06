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
// 🔍 ERROR & WARNING HANDLERS (ปิด DEBUG เพื่อความสะอาด)
// =========================================================

// ปิด DEBUG ไปแล้วเพื่อให้ Log ไม่รก
client.on("error", (error) => {
    console.error("❌ [CLIENT ERROR]:", error.message);
});

client.on("warn", (info) => {
    console.warn("⚠️ [WARN]:", info);
});

client.on("shardDisconnect", (event) => {
    console.error("🔌 [DISCONNECTED]: บอทถูกตัดการเชื่อมต่อ!");
});

client.on("shardReconnecting", () => {
    console.log("🔄 [RECONNECTING]: กำลังพยายามเชื่อมต่อใหม่...");
});

// =========================================================
// ✨ คำสั่ง /ออกเวร
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

        try {
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
    }
});

// =========================================================
// 🌐 INITIALIZATION & KEEP ALIVE
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server is ready on port 3000."));

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!token) {
    console.error("❌ [CRITICAL] ไม่พบ Token! กรุณาเช็ค Environment Variables ใน Render");
} else {
    console.log("🚀 กำลังเข้าสู่ระบบ Discord...");

    client.login(token)
        .then(() => {
            console.log("✅ [SUCCESS] บอทออนไลน์เรียบร้อยแล้ว!");
            console.log(`🤖 ออนไลน์ในชื่อ: ${client.user.tag}`);
            
            try {
                initializeWelcomeModule(client);
                initializeCountCase(client, COMMAND_CHANNEL_ID);
                initializeLogListener(client);
                console.log("📦 โหลดโมดูลเสริมสำเร็จ (Ready to Work)");
            } catch (modErr) {
                console.error("❌ [MODULE ERROR]:", modErr);
            }
        })
        .catch(err => {
            console.error("❌ [LOGIN ERROR]: เข้าสู่ระบบไม่สำเร็จ!");
            if (err.message.includes("429")) {
                console.error("🆘 IP โดน Rate Limit (ชั่วคราว)");
            } else {
                console.error("รายละเอียด:", err.message);
            }
        });
}
