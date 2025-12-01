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

// ==================================================
// CONFIG & INITIALIZATION
// ==================================================
const MAX_CHANNELS = 3;
const CONFIG_FILE = "config.json";
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";
const STARTING_ROW = 4;

let CONFIG = {};

function loadConfig() {
    try {
        CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE));
        console.log("✅ Loaded config.json");
    } catch {
        CONFIG = {
            SPREADSHEET_ID: '',
            SHEET_NAME: 'Sheet1',
            CHANNEL_IDS: [],
            BATCH_DELAY: 150,
            COMMAND_CHANNEL_ID: '0',
        };
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 4));
        console.log("✅ Configuration saved");
    } catch (e) {
        console.error("❌ Error saving config:", e.message);
    }
}

loadConfig();

// ==================================================
// GOOGLE SHEETS AUTH
// ==================================================
const jwtClient = new JWT({
    email: process.env.CLIENT_EMAIL,
    key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const gsapi = google.sheets({ version: "v4", auth: jwtClient });

// ==================================================
// RATE-LIMIT AWARE FETCH
// ==================================================
async function safeFetch(channel, options) {
    try {
        return await channel.messages.fetch(options);
    } catch (e) {
        if (e.status === 429) {
            const wait = (e.retry_after || 1) * 1000;
            console.log(`[RATE LIMIT] Waiting ${wait}ms`);
            await new Promise(r => setTimeout(r, wait));
            return safeFetch(channel, options);
        }
        throw e;
    }
}

// ==================================================
// GOOGLE SHEETS FUNCTIONS
// ==================================================
async function clearCounts() {
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:E`;
    try {
        await gsapi.spreadsheets.values.clear({ spreadsheetId: CONFIG.SPREADSHEET_ID, range });
        console.log("✅ Cleared columns C–E");
    } catch (e) {
        console.error("❌ Error clearing counts:", e.message);
        throw e;
    }
}

async function batchUpdate(batchMap, colIndex) {
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const colLetter = String.fromCharCode(65 + colIndex);
    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${String.fromCharCode(65 + channelCount)}`
    });
    const rows = response.data.values || [];
    const updates = [];

    for (const [key, count] of batchMap.entries()) {
        const [displayName, username] = key.split("|");
        let rowIndex = rows.findIndex(r => r[0] === displayName && r[1] === username);

        if (rowIndex >= 0) {
            const sheetRow = STARTING_ROW + rowIndex;
            const current = parseInt(rows[rowIndex][colIndex] || "0");
            updates.push({
                range: `${CONFIG.SHEET_NAME}!${colLetter}${sheetRow}`,
                values: [[current + count]],
            });
            rows[rowIndex][colIndex] = String(current + count);
        } else {
            const appendRow = STARTING_ROW + rows.length;
            const newRow = [displayName, username, ...Array(channelCount).fill("0")];
            newRow[colIndex] = count;
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${String.fromCharCode(65 + channelCount)}${appendRow}`,
                values: [newRow],
            });
            rows.push(newRow);
        }
    }

    if (updates.length) {
        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: { valueInputOption: "RAW", data: updates }
        });
    }
}

// ==================================================
// MESSAGE PROCESSING
// ==================================================
async function processMessages(client, messages, colIndex, extraUserMap = null) {
    const batchMap = new Map();
    const userCache = new Map();

    for (const message of messages) {
        if (message.author.bot) continue;

        // นับ mentions
        const mentionedIds = new Set();
        const regex = /<@!?(\d+)>/g;
        let m;
        while ((m = regex.exec(message.content)) !== null) mentionedIds.add(m[1]);

        for (const id of mentionedIds) {
            let displayName, username;
            if (userCache.has(id)) ({ displayName, username } = userCache.get(id));
            else {
                try {
                    const member = message.guild ? await message.guild.members.fetch(id) : null;
                    if (member) { displayName = member.displayName; username = member.user.username; }
                    else { const user = await client.users.fetch(id); displayName = username = user.username; }
                } catch { continue; }
                userCache.set(id, { displayName, username });
            }
            const key = `${displayName}|${username}`;
            batchMap.set(key, (batchMap.get(key) || 0) + 1);
        }

        // ⭐️ นับผู้โพสของ channel 2 → ลง column 3
        if (extraUserMap && colIndex === 3) {
            const postAuthorKey = `${message.member?.displayName || message.author.username}|${message.author.username}`;
            extraUserMap.set(postAuthorKey, (extraUserMap.get(postAuthorKey) || 0) + 1);
        }
    }

    if (batchMap.size) await batchUpdate(batchMap, colIndex);
}

async function processOldMessages(client, channelId, colIndex, extraUserMap = null) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.log(`❌ Channel ${channelId} not found.`);

        let lastId = null;
        while (true) {
            const opts = { limit: 100 };
            if (lastId) opts.before = lastId;
            const messages = await safeFetch(channel, opts);
            if (!messages.size) break;
            await processMessages(client, [...messages.values()], colIndex, extraUserMap);
            lastId = messages.last().id;
            await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
        }
        console.log(`✅ Finished processing ${channel.name}`);
    } catch (e) { console.error("❌ Error processing channel:", e.message); }
}

// ==================================================
// DISCORD UI
// ==================================================
function getControlMessage() {
    const validChannels = CONFIG.CHANNEL_IDS.filter(id => id.length > 10 && !isNaN(id));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(COUNT_BUTTON_ID).setLabel("⭐ เริ่มนับข้อความเก่า").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CONFIG_BUTTON_ID).setLabel("⚙️ ตั้งค่า Sheet/Channel").setStyle(ButtonStyle.Secondary)
    );
    const list = validChannels.map(id => `- <#${id}>`).join("\n") || "- ยังไม่มีช่องสำหรับการนับ -";
    return { content: `⚠️ สถานะปัจจุบัน:\n> Sheet: **${CONFIG.SPREADSHEET_ID || 'ไม่ได้ตั้งค่า'}**\n> Sheet Name: **${CONFIG.SHEET_NAME || 'ไม่ได้ตั้งค่า'}**\n> Batch Delay: **${CONFIG.BATCH_DELAY}ms**\n> Channels:\n${list}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`, components: [row] };
}

// ==================================================
// MODULE INITIALIZATION
// ==================================================
function initializeCountCase(client, commandChannelId) {
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;

    client.once(Events.ClientReady, async () => {
        console.log("[CountCase] Module ready on channel", CONFIG.COMMAND_CHANNEL_ID);
        try {
            const channel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
            if (channel.isTextBased()) {
                const msgs = await channel.messages.fetch({ limit: 5 });
                const msg = msgs.find(m => m.components.length && m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID));
                if (msg) await msg.edit(getControlMessage());
                else await channel.send(getControlMessage());
            }
        } catch (e) { console.error("❌ Error sending control message:", e.message); }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        // -------- START COUNT BUTTON --------
        if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || !CONFIG.CHANNEL_IDS.length) {
                return await interaction.editReply({ content: "❌ การตั้งค่าไม่สมบูรณ์!", flags: MessageFlags.Ephemeral });
            }
            await interaction.editReply("⏳ กำลังล้างข้อมูลเก่า...");
            await clearCounts();

            // Extra map สำหรับผู้โพส channel 2 → column 3
            const extraUserMap = new Map();

            for (let i = 0; i < CONFIG.CHANNEL_IDS.length; i++) {
                const colIndex = i + 2; // C=2, D=3, E=4
                await processOldMessages(client, CONFIG.CHANNEL_IDS[i], colIndex, extraUserMap);
            }

            // นับผู้โพส channel 2 → column 3 (E)
            if (CONFIG.CHANNEL_IDS[1]) await batchUpdate(extraUserMap, 4);

            await interaction.editReply({ content: "🎉 การนับข้อความเสร็จสมบูรณ์!", components: [] });
            return;
        }

        // -------- CONFIG BUTTON --------
        if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
            const modal = new ModalBuilder().setCustomId(CONFIG_MODAL_ID).setTitle("🛠️ ตั้งค่าเชื่อมต่อ");
            const sheetIdInput = new TextInputBuilder().setCustomId("spreadsheet_id_input").setLabel("Google Spreadsheet ID").setStyle(TextInputStyle.Short).setRequired(true).setValue(CONFIG.SPREADSHEET_ID || "");
            const sheetNameInput = new TextInputBuilder().setCustomId("sheet_name_input").setLabel("Sheet Name").setStyle(TextInputStyle.Short).setRequired(true).setValue(CONFIG.SHEET_NAME || "");
            const channelInput = new TextInputBuilder().setCustomId("channel_list_input").setLabel("Channel IDs (คั่นด้วย ,)").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(CONFIG.CHANNEL_IDS?.join(", ") || "");
            const batchDelayInput = new TextInputBuilder().setCustomId("batch_delay_input").setLabel("Batch Delay (ms)").setStyle(TextInputStyle.Short).setRequired(false).setValue(CONFIG.BATCH_DELAY?.toString() || "150");
            modal.addComponents(new ActionRowBuilder().addComponents(sheetIdInput),
                                new ActionRowBuilder().addComponents(sheetNameInput),
                                new ActionRowBuilder().addComponents(channelInput),
                                new ActionRowBuilder().addComponents(batchDelayInput));
            await interaction.showModal(modal);
            return;
        }

        // -------- MODAL SUBMIT --------
        if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const newSheetId = interaction.fields.getTextInputValue("spreadsheet_id_input");
                const newSheetName = interaction.fields.getTextInputValue("sheet_name_input");
                const newChannels = interaction.fields.getTextInputValue("channel_list_input");
                const newBatch = interaction.fields.getTextInputValue("batch_delay_input");

                CONFIG.SPREADSHEET_ID = newSheetId;
                CONFIG.SHEET_NAME = newSheetName;
                CONFIG.CHANNEL_IDS = newChannels ? newChannels.split(",").map(c => c.trim()).filter(c => c.length > 10 && !isNaN(c)).slice(0, MAX_CHANNELS) : [];
                CONFIG.BATCH_DELAY = parseInt(newBatch) || 150;

                saveConfig();

                const cmdChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
                if (cmdChannel.isTextBased()) {
                    const msgs = await cmdChannel.messages.fetch({ limit: 5 });
                    const msg = msgs.find(m => m.components.length && m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID));
                    if (msg) await msg.edit(getControlMessage());
                }

                await interaction.editReply({ content: "✅ บันทึกการตั้งค่าเรียบร้อย!", flags: MessageFlags.Ephemeral });
            } catch (e) {
                console.error("❌ Modal submit error:", e.message);
                await interaction.editReply({ content: "❌ เกิดข้อผิดพลาด!", flags: MessageFlags.Ephemeral });
            }
        }
    });
}

module.exports = { initializeCountCase };
