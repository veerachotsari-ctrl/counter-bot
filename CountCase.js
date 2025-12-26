// CountCase.js (ฉบับแก้ไขรองรับ 4 ช่อง และคอลัมน์ G)

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

// --- ตั้งค่าจำนวนช่องและคอลัมน์ ---
const MAX_CHANNELS = 4; 
const STARTING_ROW = 4;
const COL_INDEX = {
    C: 2, // ช่อง 1 (Mentions)
    D: 3, // ช่อง 2 (Mentions)
    E: 4, // ช่อง 2 (Author)
    F: 5, // ช่อง 3 (Mentions)
    G: 6, // ช่อง 4 (Mentions) -> เพิ่มใหม่
};
const COUNT_COLS = Object.keys(COL_INDEX).length; // จะได้ 5 คอลัมน์ (C,D,E,F,G)

let CONFIG = {};
const CONFIG_FILE = "config.json";
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";

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
loadConfig();

function saveConfig() {
    const savableConfig = {
        SPREADSHEET_ID: CONFIG.SPREADSHEET_ID,
        SHEET_NAME: CONFIG.SHEET_NAME,
        CHANNEL_IDS: CONFIG.CHANNEL_IDS,
        BATCH_DELAY: CONFIG.BATCH_DELAY,
        UPDATE_DELAY: CONFIG.UPDATE_DELAY,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(savableConfig, null, 4));
}

async function clearCountsOnly() {
    const lastColLetter = String.fromCharCode(65 + COL_INDEX.G); 
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:${lastColLetter}`;
    try {
        await gsapi.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range,
        });
    } catch (error) {
        console.error("❌ Error clearing counts:", error);
        throw error;
    }
}

async function batchUpdateAllColumns(masterCountMap) {
    if (masterCountMap.size === 0) return;
    const lastColLetter = String.fromCharCode(65 + COL_INDEX.G);
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${lastColLetter}`;

    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });

    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));
    const updates = [];
    const appendedRowsData = [];

    for (const [key, batchCounts] of masterCountMap.entries()) {
        const [displayName, username] = key.split("|");
        let rowIndex = rows.findIndex((r) => r[0] === displayName && r[1] === username);

        if (rowIndex >= 0) {
            const sheetRowIndex = STARTING_ROW + rowIndex;
            for (let i = 0; i < COUNT_COLS; i++) {
                const colIdx = COL_INDEX.C + i;
                const batchCount = batchCounts[i];
                if (batchCount > 0) {
                    const currentRow = rows[rowIndex];
                    const currentValue = parseInt(currentRow[colIdx] || "0");
                    const newCount = currentValue + batchCount;
                    updates.push({
                        range: `${CONFIG.SHEET_NAME}!${String.fromCharCode(65 + colIdx)}${sheetRowIndex}`,
                        values: [[newCount]],
                    });
                }
            }
        } else {
            const appendRow = STARTING_ROW + rows.length + appendedRowsData.length;
            const newRow = [displayName, username, '', '', '', '', '']; 
            for (let i = 0; i < COUNT_COLS; i++) {
                newRow[COL_INDEX.C + i] = batchCounts[i] > 0 ? String(batchCounts[i]) : '0';
            }
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${lastColLetter}${appendRow}`,
                values: [newRow],
            });
            appendedRowsData.push(newRow);
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
}

async function getUserInfo(client, guild, id, userCache) {
    if (userCache.has(id)) return userCache.get(id);
    let displayName, username;
    try {
        const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
        if (member) {
            displayName = member.displayName;
            username = member.user.username;
        } else {
            const user = await client.users.fetch(id);
            displayName = user.username;
            username = user.username;
        }
    } catch {
        displayName = `UnknownUser_${id}`;
        username = `unknown_${id}`;
    }
    const userInfo = { displayName, username };
    userCache.set(id, userInfo);
    return userInfo;
}

// --- จุดแก้ไขสำคัญ: Logic การเลือกคอลัมน์ ---
async function processMessagesBatch(client, messages, channelIndex) {
    const masterCountMap = new Map();
    const userCache = new Map();
    
    let mentionColIndex;
    if (channelIndex === 0) mentionColIndex = COL_INDEX.C;
    else if (channelIndex === 1) mentionColIndex = COL_INDEX.D;
    else if (channelIndex === 2) mentionColIndex = COL_INDEX.F;
    else if (channelIndex === 3) mentionColIndex = COL_INDEX.G; // สำหรับช่องที่ 4

    const authorColIndex = COL_INDEX.E;
    const guild = messages[0]?.guild;

    for (const message of messages) {
        if (message.author.bot) continue;

        if (message.content.includes("<@")) {
            const uniqueMentionedIds = new Set();
            const mentionRegex = /<@!?(\d+)>/g;
            let match;
            while ((match = mentionRegex.exec(message.content)) !== null) {
                uniqueMentionedIds.add(match[1]);
            }
            for (const id of uniqueMentionedIds) {
                const { displayName, username } = await getUserInfo(client, guild, id, userCache);
                const key = `${displayName}|${username}`;
                const counts = masterCountMap.get(key) || Array(COUNT_COLS).fill(0);
                counts[mentionColIndex - COL_INDEX.C] += 1;
                masterCountMap.set(key, counts);
            }
        }
        
        if (channelIndex === 1) { 
            const id = message.author.id;
            const { displayName, username } = await getUserInfo(client, guild, id, userCache);
            const authorKey = `${displayName}|${username}`;
            const counts = masterCountMap.get(authorKey) || Array(COUNT_COLS).fill(0);
            counts[authorColIndex - COL_INDEX.C] += 1;
            masterCountMap.set(authorKey, counts);
        }
    }
    if (masterCountMap.size > 0) await batchUpdateAllColumns(masterCountMap);
}

async function processOldMessages(client, interaction, channelId, channelIndex, totalProcessedPerChannel) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const channelName = channel.name;
    let lastId = null;
    let processedCount = 0;
    
    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        await processMessagesBatch(client, [...messages.values()], channelIndex);
        processedCount += messages.size;
        
        totalProcessedPerChannel[channelIndex] = `⏳ กำลังนับช่อง: **#${channelName}** (${channelIndex + 1}/${MAX_CHANNELS})\n> ประมวลผล: **${processedCount}** ข้อความ`;
        await interaction.editReply({ content: totalProcessedPerChannel.join('\n') }).catch(() => {});
        
        lastId = messages.last().id;
        await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY));
    }
    totalProcessedPerChannel[channelIndex] = `✅ **#${channelName}** เสร็จสมบูรณ์: **${processedCount}** ข้อความ`;
    await interaction.editReply({ content: totalProcessedPerChannel.join('\n') }).catch(() => {});
}

