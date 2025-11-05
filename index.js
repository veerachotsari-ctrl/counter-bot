const {
    Client,
    GatewayIntentBits,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
} = require("discord.js");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const http = require("http");

// =========================================================
// CONFIG (ใช้ ENV ทั้งหมด)
// =========================================================
const PORT = process.env.PORT || 3000;

const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

let CONFIG = {
    COMMAND_CHANNEL_ID: process.env.COMMAND_CHANNEL_ID || "0",
    SPREADSHEET_ID: process.env.SPREADSHEET_ID || "",
    SHEET_NAME: process.env.SHEET_NAME || "Sheet1",
    CHANNEL_IDS: [...new Set( // ลบช่องซ้ำอัตโนมัติ
        (process.env.CHANNEL_IDS || "")
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 10 && !isNaN(id))
    )],
    BATCH_DELAY: parseInt(process.env.BATCH_DELAY || "500"),
    WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID || "0",
};

// =========================================================
// GOOGLE SHEETS SETUP
// =========================================================
if (!credentials.client_email || !credentials.private_key) {
    console.error("❌ Missing Google credentials (CLIENT_EMAIL/PRIVATE_KEY).");
    process.exit(1);
}

const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const gsapi = google.sheets({ version: "v4", auth });

// =========================================================
// DISCORD CLIENT
// =========================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// =========================================================
// GOOGLE SHEET HELPERS
// =========================================================
async function batchUpdateWithRetry(requestBody, attempt = 1) {
    try {
        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody,
        });
    } catch (error) {
        if (error.code === 429 && attempt <= 3) {
            console.warn(`⚠️ Rate limited (attempt ${attempt}), retrying...`);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
            return batchUpdateWithRetry(requestBody, attempt + 1);
        }
        throw error;
    }
}

async function clearCountsOnly() {
    const lastCol = String.fromCharCode(65 + 2 + CONFIG.CHANNEL_IDS.length - 1);
    const range = `${CONFIG.SHEET_NAME}!C4:${lastCol}`;
    await gsapi.spreadsheets.values.clear({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range,
    });
    console.log(`✅ Cleared counts: ${range}`);
}

// =========================================================
// COUNTING FUNCTIONS
// =========================================================
async function processMessagesBatch(messages, channelIndex) {
    const batchMap = new Map();
    const userCache = new Map();

    for (const msg of messages) {
        if (msg.author.bot) continue;
        if (!msg.content.includes("<@")) continue;

        const mentionRegex = /<@!?(\d+)>/g;
        let match;
        while ((match = mentionRegex.exec(msg.content)) !== null) {
            const id = match[1];
            if (userCache.has(id)) continue; // ป้องกันนับซ้ำในข้อความเดียว

            try {
                const user = await client.users.fetch(id);
                batchMap.set(id, (batchMap.get(id) || 0) + 1);
                userCache.set(id, true);
            } catch {}
        }
    }

    if (batchMap.size > 0) {
        await updateSheetCounts(batchMap, channelIndex);
    }
}

async function updateSheetCounts(batchMap, channelIndex) {
    const sheet = CONFIG.SHEET_NAME;
    const range = `${sheet}!A4:Z`;
    const res = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range,
    });

    const rows = res.data.values || [];
    const userIdCol = 1;
    const colIndex = 2 + channelIndex;
    const colLetter = String.fromCharCode(65 + colIndex);
    const updates = [];

    for (const [userId, count] of batchMap.entries()) {
        let rowIndex = rows.findIndex((r) => r[userIdCol] === userId);
        if (rowIndex >= 0) {
            const sheetRow = 4 + rowIndex;
            const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
            const newValue = currentValue + count;
            updates.push({
                range: `${sheet}!${colLetter}${sheetRow}`,
                values: [[newValue]],
            });
            rows[rowIndex][colIndex] = String(newValue);
        } else {
            const newRow = ["Unknown", userId, ...Array(CONFIG.CHANNEL_IDS.length).fill("0")];
            newRow[colIndex] = count.toString();
            const appendRow = 4 + rows.length;
            updates.push({
                range: `${sheet}!A${appendRow}:${colLetter}${appendRow}`,
                values: [newRow],
            });
            rows.push(newRow);
        }
    }

    if (updates.length > 0) {
        await batchUpdateWithRetry({
            valueInputOption: "RAW",
            data: updates,
        });
    }

    await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY));
}

async function processOldMessages(channelId, index) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.log(`⚠️ Channel ${channelId} not found.`);
        let lastId = null;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            await processMessagesBatch([...messages.values()], index);
            lastId = messages.last().id;
        }

        console.log(`✅ Done counting in #${channel.name}`);
    } catch (err) {
        console.error(`❌ Channel ${channelId} error:`, err.message);
    }
}

// =========================================================
// WELCOME / FAREWELL
// =========================================================
client.on("guildMemberAdd", (member) => {
    const channel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    setTimeout(() => {
        const embed = new EmbedBuilder()
            .setColor("#00ff99")
            .setTitle(`🎉 ยินดีต้อนรับ ${member.displayName}!`)
            .setDescription(`# สวัสดีครับ ยินดีต้อนรับเข้าสู่ ${member.guild.name}`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setTimestamp();

        channel.send({ embeds: [embed] }).catch(() => {});
    }, 2000);
});

client.on("guildMemberRemove", (member) => {
    const channel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
        .setColor("#ff5555")
        .setTitle(`😢 ${member.user.tag} ออกจากเซิร์ฟเวอร์แล้ว`)
        .setDescription(`# หวังว่าจะได้เจอกันอีกนะ ${member.displayName || member.user.username}`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTimestamp();

    channel.send({ embeds: [embed] }).catch(() => {});
});

// =========================================================
// BOT READY + COMMAND UI
// =========================================================
client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const cmdChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID).catch(() => {});
    if (!cmdChannel?.isTextBased()) return;

    await cmdChannel.send({
        content: `✅ Bot พร้อมทำงานแล้ว\n\n> Sheet: **${CONFIG.SPREADSHEET_ID}**\n> Channels: ${CONFIG.CHANNEL_IDS.map(id => `<#${id}>`).join(", ")}`,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("count").setLabel("⭐ เริ่มนับข้อความเก่า").setStyle(ButtonStyle.Primary)
            ),
        ],
    });
});

client.on(Events.InteractionCreate, async (i) => {
    if (i.isButton() && i.customId === "count") {
        await i.deferReply();
        await clearCountsOnly();
        for (let x = 0; x < CONFIG.CHANNEL_IDS.length; x++) {
            await processOldMessages(CONFIG.CHANNEL_IDS[x], x);
        }
        await i.editReply("✅ การนับเสร็จสมบูรณ์!");
    }
});

// =========================================================
// KEEP-ALIVE + LOGIN
// =========================================================
http.createServer((req, res) => {
    res.writeHead(200);
    res.end("✅ Bot is alive!");
}).listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
