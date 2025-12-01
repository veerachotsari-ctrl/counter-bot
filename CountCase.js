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
const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY?.replace(/\\n/g, '\n')
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

// =============================
// CONFIGURATION
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
        const data = fs.readFileSync(CONFIG_FILE, "utf-8");
        CONFIG = JSON.parse(data);
        console.log("✅ Loaded configuration from config.json.");
    } catch {
        CONFIG = { SPREADSHEET_ID: "", SHEET_NAME: "Sheet1", CHANNEL_IDS: [], BATCH_DELAY: 150, COMMAND_CHANNEL_ID: "0" };
        console.log("⚠️ Using default config.");
    }
}

function saveConfig() {
    const savable = {
        SPREADSHEET_ID: CONFIG.SPREADSHEET_ID,
        SHEET_NAME: CONFIG.SHEET_NAME,
        CHANNEL_IDS: CONFIG.CHANNEL_IDS,
        BATCH_DELAY: CONFIG.BATCH_DELAY
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(savable, null, 4));
    console.log("✅ Configuration saved.");
}

loadConfig();

// =============================
// GOOGLE SHEETS FUNCTIONS
// =============================
async function clearCountsOnly() {
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:E`;
    try {
        await gsapi.spreadsheets.values.clear({ spreadsheetId: CONFIG.SPREADSHEET_ID, range });
        console.log("✅ Cleared columns C–E (from row 4 down).");
    } catch (e) {
        console.error("❌ Error clearing counts:", e);
        throw e;
    }
}

async function batchUpdateMentions(batchMap, channelIndex) {
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${String.fromCharCode(65 + 1 + channelCount)}`;

    const response = await gsapi.spreadsheets.values.get({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: dataRange });
    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));

    const updates = [];
    const colIndex = 2 + channelIndex;
    const colLetter = String.fromCharCode(65 + colIndex);

    for (const [key, count] of batchMap.entries()) {
        const [displayName, username] = key.split("|");
        let rowIndex = rows.findIndex(r => r[0] === displayName && r[1] === username);

        if (rowIndex >= 0) {
            const sheetRowIndex = STARTING_ROW + rowIndex;
            const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
            const newCount = currentValue + count;
            updates.push({ range: `${CONFIG.SHEET_NAME}!${colLetter}${sheetRowIndex}`, values: [[newCount]] });
            rows[rowIndex][colIndex] = String(newCount);
        } else {
            const appendRow = STARTING_ROW + rows.length;
            const newRow = [displayName, username, ...Array(channelCount).fill(0).map(String)];
            newRow[colIndex] = count;
            updates.push({ range: `${CONFIG.SHEET_NAME}!A${appendRow}:${String.fromCharCode(65 + 1 + channelCount)}${appendRow}`, values: [newRow] });
            rows.push(newRow);
        }
    }

    if (updates.length > 0) {
        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: { valueInputOption: "RAW", data: updates.map(u => ({ range: u.range, values: u.values })) }
        });
    }

    await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
}

// =============================
// MESSAGE PROCESSING
// =============================
async function processMessagesBatch(client, messages, channelIndex) {
    const batchMap = new Map();
    const userCache = new Map();

    for (const message of messages) {
        if (message.author.bot) continue;
        if (!message.content.includes("<@")) continue;

        const uniqueMentionedIds = new Set();
        const mentionRegex = /<@!?(\d+)>/g;
        let match;
        while ((match = mentionRegex.exec(message.content)) !== null) uniqueMentionedIds.add(match[1]);

        for (const id of uniqueMentionedIds) {
            let displayName, username;
            if (userCache.has(id)) {
                ({ displayName, username } = userCache.get(id));
            } else {
                try {
                    const guild = messages[0].guild;
                    const member = guild ? await guild.members.fetch(id) : null;
                    if (member) { displayName = member.displayName; username = member.user.username; }
                    else { const user = await client.users.fetch(id); displayName = user.username; username = user.username; }
                } catch { continue; }
                userCache.set(id, { displayName, username });
            }
            const key = `${displayName}|${username}`;
            batchMap.set(key, (batchMap.get(key) || 0) + 1);
        }
    }

    if (batchMap.size > 0) await batchUpdateMentions(batchMap, channelIndex);
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
            await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
        }

        console.log(`✅ Finished processing old messages for channel ${channelId}`);
    } catch (e) { console.error(`❌ Error processing channel ${channelId}:`, e.message); }
}

// =============================
// UI / CONTROL MESSAGE
// =============================
function getStartCountMessage() {
    const validChannelIds = CONFIG.CHANNEL_IDS.filter(id => id && id.length > 10 && !isNaN(id));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(COUNT_BUTTON_ID).setLabel("⭐ เริ่มนับข้อความเก่า").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CONFIG_BUTTON_ID).setLabel("⚙️ ตั้งค่า Sheet/Channel").setStyle(ButtonStyle.Secondary)
    );

    const channelList = validChannelIds.map(id => `- <#${id}>`).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';

    return {
        content: `⚠️ สถานะปัจจุบัน:\n> Sheet ID: **${CONFIG.SPREADSHEET_ID || 'ไม่ได้ตั้งค่า'}**\n> Sheet Name: **${CONFIG.SHEET_NAME || 'ไม่ได้ตั้งค่า'}**\n> Batch Delay: **${CONFIG.BATCH_DELAY}ms**\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS}):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`,
        components: [row]
    };
}

