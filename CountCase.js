// CountCase.js (โมดูลจัดการการนับสถิติและการตั้งค่า - ฉบับเต็มพร้อมแก้ไขประสิทธิภาพและแจ้งสถานะ)

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
// 1. GOOGLE AUTH SETUP & CONFIG, CONSTANTS & INITIALIZATION (เหมือนเดิม)
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

// รองรับ 4 คอลัมน์สถิติ (C, D, E, F)
const MAX_CHANNELS = 4;
let CONFIG = {};
const CONFIG_FILE = "config.json";
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";
const STARTING_ROW = 4;
// กำหนด Index คอลัมน์ (0=A, 1=B, 2=C, 3=D, 4=E, 5=F)
const COL_INDEX = {
    C: 2, // Channel 1 Mentions
    D: 3, // Channel 2 Mentions
    E: 4, // Channel 2 Author
    F: 5, // Channel 3 Mentions
};
const COUNT_COLS = Object.keys(COL_INDEX).length; // 4 คอลัมน์ (C, D, E, F)

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
    CONFIG.COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID || '0';
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
// 2. GOOGLE SHEET FUNCTIONS (เหมือนเดิม)
// ---------------------------------------------------------

async function clearCountsOnly() {
    // ล้างข้อมูลคอลัมน์ C:F (จาก COUNT_COLS)
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:${String.fromCharCode(65 + 1 + COUNT_COLS)}`;
    try {
        await gsapi.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range,
        });
        console.log("✅ Cleared count columns (C–F, from row 4 down).");
    } catch (error) {
        console.error("❌ Error clearing counts:", error);
        throw error;
    }
}

async function batchUpdateAllColumns(masterCountMap) {
    if (masterCountMap.size === 0) return;

    // A. ดึงข้อมูลชีตทั้งหมด (A:B และคอลัมน์นับ C-F)
    const lastDataColLetter = String.fromCharCode(65 + 1 + COUNT_COLS);
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${lastDataColLetter}`;

    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });

    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));

    const updates = [];
    const appendedRowsData = [];

    for (const [key, batchCounts] of masterCountMap.entries()) {
        const [displayName, username] = key.split("|");

        let rowIndex = rows.findIndex(
            (r) => r[0] === displayName && r[1] === username,
        );

        if (rowIndex >= 0) {
            // 1. อัปเดตแถวที่มีอยู่ (Existing Row)
            const sheetRowIndex = STARTING_ROW + rowIndex;
            const currentRow = rows[rowIndex];

            let newRowValues = [...currentRow];
            let hasUpdate = false;

            for (let i = 0; i < COUNT_COLS; i++) {
                const colIndex = COL_INDEX.C + i;
                const batchCount = batchCounts[i];

                if (batchCount > 0) {
                    const currentValue = parseInt(currentRow[colIndex] || "0");
                    const newCount = currentValue + batchCount;

                    const colLetter = String.fromCharCode(65 + colIndex);
                    updates.push({
                        range: `${CONFIG.SHEET_NAME}!${colLetter}${sheetRowIndex}`,
                        values: [[newCount]],
                    });

                    newRowValues[colIndex] = String(newCount);
                    hasUpdate = true;
                }
            }
            if (hasUpdate) {
                rows[rowIndex] = newRowValues;
            }

        } else {
            // 2. เพิ่มแถวใหม่ (Append New Row)
            const appendRow = STARTING_ROW + rows.length + appendedRowsData.length;

            const newRow = [displayName, username];
            while (newRow.length < COL_INDEX.C) newRow.push('');

            for (let i = 0; i < COUNT_COLS; i++) {
                newRow[COL_INDEX.C + i] = batchCounts[i] > 0 ? String(batchCounts[i]) : '0';
            }

            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${lastDataColLetter}${appendRow}`,
                values: [newRow],
            });

            appendedRowsData.push(newRow);
        }
    }
    
    rows.push(...appendedRowsData);

    // C. เรียก Batch Update API
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
// 3. DISCORD MESSAGE PROCESSING (ปรับปรุงเพื่อรองรับการแจ้งสถานะ)
// ---------------------------------------------------------

// Helper Function: ดึงข้อมูลผู้ใช้ (Fetch and Cache)
async function getUserInfo(client, guild, id, userCache) {
    if (userCache.has(id)) {
        return userCache.get(id);
    }
    
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
        // Fallback for users not in guild or general fetch error
        try {
            const user = await client.users.fetch(id);
            displayName = user.username;
            username = user.username;
        } catch {
            displayName = `UnknownUser_${id}`;
            username = `unknown_${id}`;
        }
    }
    const userInfo = { displayName, username };
    userCache.set(id, userInfo);
    return userInfo;
}

// Process 100 messages batch and update counts in Map
async function processMessagesBatch(client, messages, channelIndex) {
    const masterCountMap = new Map();
    const userCache = new Map();
    
    const mentionColIndex = (channelIndex === 0) ? COL_INDEX.C : (channelIndex === 1) ? COL_INDEX.D : COL_INDEX.F;
    const authorColIndex = COL_INDEX.E;

    const guild = messages[0]?.guild;

    for (const message of messages) {
        if (message.author.bot) continue;

        // 1. นับ Mentions
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
                
                const counts = masterCountMap.get(key) || [0, 0, 0, 0];
                counts[mentionColIndex - COL_INDEX.C] += 1;
                masterCountMap.set(key, counts);
            }
        }
        
        // 2. นับ Author สำหรับ Channel 2 เท่านั้น (channelIndex = 1)
        if (channelIndex === 1) {
            const id = message.author.id;
            const { displayName, username } = await getUserInfo(client, guild, id, userCache);
            const authorKey = `${displayName}|${username}`;
            
            const counts = masterCountMap.get(authorKey) || [0, 0, 0, 0];
            counts[authorColIndex - COL_INDEX.C] += 1;
            masterCountMap.set(authorKey, counts);
        }
    }
    
    if (masterCountMap.size > 0) {
        await batchUpdateAllColumns(masterCountMap);
    }
}

// 📌 ฟังก์ชันใหม่: processOldMessages (ปรับปรุงการแสดงสถานะ)
async function processOldMessages(client, interaction, channelId, channelIndex, totalProcessedPerChannel) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return console.log(`❌ Channel ${channelId} not found. Skipping.`);

    const channelName = channel.name;
    let lastId = null;
    let processedCount = 0;
    
    // สถานะเริ่มต้นของ Channel
    const initialStatus = `⏳ กำลังนับข้อความเก่าในช่อง: **#${channelName}** (${channelIndex + 1}/3)
> ประมวลผล: **0** ข้อความ`;
    
    // อัปเดตสถานะเริ่มต้นของการนับ (อัปเดตบนข้อความเดิม)
    await interaction.editReply({
        content: totalProcessedPerChannel.join('\n') + '\n\n' + initialStatus,
        components: [],
    }).catch(e => console.error("Error updating interaction reply:", e.message));

    console.log(`⏳ Starting process for channel ${channelName} (${channelId}).`);

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        await processMessagesBatch(client, [...messages.values()], channelIndex);
        
        processedCount += messages.size;
        
        // 🚀 อัปเดตสถานะแบบ Real-time: แสดงจำนวนข้อความที่ประมวลผลไปแล้ว
        const currentStatus = `⏳ กำลังนับข้อความเก่าในช่อง: **#${channelName}** (${channelIndex + 1}/3)
> ประมวลผล: **${processedCount}** ข้อความ`;

        // อัปเดตสถานะของ Channel ปัจจุบันใน Array
        totalProcessedPerChannel[channelIndex] = `✅ **#${channelName}** ประมวลผลเสร็จสิ้น: **${processedCount}** ข้อความ`;
        if (messages.size > 0) {
             totalProcessedPerChannel[channelIndex] = currentStatus;
        }

        await interaction.editReply({
            content: totalProcessedPerChannel.join('\n'),
            components: [],
        }).catch(e => console.error("Error updating interaction reply:", e.message));

        console.log(`> Processed ${processedCount} messages in channel ${channelName}...`);

        lastId = messages.last().id;
        await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY));
    }
    
    // เมื่อเสร็จสิ้น Channel นี้
    totalProcessedPerChannel[channelIndex] = `🎉 **#${channelName}** ประมวลผลเสร็จสมบูรณ์: **${processedCount}** ข้อความ`;
    
    await interaction.editReply({
        content: totalProcessedPerChannel.join('\n'),
        components: [],
    }).catch(e => console.error("Error updating interaction reply (Final):", e.message));

    console.log(`✅ Finished processing ${processedCount} old messages for channel ${channelName} (${channelId})`);
}

