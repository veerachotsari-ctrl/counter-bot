require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { 
    Client, 
    GatewayIntentBits, 
    Events, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits 
} = require("discord.js");

// ⭐ โหลดโมดูล
const { initializeWelcomeModule } = require('./welcome.js');
const { initializeCountCase, sendControlPanel } = require('./CountCase.js'); // ดึงฟังก์ชัน sendControlPanel มาด้วย
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
// 🚀 REGISTER SLASH COMMANDS
// =========================================================

const commands = [
    // คำสั่ง /ออกเวร
    new SlashCommandBuilder()
        .setName('ออกเวร')
        .setDescription('บันทึกเวลาออกเวรลง Google Sheets')
        .addStringOption(option => 
            option.setName('ชื่อ').setDescription('ชื่อของคุณ').setRequired(true))
        .addStringOption(option => 
            option.setName('เวลา').setDescription('ระบุเวลา (เช่น 18:00)').setRequired(true)),
    
    // คำสั่ง /gocc (สำหรับเรียกแผงควบคุมการนับเคส)
    new SlashCommandBuilder()
        .setName('gocc')
        .setDescription('เรียกแผงควบคุมการนับเคส (Control Panel)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    // คำสั่งสำหรับ Welcome Module (ถ้ามีใน welcome.js)
    new SlashCommandBuilder()
        .setName('welcome_status')
        .setDescription('ตรวจสอบสถานะระบบต้อนรับ'),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || process.env.TOKEN);

async function registerCommands() {
    try {
        console.log('⏳ กำลังอัปเดต Slash Commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('✅ อัปเดต Slash Commands สำเร็จ!');
    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาดในการ Register Commands:', error);
    }
}

// =========================================================
// 🔍 ERROR & WARNING HANDLERS
// =========================================================

client.on("error", (error) => console.error("❌ [CLIENT ERROR]:", error.message));
client.on("warn", (info) => console.warn("⚠️ [WARN]:", info));
client.on("shardDisconnect", () => console.error("🔌 [DISCONNECTED]: บอทถูกตัดการเชื่อมต่อ!"));
client.on("shardReconnecting", () => console.log("🔄 [RECONNECTING]: กำลังพยายามเชื่อมต่อใหม่..."));

// =========================================================
// ✨ INTERACTION HANDLER (จัดการคำสั่ง /)
// =========================================================

client.on(Events.InteractionCreate, async interaction => {
    // 1. จัดการ Slash Commands
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // --- คำสั่ง /ออกเวร ---
        if (commandName === "ออกเวร") {
            const name = interaction.options.getString("ชื่อ");
            const time = interaction.options.getString("เวลา");

            await interaction.reply({
                content: `⏳ กำลังบันทึกข้อมูลออกเวรของคุณ (${name})...`,
                ephemeral: true
            });

            try {
                const ok = await saveLog(name, null, time, null); 
                if (ok) {
                    await interaction.editReply(`✔ บันทึกเรียบร้อยแล้ว\n**ชื่อ:** ${name}\n**เวลา:** ${time}`);
                } else {
                    await interaction.editReply("❌ บันทึกไม่สำเร็จ (Google Sheets ไม่ตอบสนอง)");
                }
            } catch (err) {
                console.error("❌ Error in /ออกเวร:", err);
                await interaction.editReply("❌ เกิดข้อผิดพลาดภายในระบบ");
            }
        }

        // --- คำสั่ง /gocc ---
        if (commandName === "gocc") {
            try {
                await sendControlPanel(interaction);
            } catch (err) {
                console.error("❌ Error in /gocc:", err);
                await interaction.reply({ content: "❌ ไม่สามารถส่งแผงควบคุมได้", ephemeral: true });
            }
        }
    }
});

// =========================================================
// 🌐 INITIALIZATION & LOGIN
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server is ready on port 3000."));

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!token) {
    console.error("❌ [CRITICAL] ไม่พบ Token ใน Environment Variables!");
} else {
    console.log("🚀 กำลังเข้าสู่ระบบ Discord...");

    client.login(token)
        .then(() => {
            console.log(`✅ [SUCCESS] บอทออนไลน์ในชื่อ: ${client.user.tag}`);
            
            // ลงทะเบียนคำสั่ง Slash Commands
            registerCommands();

            try {
                // เริ่มทำงานโมดูลต่างๆ
                initializeWelcomeModule(client);
                initializeCountCase(client, COMMAND_CHANNEL_ID);
                initializeLogListener(client);
                console.log("📦 โหลดโมดูลเสริมทั้งหมดสำเร็จ");
            } catch (modErr) {
                console.error("❌ [MODULE ERROR]:", modErr);
            }
        })
        .catch(err => {
            console.error("❌ [LOGIN ERROR]:", err.message);
            if (err.message.includes("429")) console.error("🆘 โดน Rate Limit!");
        });
}