function getStartCountMessage() {
    const validChannelIds = CONFIG.CHANNEL_IDS.slice(0, MAX_CHANNELS).filter(id => id && id.length > 10 && !isNaN(id)); 
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(COUNT_BUTTON_ID).setLabel("⭐ เริ่มนับข้อความเก่า").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CONFIG_BUTTON_ID).setLabel("⚙️ ตั้งค่า Sheet/Channel").setStyle(ButtonStyle.Secondary),
    );

    const channelList = validChannelIds.map((id, index) => {
        let label = `- <#${id}> (Ch ${index + 1}:`;
        if (index === 0) label += ' C)';
        else if (index === 1) label += ' D, E)';
        else if (index === 2) label += ' F)';
        else if (index === 3) label += ' G)';
        return label;
    }).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';

    return {
        content: `📊 **ระบบนับสถิติ (รองรับ 4 ช่อง)**\n> Sheet ID: \`${CONFIG.SPREADSHEET_ID}\`\n> Channel ที่ตั้งไว้:\n${channelList}\n\nกดปุ่มเพื่อเริ่ม:`,
        components: [row],
    };
}

function initializeCountCase(client, commandChannelId) {
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;
    
    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const activeChannelIds = CONFIG.CHANNEL_IDS.slice(0, MAX_CHANNELS);
            await clearCountsOnly();
            const totalProcessedPerChannel = activeChannelIds.map((id, index) => `⏳ Channel ${index + 1}: <#${id}> (รอ...)`);
            for (let i = 0; i < activeChannelIds.length; i++) {
                await processOldMessages(client, interaction, activeChannelIds[i], i, totalProcessedPerChannel);
            }
        }

        if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
            const modal = new ModalBuilder().setCustomId(CONFIG_MODAL_ID).setTitle('🛠️ ตั้งค่าระบบ');
            const spreadsheetInput = new TextInputBuilder().setCustomId('spreadsheet_id_input').setLabel('Spreadsheet ID').setStyle(TextInputStyle.Short).setValue(CONFIG.SPREADSHEET_ID || '');
            const channelListInput = new TextInputBuilder().setCustomId('channel_list_input').setLabel(`IDs คั่นด้วย , (สูงสุด ${MAX_CHANNELS} ช่อง)`).setStyle(TextInputStyle.Paragraph).setValue(CONFIG.CHANNEL_IDS?.join(', ') || '');
            modal.addComponents(
                new ActionRowBuilder().addComponents(spreadsheetInput),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sheet_name_input').setLabel('ชื่อชีต').setStyle(TextInputStyle.Short).setValue(CONFIG.SHEET_NAME || 'Sheet1')),
                new ActionRowBuilder().addComponents(channelListInput)
            );
            await interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            CONFIG.SPREADSHEET_ID = interaction.fields.getTextInputValue('spreadsheet_id_input');
            CONFIG.SHEET_NAME = interaction.fields.getTextInputValue('sheet_name_input');
            CONFIG.CHANNEL_IDS = interaction.fields.getTextInputValue('channel_list_input')
                .split(',').map(id => id.trim()).filter(id => id.length > 10).slice(0, MAX_CHANNELS);
            saveConfig();
            await interaction.editReply("✅ บันทึกค่าเรียบร้อย! (รีสตาร์ทบอทเพื่อความชัวร์)");
        }
    });
}

module.exports = { initializeCountCase };
