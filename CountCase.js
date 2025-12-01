// CountCase.js
const fs = require("fs");
const { 
    Events, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    MessageFlags 
} = require("discord.js");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// =============================
// GOOGLE AUTH
// =============================
const jwtClient = new JWT({
    email: process.env.CLIENT_EMAIL,
    key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: jwtClient });

// =============================
// CONFIG
// =============================
const CONFIG_FILE = "config.json";
const MAX_CHANNELS = 3;
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";
const STARTING_ROW = 4;

let CONFIG = {};

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE);
        CONFIG = JSON.parse(data);
    } catch {
        CONFIG = {
            SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
            SHEET_NAME: process.env.SHEET_NAME || 'Sheet1',
            CHANNEL_IDS: [],
            BATCH_DELAY: 150,
            COMMAND_CHANNEL_ID: process.env.COMMAND_CHANNEL_ID || '0'
        };
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 4));
    } catch (e) {
        console.error("❌ Error saving config:", e);
    }
}

loadConfig();

// =============================
// RATE LIMIT AWARE FETCH
// =============================
async function safeFetch(channel, opts) {
    try {
        return await channel.messages.fetch(opts);
    } catch (e) {
        if (e.status === 429) {
            const wait = (e.retry_after || 1) * 1000;
            console.log(`[RATE LIMIT] wait ${wait}ms`);
            await new Promise(r => setTimeout(r, wait));
            return safeFetch(channel, opts);
        }
        throw e;
    }
}