// ---------------------------------------------------------
// 4. MODULE INITIALIZATION (ปรับปรุงการเรียกใช้ processOldMessages)
// ---------------------------------------------------------

// 🎨 DISCORD UI HANDLER (เหมือนเดิม)
function getStartCountMessage() {
    const validChannelIds = CONFIG.CHANNEL_IDS.slice(0, 3).filter(id => id && id.length > 10 && !isNaN(id)); 

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

    const channelList = validChannelIds.map((id, index) => {
        let label = `- <#${id}> (Channel ${index + 1}:`;
        if (index === 0) label += ' C : เทค 2)';
        else if (index === 1) label += ' D:คดีปกติ, E:คนทำคดี)';
        else if (index === 2) label += ' F:คุมสอบ)';
        return label;
    }).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';

    return {
        content: `⚠️ สถานะปัจจุบัน (ดึงจาก config.json):\n> Sheet ID: **${CONFIG.SPREADSHEET_ID || 'ไม่ได้ตั้งค่า'}**\n> Sheet Name: **${CONFIG.SHEET_NAME || 'ไม่ได้ตั้งค่า'}**\n> Batch Delay: **${CONFIG.BATCH_DELAY}ms**\n> Channel ที่นับ (${validChannelIds.length}/3 แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`,
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
        
        // --- 1. การกดปุ่มนับ (COUNT_BUTTON_ID) ---
        if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
            try {
                // DeferReply แบบ Ephemeral เพื่อให้ผู้ใช้เห็นสถานะ
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const activeChannelIds = CONFIG.CHANNEL_IDS.slice(0, 3);
                if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || activeChannelIds.length === 0) {
                    return await interaction.editReply({
                        content: "❌ **การตั้งค่าไม่สมบูรณ์!** โปรดตั้งค่า Sheet ID, Sheet Name และ Channel IDs ในปุ่มตั้งค่าก่อน",
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.editReply("⏳ กำลังล้างข้อมูลการนับเก่าใน Sheet และเตรียมเริ่มนับข้อความเก่า...");
                await clearCountsOnly();

                // Array สำหรับเก็บสถานะของแต่ละ Channel ที่กำลังประมวลผล/เสร็จสิ้น
                const totalProcessedPerChannel = activeChannelIds.map((id, index) => 
                    `⏳ Channel ${index + 1}: <#${id}> (รอเริ่ม...)`
                );
                
                // ลูปประมวลผลแต่ละ Channel
                for (let i = 0; i < activeChannelIds.length; i++) {
                    await processOldMessages(client, interaction, activeChannelIds[i], i, totalProcessedPerChannel);
                }

                // สิ้นสุดการประมวลผลทั้งหมด
                await interaction.editReply({
                    content: `🎉 **การนับข้อความเก่าเสร็จสมบูรณ์!** ผลลัพธ์:\n\n${totalProcessedPerChannel.join('\n')}\n\nข้อความนี้จะถูกลบใน 5 วินาที`,
                    components: [],
                });
                
                await new Promise((r) => setTimeout(r, 5000));
                await interaction.deleteReply().catch(() => {});

            } catch (error) {
                console.error("[Historical Count Error]:", error);
                await interaction.editReply({
                    content: "❌ เกิดข้อผิดพลาดระหว่างการนับสถิติ โปรดตรวจสอบ Log ของบอท: " + error.message,
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
            return;
        }

        // --- 2. การกดปุ่มตั้งค่า (CONFIG_BUTTON_ID) --- (เหมือนเดิม)
        if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
            try {
                const modal = new ModalBuilder()
                    .setCustomId(CONFIG_MODAL_ID)
                    .setTitle('🛠️ ตั้งค่าการเชื่อมต่อ');

                const spreadsheetInput = new TextInputBuilder()
                    .setCustomId('spreadsheet_id_input')
                    .setLabel('Google Spreadsheet ID')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(CONFIG.SPREADSHEET_ID || '');

                const sheetNameInput = new TextInputBuilder()
                    .setCustomId('sheet_name_input')
                    .setLabel('ชื่อชีต (Sheet Name)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(CONFIG.SHEET_NAME || '');

                const channelListInput = new TextInputBuilder()
                    .setCustomId('channel_list_input')
                    .setLabel(`Channel IDs (คั่นด้วย ,) เทค2,คดีปกติ,คุมสอบ`) 
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue(CONFIG.CHANNEL_IDS?.join(', ') || '');

                const batchDelayInput = new TextInputBuilder()
                    .setCustomId('batch_delay_input')
                    .setLabel('Batch Delay (ms) — แนะนำ 100-500')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(CONFIG.BATCH_DELAY?.toString() || '150');

                const row1 = new ActionRowBuilder().addComponents(spreadsheetInput);
                const row2 = new ActionRowBuilder().addComponents(sheetNameInput);
                const row3 = new ActionRowBuilder().addComponents(channelListInput);
                const row4 = new ActionRowBuilder().addComponents(batchDelayInput);

                modal.addComponents(row1, row2, row3, row4);
                await interaction.showModal(modal);

            } catch (error) {
                console.error('❌ Error showing modal:', error);
                if (!interaction.replied) {
                    await interaction.reply({ content: 'เกิดข้อผิดพลาดในการเปิดหน้าต่างตั้งค่า ❌', flags: MessageFlags.Ephemeral });
                }
            }
            return;
        }

        // --- 3. การส่งข้อมูลจาก Modal (CONFIG_MODAL_ID) --- (เหมือนเดิม)
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
                                     ? newChannelIdsRaw.split(',').map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)).slice(0, 3) 
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

                    if (existingControlMessage) {
                        await existingControlMessage.edit(getStartCountMessage());
                        console.log("✅ Updated control message with new config.");
                    }
                }

                await interaction.editReply({
                    content: `✅ **บันทึกการตั้งค่าและอัปเดตสถานะเรียบร้อย!** ข้อความนี้จะถูกลบใน 5 วินาที`,
                    flags: MessageFlags.Ephemeral
                });

                await new Promise((r) => setTimeout(r, 5000));
                await interaction.deleteReply().catch(() => {});

            } catch (error) {
                console.error("❌ Error processing modal submit or updating message:", error);
                await interaction.editReply({
                    content: `❌ **เกิดข้อผิดพลาดในการบันทึกค่า!** โปรดตรวจสอบ Log ของบอท`,
                    flags: MessageFlags.Ephemeral
                });

            }
        }
    });
}

module.exports = {
    initializeCountCase
};
