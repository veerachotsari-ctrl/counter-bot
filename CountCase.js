// CountCase.js (ฉบับสมบูรณ์)

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

// 1. SETUP
const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null,
};

const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const gsapi = google.sheets({ version: "v4", auth });

const MAX_CHANNELS = 5; 
let CONFIG = {};
const CONFIG_FILE = "config.json";
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";
const STARTING_ROW = 4;

const COL_INDEX = {
    C: 2, D: 3, E: 4, F: 5, G: 6,
};
const COUNT_COLS = Object.keys(COL_INDEX).length;

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE);
        CONFIG = JSON.parse(data);
    } catch (e) {
        CONFIG = {
            SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
            SHEET_NAME: process.env.SHEET_NAME || 'Sheet1',
            CHANNEL_IDS: [],
            BATCH_DELAY: 150,
            UPDATE_DELAY: 50,
        };
    }
    CONFIG.COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID || '0';
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 4));
    } catch(e) { console.error(e); }
}

loadConfig();

// 2. GOOGLE SHEET FUNCTIONS (คงเดิมตามโค้ดคุณ)
async function clearCountsOnly() {
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:${String.fromCharCode(65 + 1 + COUNT_COLS)}`;
    try {
        await gsapi.spreadsheets.values.clear({ spreadsheetId: CONFIG.SPREADSHEET_ID, range });
    } catch (error) { throw error; }
}

async function batchUpdateAllColumns(masterCountMap) {
    if (masterCountMap.size === 0) return;
    const lastDataColLetter = String.fromCharCode(65 + 1 + COUNT_COLS);
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${lastDataColLetter}`;
    const response = await gsapi.spreadsheets.values.get({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: dataRange });
    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));
    const updates = [];
    const appendedRowsData = [];

    for (const [key, batchCounts] of masterCountMap.entries()) {
        const [displayName, username] = key.split("|");
        let rowIndex = rows.findIndex((r) => r[0] === displayName && r[1] === username);
        if (rowIndex >= 0) {
            const sheetRowIndex = STARTING_ROW + rowIndex;
            for (let i = 0; i < COUNT_COLS; i++) {
                const colIndex = COL_INDEX.C + i;
                if (batchCounts[i] > 0) {
                    const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
                    const newCount = currentValue + batchCounts[i];
                    updates.push({
                        range: `${CONFIG.SHEET_NAME}!${String.fromCharCode(65 + colIndex)}${sheetRowIndex}`,
                        values: [[newCount]],
                    });
                }
            }
        } else {
            const appendRow = STARTING_ROW + rows.length + appendedRowsData.length;
            const newRow = [displayName, username];
            while (newRow.length < COL_INDEX.C) newRow.push('');
            for (let i = 0; i < COUNT_COLS; i++) newRow[COL_INDEX.C + i] = batchCounts[i] > 0 ? String(batchCounts[i]) : '0';
            updates.push({ range: `${CONFIG.SHEET_NAME}!A${appendRow}:${lastDataColLetter}${appendRow}`, values: [newRow] });
            appendedRowsData.push(newRow);
        }
    }
    if (updates.length > 0) {
        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: { valueInputOption: "RAW", data: updates.map(u => ({ range: u.range, values: u.values })) }
        });
    }
}

// 3. DISCORD MESSAGE PROCESSING (คงเดิมตามโค้ดคุณ)
async function getUserInfo(client, guild, id, userCache) {
    if (userCache.has(id)) return userCache.get(id);
    let displayName, username;
    try {
        const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
        displayName = member ? member.displayName : (await client.users.fetch(id)).username;
        username = member ? member.user.username : displayName;
    } catch { displayName = `Unknown_${id}`; username = `unknown_${id}`; }
    const userInfo = { displayName, username };
    userCache.set(id, userInfo);
    return userInfo;
}

async function processMessagesBatch(client, messages, channelIndex) {
    const masterCountMap = new Map();
    const userCache = new Map();
    let mentionColIndex;
    if (channelIndex === 0) mentionColIndex = COL_INDEX.C;
    else if (channelIndex === 1) mentionColIndex = COL_INDEX.D;
    else if (channelIndex === 2) mentionColIndex = COL_INDEX.F;
    else if (channelIndex === 3) mentionColIndex = COL_INDEX.G;
    const authorColIndex = COL_INDEX.E;
    const guild = messages[0]?.guild;

    for (const message of messages) {
        if (message.author.bot) continue;
        if (message.content.includes("<@")) {
            const mentionRegex = /<@!?(\d+)>/g;
            let match;
            while ((match = mentionRegex.exec(message.content)) !== null) {
                const { displayName, username } = await getUserInfo(client, guild, match[1], userCache);
                const key = `${displayName}|${username}`;
                const counts = masterCountMap.get(key) || [0,0,0,0,0];
                counts[mentionColIndex - COL_INDEX.C] += 1;
                masterCountMap.set(key, counts);
            }
        }
        if (channelIndex === 1) {
            const { displayName, username } = await getUserInfo(client, guild, message.author.id, userCache);
            const key = `${displayName}|${username}`;
            const counts = masterCountMap.get(key) || [0,0,0,0,0];
            counts[authorColIndex - COL_INDEX.C] += 1;
            masterCountMap.set(key, counts);
        }
    }
    await batchUpdateAllColumns(masterCountMap);
}

