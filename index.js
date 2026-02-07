require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

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
// 🔍 ERROR & WARNING HANDLERS
// =========================================================
client.on("error", (error) => console.error("❌ [CLIENT ERROR]:", error.message));
client.on("warn", (info) => console.warn("⚠️ [WARN]:", info));

// =========================================================
// ✨ SLASH COMMANDS REGISTRATION
// =========================================================
const token = process.env.DISCORD_TOKEN || process.env.TOKEN;

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName("ออกเวร")
            .setDescription("บันทึกข้อมูลออกเวร")
            .addStringOption(opt => opt.setName("ชื่อ").setDescription("ชื่อของคุณ").setRequired(true))
            .addStringOption(opt => opt.setName("เวลา").setDescription("เวลาที่ออก").setRequired(true)),
        new SlashCommandBuilder()
            .setName("gocc")
            .setDescription("เรียกปุ่มควบคุมการนับข้อความกลับมา")
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        console.log("⌛ กำลังลงทะเบียน Slash Commands...");
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("✅ ลงทะเบียน Slash Commands สำเร็จ!");
    } catch (error) {
        console.error("❌ Register Commands Error:", error);
    }
}

// =========================================================
// ✨ COMMAND HANDLERS
// =========================================================
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ออกเวร") {
        const name = interaction.options.getString("ชื่อ");
        const time = interaction.options.getString("เวลา");

        await interaction.reply({ content: `⏳ กำลังบันทึกข้อมูลออกเวรของคุณ (${name})...`, ephemeral: true });

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

if (!token) {
    console.error("❌ [CRITICAL] ไม่พบ Token!");
} else {
    console.log("🚀 กำลังเข้าสู่ระบบ Discord...");
    client.login(token)
        .then(async () => {
            console.log(`✅ [SUCCESS] บอทออนไลน์ในชื่อ: ${client.user.tag}`);
            
            await registerCommands(); // ลงทะเบียนคำสั่งเมื่อบอท Online

            try {
                initializeWelcomeModule(client);
                initializeCountCase(client, COMMAND_CHANNEL_ID);
                initializeLogListener(client);
                console.log("📦 โหลดโมดูลเสริมสำเร็จ (Ready to Work)");
            } catch (modErr) {
                console.error("❌ [MODULE ERROR]:", modErr);
            }
        })
        .catch(err => console.error("❌ [LOGIN ERROR]:", err.message));
}