// =============================
// MODULE INITIALIZATION
// =============================
function initializeCountCase(client, commandChannelId) {
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;

    client.once(Events.ClientReady, async () => {
        console.log('[CountCase] Module ready. Command Channel ID:', CONFIG.COMMAND_CHANNEL_ID);
        try {
            const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
            if (commandChannel?.isTextBased()) {
                const messages = await commandChannel.messages.fetch({ limit: 5 });
                const existingControlMessage = messages.find(m => m.components.length > 0 && m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID));
                const updatedMessage = getStartCountMessage();
                if (existingControlMessage) await existingControlMessage.edit(updatedMessage);
                else await commandChannel.send(updatedMessage);
            }
        } catch (e) { console.error("❌ Error sending or fetching control buttons:", e); }
    });

    client.on(Events.InteractionCreate, async interaction => {
        // ⭐️ เริ่มนับ
        if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || CONFIG.CHANNEL_IDS.length === 0) {
                    return await interaction.editReply({ content: "❌ การตั้งค่าไม่สมบูรณ์!", flags: MessageFlags.Ephemeral });
                }
                await interaction.editReply("⏳ กำลังล้างข้อมูลการนับเก่า...");
                await clearCountsOnly();
                for (let i = 0; i < CONFIG.CHANNEL_IDS.length; i++) await processOldMessages(client, CONFIG.CHANNEL_IDS[i], i);
                await interaction.editReply({ content: "🎉 การนับข้อความเก่าเสร็จสมบูรณ์!", components: [] });
            } catch (e) {
                console.error("[Historical Count Error]:", e);
                await interaction.editReply({ content: "❌ เกิดข้อผิดพลาดในการนับสถิติ", flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // ⭐️ เปิด Modal ตั้งค่า
        if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
            try {
                const modal = new ModalBuilder().setCustomId(CONFIG_MODAL_ID).setTitle("🛠️ ตั้งค่าการเชื่อมต่อ");
                const spreadsheetInput = new TextInputBuilder().setCustomId("spreadsheet_id_input").setLabel("Google Spreadsheet ID").setStyle(TextInputStyle.Short).setRequired(true).setValue(CONFIG.SPREADSHEET_ID || "");
                const sheetNameInput = new TextInputBuilder().setCustomId("sheet_name_input").setLabel("ชื่อชีต").setStyle(TextInputStyle.Short).setRequired(true).setValue(CONFIG.SHEET_NAME || "");
                const channelListInput = new TextInputBuilder().setCustomId("channel_list_input").setLabel("Channel IDs (คั่นด้วย ,)").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(CONFIG.CHANNEL_IDS.join(", ") || "");
                const batchDelayInput = new TextInputBuilder().setCustomId("batch_delay_input").setLabel("Batch Delay (ms)").setStyle(TextInputStyle.Short).setRequired(false).setValue(CONFIG.BATCH_DELAY?.toString() || "150");

                modal.addComponents(new ActionRowBuilder().addComponents(spreadsheetInput));
                modal.addComponents(new ActionRowBuilder().addComponents(sheetNameInput));
                modal.addComponents(new ActionRowBuilder().addComponents(channelListInput));
                modal.addComponents(new ActionRowBuilder().addComponents(batchDelayInput));

                await interaction.showModal(modal);
            } catch (e) { console.error("❌ Error showing modal:", e); }
            return;
        }

        // ⭐️ Modal submit
        if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const newSpreadsheetId = interaction.fields.getTextInputValue("spreadsheet_id_input");
                const newSheetName = interaction.fields.getTextInputValue("sheet_name_input");
                const newChannelIdsRaw = interaction.fields.getTextInputValue("channel_list_input");
                const newBatchDelayRaw = interaction.fields.getTextInputValue("batch_delay_input");

                CONFIG.SPREADSHEET_ID = newSpreadsheetId;
                CONFIG.SHEET_NAME = newSheetName;
                CONFIG.CHANNEL_IDS = newChannelIdsRaw ? newChannelIdsRaw.split(",").map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)).slice(0, MAX_CHANNELS) : [];
                CONFIG.BATCH_DELAY = parseInt(newBatchDelayRaw) || 150;

                saveConfig();

                const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
                if (commandChannel?.isTextBased()) {
                    const messages = await commandChannel.messages.fetch({ limit: 5 });
                    const existingControlMessage = messages.find(m => m.components.length > 0 && m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID));
                    if (existingControlMessage) await existingControlMessage.edit(getStartCountMessage());
                }

                await interaction.editReply({ content: "✅ บันทึกการตั้งค่าเรียบร้อย!", flags: MessageFlags.Ephemeral });
            } catch (e) {
                console.error("❌ Error processing modal submit:", e);
                await interaction.editReply({ content: "❌ เกิดข้อผิดพลาดในการบันทึกค่า", flags: MessageFlags.Ephemeral });
            }
        }
    });
}

module.exports = { initializeCountCase };
