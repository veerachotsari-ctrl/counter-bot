// CountCase.js (โมดูลจัดการการนับสถิติและการตั้งค่า - ฉบับเต็ม)

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

// ---------------------------------------------------------
// 1. GOOGLE AUTH SETUP
// ---------------------------------------------------------
const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null,
};
if (!credentials.client_email || !credentials.private_key) {
    console.warn("⚠️ Google Sheets credentials not fully loaded from environment variables.");
}

const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const gsapi = google.sheets({ version: "v4", auth });

// ---------------------------------------------------------
// 2. CONFIG, CONSTANTS & INITIALIZATION
// ---------------------------------------------------------
const MAX_CHANNELS = 3;
let CONFIG = {};
const CONFIG_FILE = "config.json";
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";
const STARTING_ROW = 4;

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE);
        CONFIG = JSON.parse(data);
        console.log("✅ Loaded configuration from config.json.");
    } catch (e) {
        console.error("❌ Failed to load config.json, using defaults.");
        CONFIG = {
            SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
            SHEET_NAME: process.env.SHEET_NAME || 'Sheet1',
            CHANNEL_IDS: [],
            BATCH_DELAY: 150,
            UPDATE_DELAY: 50,
        };
    }
}

function saveConfig() {
    const savableConfig = {
        SPREADSHEET_ID: CONFIG.SPREADSHEET_ID,
        SHEET_NAME: CONFIG.SHEET_NAME,
        CHANNEL_IDS: CONFIG.CHANNEL_IDS,
        BATCH_DELAY: CONFIG.BATCH_DELAY,
        UPDATE_DELAY: CONFIG.UPDATE_DELAY,
    };
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(savableConfig, null, 4));
        console.log("✅ Configuration saved to config.json.");
    } catch(e) {
        console.error("❌ Error writing config.json:", e.message);
    }
}

loadConfig();

