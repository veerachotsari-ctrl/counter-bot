require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");

// ⭐ โหลดโมดูล
const { initializeWelcomeModule } = require('./welcome.js');
const { initializeCountCase, sendStartButton } = require('./CountCase.js'); // ดึงฟังก์ชันเพิ่ม
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
// ✨ การลงทะเบียน Slash Commands
// =========================================================
const commands = [
    {
        name: 'นับเคส',
        description: 'เรียกปุ่มกดสำหรับเริ่มนับเคสเข้าห้องนี้',
    },
    {
        name: 'ออกเวร',
        description: 'เช็คเอาท์และสรุปเวลาทำงาน',
    }
];

// =========================================================
// 🔍 INTERACTION HANDLER
// =========================================================
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // คำสั่ง /นับเคส
    if (interaction.commandName === 'นับเคส') {
        try {
            await sendStartButton(interaction);
        } catch (error) {
            console.error("❌ Error /นับเคส:", error);
            if (!interaction.replied) await interaction.reply({ content: 'เกิดข้อผิดพลาดในการเรียกปุ่ม', ephemeral: true });
        }
    }

    // คำสั่ง /ออกเวร (โค้ดเดิมของคุณ)
    if (interaction.commandName === 'ออกเวร') {
        // ... ใส่ Logic ออกเวรเดิมของคุณตรงนี้ ...
        await interaction.reply({ content: "กำลังบันทึกเวลาออกเวร...", ephemeral: true });
    }
});

// =========================================================
// 🌐 INITIALIZATION & LOGIN
// =========================================================
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive!");
}).listen(3000);

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (token) {
    client.login(token).then(async () => {
        console.log(`✅ บอทออนไลน์: ${client.user.tag}`);

        // ลงทะเบียน Slash Commands กับ Discord API
        const rest = new REST({ version: '10' }).setToken(token);
        try {
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error(error);
        }

        initializeWelcomeModule(client);
        initializeCountCase(client, COMMAND_CHANNEL_ID);
        initializeLogListener(client);
    });
}
