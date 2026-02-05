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
// 🔍 SUPER DEBUGGING (เปิด Log ละเอียดที่สุด)
// =========================================================

// ดักฟังทุกอย่างที่ Discord ตอบกลับมา
client.on("debug", (info) => {
    console.log(`[DEBUG] ${info}`);
});

client.on("error", (error) => {
    console.error("❌ [CLIENT ERROR]:", error.message);
    console.error(error);
});

client.on("warn", (info) => {
    console.warn("⚠️ [WARN]:", info);
});

// ดักจับการตัดการเชื่อมต่อ
client.on("shardDisconnect", (event) => {
    console.error("🔌 [DISCONNECTED]: บอทถูกตัดการเชื่อมต่อ!", event.reason || "");
});

// ดักจับการพยายามเชื่อมต่อใหม่
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

console.log("⚙️ เริ่มต้นการวิเคราะห์สถานะ...");

if (!token) {
    console.error("❌ [CRITICAL] ไม่พบ Token! กรุณาเช็ค Environment Variables ใน Render");
} else {
    console.log(`🔑 ตรวจพบ Token (ความยาว: ${token.length} ตัวอักษร)`);
    console.log("🚀 ส่งคำขอ Login ไปยัง Discord Gateway...");

    // ระบบแจ้งเตือนถ้าค้างเกิน 20 วินาที
    const loginTimeout = setTimeout(() => {
        console.log("🕒 [TIMEOUT ALERT]: การ Login ค้างนานเกิน 20 วินาที...");
        console.log("👉 ข้อแนะนำ: ตรวจสอบว่า IP ของ Render โดน Rate Limit หรือไม่ หรือเช็คว่า Intents เปิดครบหรือยัง");
    }, 20000);

    client.login(token)
        .then(() => {
            clearTimeout(loginTimeout);
            console.log("✅ [SUCCESS] Discord ยอมรับการเชื่อมต่อแล้ว!");
            console.log(`🤖 ออนไลน์ในชื่อ: ${client.user.tag}`);
            
            try {
                initializeWelcomeModule(client);
                initializeCountCase(client, COMMAND_CHANNEL_ID);
                initializeLogListener(client);
                console.log("📦 โหลดโมดูลเสริมทั้งหมดเรียบร้อย");
            } catch (modErr) {
                console.error("❌ [MODULE ERROR]:", modErr);
            }
        })
        .catch(err => {
            clearTimeout(loginTimeout);
            console.error("❌ [LOGIN ERROR]: เข้าสู่ระบบไม่สำเร็จ!");
            console.error("รายละเอียด Error:", err.message);
            
            if (err.message.includes("429")) {
                console.error("🆘 ตรวจพบ Error 429: คุณกำลังโดน Rate Limit (IP นี้ถูกแบนชั่วคราว)");
            }
        });
}