// ---------------------------------------------------------
// 3. GOOGLE SHEET FUNCTIONS
// ---------------------------------------------------------
async function clearCountsOnly() {
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:F`;
    try {
        await gsapi.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range,
        });
        console.log("✅ Cleared columns C–F (from row 4 down).");
    } catch (error) {
        console.error("❌ Error clearing counts:", error);
        throw error;
    }
}

async function batchUpdateMentions(batchMap, colIndex) {
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const lastCol = String.fromCharCode(65 + 1 + channelCount); // A + B + channels
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${lastCol}`;

    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });

    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));

    const updates = [];

    for (const [key, count] of batchMap.entries()) {
        const [displayName, username] = key.split("|");

        let rowIndex = rows.findIndex(
            (r) => r[0] === displayName && r[1] === username,
        );

        if (rowIndex >= 0) {
            const sheetRowIndex = STARTING_ROW + rowIndex;
            const colLetter = String.fromCharCode(65 + colIndex);
            const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
            const newCount = currentValue + count;

            updates.push({
                range: `${CONFIG.SHEET_NAME}!${colLetter}${sheetRowIndex}`,
                values: [[newCount]],
            });

            rows[rowIndex][colIndex] = String(newCount);
        } else {
            const appendRow = STARTING_ROW + rows.length;
            const newRow = [displayName, username, ...Array(channelCount).fill(0).map(String)];
            newRow[colIndex] = count;

            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${lastCol}${appendRow}`,
                values: [newRow],
            });
            rows.push(newRow);
        }
    }

    if (updates.length > 0) {
        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: {
                valueInputOption: "RAW",
                data: updates.map(u => ({ range: u.range, values: u.values })),
            }
        });
    }

    await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY));
}

// ---------------------------------------------------------
// 4. DISCORD MESSAGE PROCESSING
// ---------------------------------------------------------
async function processMessagesBatch(client, messages, channelIndex) {
    const batchMap = new Map(); // สำหรับแท็กปกติ
    const posterMap = new Map(); // สำหรับนับผู้โพสของช่องที่ 2 → E
    const userCache = new Map();

    for (const message of messages) {
        if (message.author.bot) continue;
        if (!message.content.includes("<@")) continue;

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

        if (channelIndex === 1) {
            const posterKey = `${message.member?.displayName || message.author.username}|${message.author.username}`;
            posterMap.set(posterKey, (posterMap.get(posterKey) || 0) + 1);
        }
    }

    if (batchMap.size > 0) {
        await batchUpdateMentions(batchMap, channelIndex); // C,D,F
    }

    if (channelIndex === 1 && posterMap.size > 0) {
        await batchUpdateMentions(posterMap, 2); // E
    }
}

async function processOldMessages(client, channelId, channelIndex) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.log(`❌ Channel ${channelId} not found. Skipping.`);

        let lastId = null;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            await processMessagesBatch(client, [...messages.values()], channelIndex);
            lastId = messages.last().id;
            await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY));
        }

        console.log(`✅ Finished processing old messages for channel ${channelId}`);
    } catch (error) {
        console.error(`❌ Error processing channel ${channelId}:`, error.message);
    }
}

// ---------------------------------------------------------
// 5. MODULE INITIALIZATION
// ---------------------------------------------------------
function getStartCountMessage() {
    const validChannelIds = CONFIG.CHANNEL_IDS.filter(id => id && id.length > 10 && !isNaN(id));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(COUNT_BUTTON_ID)
            .setLabel("⭐ เริ่มนับข้อความเก่า")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(CONFIG_BUTTON_ID)
            .setLabel("⚙️ ตั้งค่า Sheet/Channel")
            .setStyle(ButtonStyle.Secondary),
    );

    const channelList = validChannelIds.map(id => `- <#${id}>`).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';

    return {
        content: `⚠️ สถานะปัจจุบัน:\n> Sheet ID: **${CONFIG.SPREADSHEET_ID || 'ไม่ได้ตั้งค่า'}**\n> Sheet Name: **${CONFIG.SHEET_NAME || 'ไม่ได้ตั้งค่า'}**\n> Batch Delay: **${CONFIG.BATCH_DELAY}ms**\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS} แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`,
        components: [row],
    };
}

function initializeCountCase(client, commandChannelId) {
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;

    client.once(Events.ClientReady, async () => {
        console.log('[CountCase] Module ready. Command Channel ID:', CONFIG.COMMAND_CHANNEL_ID);

        try {
            const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);

            if (commandChannel && commandChannel.isTextBased()) {
                const messages = await commandChannel.messages.fetch({ limit: 5 });
                const existingControlMessage = messages.find(m =>
                    m.components.length > 0 &&
                    m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID)
                );

                const updatedMessage = getStartCountMessage();
                if (existingControlMessage) {
                    await existingControlMessage.edit(updatedMessage);
                } else {
                    await commandChannel.send(updatedMessage);
                }
            }
        } catch (error) {
            console.error("❌ Error sending or fetching control buttons:", error);
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        // กดปุ่มนับ
        if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || CONFIG.CHANNEL_IDS.length === 0) {
                    return await interaction.editReply({
                        content: "❌ การตั้งค่าไม่สมบูรณ์! โปรดตั้งค่า Sheet, Sheet Name และ Channel IDs ก่อน",
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.editReply("⏳ ล้างข้อมูลและเริ่มนับข้อความเก่า...");
                await clearCountsOnly();

                for (let i = 0; i < CONFIG.CHANNEL_IDS.length; i++) {
                    await processOldMessages(client, CONFIG.CHANNEL_IDS[i], i);
                }

                await interaction.editReply({
                    content: "🎉 การนับข้อความเก่าเสร็จสมบูรณ์! ข้อความนี้จะถูกลบใน 5 วินาที",
                    components: [],
                });
                
                await new Promise((r) => setTimeout(r, 5000));
                await interaction.deleteReply().catch(() => {});
            } catch (error) {
                console.error("[Historical Count Error]:", error);
                await interaction.editReply({
                    content: "❌ เกิดข้อผิดพลาดในการนับสถิติ โปรดตรวจสอบ Log ของบอท",
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        // กดปุ่มตั้งค่า ⚙️
        if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
            try {
                const modal = new ModalBuilder().setCustomId(CONFIG_MODAL_ID).setTitle('🛠️ ตั้งค่าการเชื่อมต่อ');

                const spreadsheetInput = new TextInputBuilder()
                    .setCustomId('spreadsheet_id_input')
                    .setLabel('Google Spreadsheet ID')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(CONFIG.SPREADSHEET_ID || '');

                const sheetNameInput = new TextInputBuilder()
                    .setCustomId('sheet_name_input')
                    .setLabel('Sheet Name')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(CONFIG.SHEET_NAME || '');

                const channelListInput = new TextInputBuilder()
                    .setCustomId('channel_list_input')
                    .setLabel('Channel IDs (คั่นด้วย ,)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue(CONFIG.CHANNEL_IDS?.join(', ') || '');

                const batchDelayInput = new TextInputBuilder()
                    .setCustomId('batch_delay_input')
                    .setLabel('Batch Delay (ms)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(CONFIG.BATCH_DELAY?.toString() || '150');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(spreadsheetInput),
                    new ActionRowBuilder().addComponents(sheetNameInput),
                    new ActionRowBuilder().addComponents(channelListInput),
                    new ActionRowBuilder().addComponents(batchDelayInput),
                );

                await interaction.showModal(modal);
            } catch (error) {
                console.error('❌ Error showing modal:', error);
                if (!interaction.replied) {
                    await interaction.reply({ content: '❌ เกิดข้อผิดพลาดในการเปิดหน้าต่างตั้งค่า', flags: MessageFlags.Ephemeral });
                }
            }
            return;
        }

        // ส่ง Modal
        if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const newSpreadsheetId = interaction.fields.getTextInputValue('spreadsheet_id_input');
                const newSheetName = interaction.fields.getTextInputValue('sheet_name_input');
                const newChannelIdsRaw = interaction.fields.getTextInputValue('channel_list_input');
                const newBatchDelayRaw = interaction.fields.getTextInputValue('batch_delay_input');

                CONFIG.SPREADSHEET_ID = newSpreadsheetId;
                CONFIG.SHEET_NAME = newSheetName;
                CONFIG.CHANNEL_IDS = newChannelIdsRaw
                    ? newChannelIdsRaw.split(',').map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)).slice(0, MAX_CHANNELS)
                    : [];
                CONFIG.BATCH_DELAY = parseInt(newBatchDelayRaw) || 150;

                saveConfig();

                const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
                if (commandChannel && commandChannel.isTextBased()) {
                    const messages = await commandChannel.messages.fetch({ limit: 5 });
                    const existingControlMessage = messages.find(m =>
                        m.components.length > 0 &&
                        m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID)
                    );
                    if (existingControlMessage) await existingControlMessage.edit(getStartCountMessage());
                }

                await interaction.editReply({
                    content: `✅ บันทึกการตั้งค่าเรียบร้อย! ข้อความนี้จะถูกลบใน 5 วินาที`,
                    flags: MessageFlags.Ephemeral
                });

                await new Promise((r) => setTimeout(r, 5000));
                await interaction.deleteReply().catch(() => {});

            } catch (error) {
                console.error("❌ Error processing modal submit:", error);
                await interaction.editReply({
                    content: `❌ เกิดข้อผิดพลาดในการบันทึกค่า!`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    });
}

module.exports = {
    initializeCountCase
};