// =============================
// GOOGLE SHEETS FUNCTIONS
// =============================
async function clearCountsOnly() {
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:F`;
    await sheets.spreadsheets.values.clear({ spreadsheetId: CONFIG.SPREADSHEET_ID, range });
}

async function batchUpdateMentions(batchMap, channelIndex, userPostCountMap=null) {
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${String.fromCharCode(65 + 1 + channelCount)}`;

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange
    });
    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));

    const updates = [];

    const colIndex = 2 + channelIndex; // C, D, F
    const colLetter = String.fromCharCode(65 + colIndex);

    for (const [key, count] of batchMap.entries()) {
        const [displayName, username] = key.split("|");

        let rowIndex = rows.findIndex(r => r[0] === displayName && r[1] === username);

        if (rowIndex >= 0) {
            const sheetRowIndex = STARTING_ROW + rowIndex;
            const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
            const newCount = currentValue + count;
            updates.push({
                range: `${CONFIG.SHEET_NAME}!${colLetter}${sheetRowIndex}`,
                values: [[newCount]]
            });
            rows[rowIndex][colIndex] = String(newCount);
        } else {
            const appendRow = STARTING_ROW + rows.length;
            const newRow = [displayName, username, ...Array(channelCount).fill("0")];
            newRow[colIndex] = count;
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${String.fromCharCode(65 + 1 + channelCount)}${appendRow}`,
                values: [newRow]
            });
            rows.push(newRow);
        }
    }

    // นับผู้โพสของ channel 2 → ลงช่อง E (index 4)
    if (userPostCountMap) {
        for (const [key, count] of userPostCountMap.entries()) {
            const [displayName, username] = key.split("|");
            let rowIndex = rows.findIndex(r => r[0] === displayName && r[1] === username);
            const colLetterPost = 'E';
            if (rowIndex >= 0) {
                const sheetRowIndex = STARTING_ROW + rowIndex;
                const currentValue = parseInt(rows[rowIndex][4] || "0");
                const newCount = currentValue + count;
                updates.push({
                    range: `${CONFIG.SHEET_NAME}!${colLetterPost}${sheetRowIndex}`,
                    values: [[newCount]]
                });
                rows[rowIndex][4] = String(newCount);
            } else {
                const appendRow = STARTING_ROW + rows.length;
                const newRow = [displayName, username, "0", "0", count, "0"];
                updates.push({
                    range: `${CONFIG.SHEET_NAME}!A${appendRow}:F${appendRow}`,
                    values: [newRow]
                });
                rows.push(newRow);
            }
        }
    }

    if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: { valueInputOption: "RAW", data: updates.map(u => ({ range: u.range, values: u.values })) }
        });
    }

    await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
}

// =============================
// PROCESS MESSAGES
// =============================
async function processMessagesBatch(client, messages, channelIndex) {
    const batchMap = new Map();
    const userCache = new Map();

    // สำหรับ channel 2
    let userPostCountMap = channelIndex === 1 ? new Map() : null;

    for (const message of messages) {
        if (message.author.bot) continue;
        if (!message.content.includes("<@") && channelIndex !==1) continue;

        const uniqueMentionedIds = new Set();
        const mentionRegex = /<@!?(\d+)>/g;
        let match;
        while ((match = mentionRegex.exec(message.content)) !== null) {
            uniqueMentionedIds.add(match[1]);
        }

        for (const id of uniqueMentionedIds) {
            let displayName, username;
            if (userCache.has(id)) {
                ({ displayName, username } = userCache.get(id));
            } else {
                try {
                    const guild = messages[0].guild;
                    const member = guild ? await guild.members.fetch(id) : null;
                    if (member) {
                        displayName = member.displayName;
                        username = member.user.username;
                    } else {
                        const user = await client.users.fetch(id);
                        displayName = user.username;
                        username = user.username;
                    }
                } catch {
                    continue;
                }
                userCache.set(id, { displayName, username });
            }
            const key = `${displayName}|${username}`;
            batchMap.set(key, (batchMap.get(key) || 0) + 1);
        }

        // นับผู้โพสของ channel 2
        if (userPostCountMap) {
            const author = message.author;
            const key = `${author.username}|${author.username}`;
            userPostCountMap.set(key, (userPostCountMap.get(key) || 0) + 1);
        }
    }

    await batchUpdateMentions(batchMap, channelIndex, userPostCountMap);
}

async function processOldMessages(client, channelId, channelIndex) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        let lastId = null;
        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const messages = await safeFetch(channel, options);
            if (messages.size === 0) break;
            await processMessagesBatch(client, [...messages.values()], channelIndex);
            lastId = messages.last().id;
            await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
        }
    } catch (e) {
        console.error(`❌ Error processing channel ${channelId}:`, e.message);
    }
}

// =============================
// DISCORD UI
// =============================
function getStartCountMessage() {
    const validChannelIds = CONFIG.CHANNEL_IDS.filter(id => id && id.length>10 && !isNaN(id));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(COUNT_BUTTON_ID)
            .setLabel("⭐ เริ่มนับข้อความเก่า")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(CONFIG_BUTTON_ID)
            .setLabel("⚙️ ตั้งค่า Sheet/Channel")
            .setStyle(ButtonStyle.Secondary)
    );
    const channelList = validChannelIds.map(id=>`- <#${id}>`).join("\n")||'- ยังไม่มีช่อง -';
    return {
        content: `⚠️ สถานะปัจจุบัน (ดึงจาก config.json):\n> Sheet ID: **${CONFIG.SPREADSHEET_ID || 'ไม่ได้ตั้งค่า'}**\n> Sheet Name: **${CONFIG.SHEET_NAME || 'ไม่ได้ตั้งค่า'}**\n> Batch Delay: **${CONFIG.BATCH_DELAY}ms**\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS} แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`,
        components: [row]
    };
}

// =============================
// MODULE INIT
// =============================
function initializeCountCase(client, commandChannelId) {
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;

    client.once(Events.ClientReady, async () => {
        try {
            const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
            if (commandChannel && commandChannel.isTextBased()) {
                const messages = await commandChannel.messages.fetch({ limit: 5 });
                const existingControlMessage = messages.find(m =>
                    m.components.length > 0 &&
                    m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID)
                );
                if (existingControlMessage) {
                    await existingControlMessage.edit(getStartCountMessage());
                } else {
                    await commandChannel.send(getStartCountMessage());
                }
            }
        } catch (e) {
            console.error("❌ Error sending control buttons:", e);
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || CONFIG.CHANNEL_IDS.length === 0) {
                return await interaction.editReply({
                    content: "❌ การตั้งค่าไม่สมบูรณ์!",
                    flags: MessageFlags.Ephemeral
                });
            }
            await interaction.editReply("⏳ กำลังล้างข้อมูลและนับข้อความเก่า...");
            await clearCountsOnly();
            for (let i=0;i<CONFIG.CHANNEL_IDS.length;i++){
                await processOldMessages(client, CONFIG.CHANNEL_IDS[i], i);
            }
            await interaction.editReply({content:"🎉 การนับข้อความเสร็จแล้ว!", components:[]});
            await new Promise(r=>setTimeout(r,5000));
            await interaction.deleteReply().catch(()=>{});
        }
    });
}

module.exports = { initializeCountCase };
