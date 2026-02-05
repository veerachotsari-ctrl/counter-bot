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
// 🔍 DEBUGGING LISTENERS (เพิ่มเพื่อเช็คสาเหตุที่ไม่ออนไลน์)
// =========================================================

client.on("debug", (info) => {
    // พ่น log การทำงานภายในออกมา (ถ้าต้องการดูแบบละเอียดมากให้ปลดคอมเมนต์)
    // console.log(`[DEBUG] ${info}`);
});

client.on("error", (error) => {
    console.error("❌ [CLIENT ERROR]:", error);
});

client.on("warn", (info) => {
    console.warn("⚠️ [WARN]:", info);
});

// เช็คการเชื่อมต่อขาดช่วง
client.on("shardDisconnect", (event) => {
    console.error("🔌 [DISCONNECTED]: บอทถูกตัดการเชื่อมต่อ!", event);
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

// ตรวจสอบ Token ก่อนเริ่ม Login
console.log("⚙️ กำลังตรวจสอบความพร้อม...");
if (!token) {
    console.error("❌ [CRITICAL] ไม่พบ Token ใน Environment Variables!");
} else {
    console.log(`🔑 Token พบแล้ว (ความยาว: ${token.length} ตัวอักษร)`);
    console.log("🚀 กำลังพยายาม Login เข้าสู่ Discord...");

    client.login(token)
        .then(() => {
            console.log("✅ [SUCCESS] บอทออนไลน์เรียบร้อยแล้ว!");
            console.log(`🤖 Login ในนาม: ${client.user.tag}`);
            
            // เรียกใช้ Module ต่างๆ
            try {
                initializeWelcomeModule(client);
                initializeCountCase(client, COMMAND_CHANNEL_ID);
                initializeLogListener(client);
                console.log("📦 โหลดโมดูลเสริมทั้งหมดสำเร็จ");
            } catch (modErr) {
                console.error("❌ [MODULE ERROR] เกิดข้อผิดพลาดในการโหลดโมดูล:", modErr);
            }
        })
        .catch(err => {
            console.error("❌ [LOGIN ERROR] ไม่สามารถเชื่อมต่อกับ Discord ได้:");
            // วิเคราะห์ Error ยอดฮิต
            if (err.message.includes("An invalid token was provided")) {
                console.error("👉 สาเหตุ: Token ไม่ถูกต้อง หรือถูก Reset ไปแล้ว");
            } else if (err.message.includes("Privileged intent")) {
                console.error("👉 สาเหตุ: ลืมเปิด Gateway Intents ใน Discord Developer Portal");
            } else {
                console.error("👉 รายละเอียด Error:", err);
            }
        });
}