async function processOldMessages(client, interaction, channelId, channelIndex, totalProcessedPerChannel) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    let lastId = null;
    let processedCount = 0;
    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;
        await processMessagesBatch(client, [...messages.values()], channelIndex);
        processedCount += messages.size;
        totalProcessedPerChannel[channelIndex] = `⏳ **#${channel.name}**: **${processedCount}** ข้อความ`;
        await interaction.editReply({ content: totalProcessedPerChannel.join('\n') }).catch(() => {});
        lastId = messages.last().id;
        await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
    }
    totalProcessedPerChannel[channelIndex] = `✅ **#${channel.name}** เสร็จสิ้น: **${processedCount}** ข้อความ`;
}

// 4. UI & CONTROL
function getStartCountMessage() {
    const validChannelIds = CONFIG.CHANNEL_IDS.slice(0, 4).filter(id => id && id.length > 10);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(COUNT_BUTTON_ID).setLabel("⭐ เริ่มนับข้อความเก่า").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CONFIG_BUTTON_ID).setLabel("⚙️ ตั้งค่า").setStyle(ButtonStyle.Secondary),
    );
    const channelList = validChannelIds.map((id, i) => `- <#${id}> (Channel ${i+1})`).join('\n') || '- ยังไม่มีช่อง -';
    return {
        content: `⚠️ **แผงควบคุมการนับเคส**\n> Sheet: **${CONFIG.SHEET_NAME}**\n${channelList}`,
        components: [row],
    };
}

/**
 * เพิ่มฟังก์ชันสำหรับเรียกใช้ผ่าน Slash Command
 */
async function sendControlPanel(interactionOrChannel) {
    const payload = getStartCountMessage();
    if (interactionOrChannel.reply) {
        return await interactionOrChannel.reply(payload);
    } else {
        return await interactionOrChannel.send(payload);
    }
}

function initializeCountCase(client, commandChannelId) {
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;
    
    // Auto-send เมื่อบอทรัน (เหมือนเดิม)
    client.once(Events.ClientReady, async () => {
        const cmdChan = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID).catch(() => null);
        if (cmdChan) {
            const msgs = await cmdChan.messages.fetch({ limit: 10 });
            const existing = msgs.find(m => m.components[0]?.components.some(c => c.customId === COUNT_BUTTON_ID));
            if (!existing) await cmdChan.send(getStartCountMessage());
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        // BUTTON: START COUNT
        if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await interaction.editReply("⏳ กำลังเริ่ม...");
            await clearCountsOnly();
            const activeIds = CONFIG.CHANNEL_IDS.slice(0, 4);
            const status = activeIds.map((id, i) => `⏳ Channel ${i+1}: <#${id}> (รอ...)`);
            for (let i = 0; i < activeIds.length; i++) {
                await processOldMessages(client, interaction, activeIds[i], i, status);
            }
            await interaction.editReply({ content: `🎉 เสร็จสมบูรณ์!\n${status.join('\n')}` });
        }

        // BUTTON: CONFIG
        if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
            const modal = new ModalBuilder().setCustomId(CONFIG_MODAL_ID).setTitle('🛠️ ตั้งค่า');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spreadsheet_id_input').setLabel('Sheet ID').setStyle(TextInputStyle.Short).setValue(CONFIG.SPREADSHEET_ID)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sheet_name_input').setLabel('Sheet Name').setStyle(TextInputStyle.Short).setValue(CONFIG.SHEET_NAME)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_list_input').setLabel('Channel IDs (คั่นด้วย ,)').setStyle(TextInputStyle.Paragraph).setValue(CONFIG.CHANNEL_IDS.join(', '))),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('batch_delay_input').setLabel('Batch Delay (ms)').setStyle(TextInputStyle.Short).setValue(CONFIG.BATCH_DELAY.toString()))
            );
            await interaction.showModal(modal);
        }

        // MODAL SUBMIT
        if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            CONFIG.SPREADSHEET_ID = interaction.fields.getTextInputValue('spreadsheet_id_input');
            CONFIG.SHEET_NAME = interaction.fields.getTextInputValue('sheet_name_input');
            CONFIG.CHANNEL_IDS = interaction.fields.getTextInputValue('channel_list_input').split(',').map(id => id.trim()).filter(id => id.length > 10);
            CONFIG.BATCH_DELAY = parseInt(interaction.fields.getTextInputValue('batch_delay_input')) || 150;
            saveConfig();
            await interaction.editReply("✅ บันทึกแล้ว");
        }
    });
}

module.exports = { initializeCountCase, sendControlPanel };
