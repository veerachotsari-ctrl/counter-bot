// ==============================
// index.js (FULL + /gocc)
// ==============================

require("dotenv").config();

const http = require("http");

const { Client, GatewayIntentBits } = require("discord.js");

const {
    initializeCountCase,
    getStartCountMessage
} = require("./CountCase");

// -----------------------------

const COMMAND_CHANNEL_ID = "1433450340564340889";

// -----------------------------

const client = new Client({

    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],

});

// ------------------------------------------------
// SLASH COMMAND
// ------------------------------------------------

client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // ======================
    // /gocc
    // ======================
    if (interaction.commandName === "gocc") {

        await interaction.reply({
            content: "✅ เรียกแผงควบคุมแล้ว",
            ephemeral: true
        });

        try {

            const channel =
                await client.channels.fetch(COMMAND_CHANNEL_ID);

            if (channel && channel.isTextBased()) {

                await channel.send(
                    getStartCountMessage()
                );
            }

        } catch (err) {
            console.error("/gocc error:", err);
        }

        return;
    }

});

// ------------------------------------------------
// KEEP ALIVE
// ------------------------------------------------

http.createServer((req, res) => {

    res.writeHead(200, {
        "Content-Type": "text/plain"
    });

    res.end("Bot Alive");

}).listen(3000);

// ------------------------------------------------
// LOGIN
// ------------------------------------------------

const token = process.env.DISCORD_TOKEN;

if (!token) {

    console.log("❌ No Token");

} else {

    client.login(token).then(() => {

        console.log("🤖 Bot Online");

        initializeCountCase(
            client,
            COMMAND_CHANNEL_ID
        );

    });

}
