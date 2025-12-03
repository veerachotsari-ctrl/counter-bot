// index.js — Main Bot File

require("dotenv").config();
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");

// โหลดโมดูล
const { initializeDutyLogger } = require("./DutyLogger");
const { initializeWelcomeModule } = require("./welcome.js");
const { initializeCountCase } = require("./CountCase.js");

const COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID;

// Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// เมื่อบอทพร้อม
client.once("ready", () => {
    console.log(`🤖 Bot is online as ${client.user.tag}`);

    initializeDutyLogger(client);
    initializeWelcomeModule(client);
    initializeCountCase(client, COMMAND_CHANNEL_ID);
});

// Keep-alive server (Render)
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running.");
}).listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
