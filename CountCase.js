// CountCase.js (โมดูลจัดการการนับสถิติและการตั้งค่า - ฉบับเต็มพร้อมแก้ไข)

const fs = require("fs");
const {
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    // ChannelType, // ไม่ได้ถูกใช้โดยตรง
    MessageFlags
} = require("discord.js");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// ---------------------------------------------------------
// 1. GOOGLE AUTH SETUP (เหมือนเดิม)
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
// ⚠️ แก้ไข: MAX_CHANNELS เป็น 4 เพื่อรองรับ 4 คอลัมน์สถิติ (C, D, E, F)
const MAX_CHANNELS = 4;
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
// 3. GOOGLE SHEET FUNCTIONS
// ---------------------------------------------------------

async function clearCountsOnly() {
    // 💡 แก้ไข: ล้างข้อมูลถึงคอลัมน์ F (C:F)
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

// ✅ แก้ไข: เพิ่ม parameter 'colIndexToUpdate' เพื่อระบุคอลัมน์ที่จะอัปเดตได้ (C=2, D=3, E=4, F=5)
async function batchUpdateMentions(batchMap, colIndexToUpdate) {
    // ⚠️ ใช้ MAX_CHANNELS เป็นตัวบอกจำนวนคอลัมน์สถิติที่คาดหวัง (C, D, E, F = 4 คอลัมน์)
    const countCols = MAX_CHANNELS; 
    
    // 💡 ปรับให้ดึงข้อมูลกว้างขึ้น: A:B (ชื่อ) และ C ถึงคอลัมน์สุดท้ายของการนับ (เช่น F)
    const lastCountColLetter = String.fromCharCode(65 + 1 + countCols); // 65+1+4 = G
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${lastCountColLetter}`;

    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });

    // กรองแถวที่มีข้อมูลในคอลัมน์ A หรือ B
    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));

    const updates = [];
    const colLetter = String.fromCharCode(65 + colIndexToUpdate);

    for (const [key, count] of batchMap.entries()) {
        const [displayName, username] = key.split("|");

        let rowIndex = rows.findIndex(
            (r) => r[0] === displayName && r[1] === username,
        );

        if (rowIndex >= 0) {
            const sheetRowIndex = STARTING_ROW + rowIndex;
            const currentRange = `${CONFIG.SHEET_NAME}!${colLetter}${sheetRowIndex}`;

            // ⚠️ ใช้ colIndexToUpdate ในการเข้าถึงคอลัมน์
            const currentValue = parseInt(rows[rowIndex][colIndexToUpdate] || "0"); 
            const newCount = currentValue + count;

            updates.push({
                range: currentRange,
                values: [[newCount]],
            });

            // อัปเดตข้อมูลในอาร์เรย์ rows เพื่อใช้ในการเช็คครั้งต่อไป
            rows[rowIndex][colIndexToUpdate] = String(newCount); 

        } else {
            const appendRow = STARTING_ROW + rows.length;
            // 💡 สร้างแถวใหม่พร้อมคอลัมน์นับที่เว้นว่างจนถึงคอลัมน์สุดท้ายของการนับ
            const newRow = [displayName, username, ...Array(countCols).fill(0).map(String)]; 
            
            // ⚠️ กำหนดค่า Count ในคอลัมน์ที่ต้องการอัปเดต
            newRow[colIndexToUpdate] = count; 

            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${lastCountColLetter}${appendRow}`,
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
// 4. DISCORD MESSAGE PROCESSING (รองรับการนับผู้โพสต์)
// ---------------------------------------------------------

// ✅ แก้ไข: processMessagesBatch (เพิ่มการนับผู้โพสต์สำหรับ Channel 2)
async function processMessagesBatch(client, messages, channelIndex) {
    const mentionMap = new Map();
    const authorMap = new Map(); // 💡 แผนที่ใหม่สำหรับนับผู้โพสต์
    const userCache = new Map();

    for (const message of messages) {
        if (message.author.bot) continue;

        // 1. นำ ID ผู้ถูกแท็กที่ไม่ซ้ำทั้งหมดไปเพิ่มใน mentionMap
        if (message.content.includes("<@")) {
            const uniqueMentionedIds = new Set();
            const mentionRegex = /<@!?(\d+)>/g;
            let match;

            while ((match = mentionRegex.exec(message.content)) !== null) {
                const id = match[1];
                uniqueMentionedIds.add(id);
            }

            for (const id of uniqueMentionedIds) {
                let displayName, username;

                if (userCache.has(id)) {
                    ({ displayName, username } = userCache.get(id));
                } else {
                    // โค้ดสำหรับดึงข้อมูลผู้ใช้/สมาชิก
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
                         try {
                            const user = await client.users.fetch(id);
                            displayName = user.username;
                            username = user.username;
                         } catch {
                            continue; // ข้ามถ้าหาผู้ใช้ไม่ได้จริงๆ
                         }
                    }
                    userCache.set(id, { displayName, username });
                }

                const key = `${displayName}|${username}`;
                // เพิ่มการนับแท็กเพียง 1 ครั้งสำหรับผู้ถูกแท็กแต่ละคนในข้อความ
                mentionMap.set(key, (mentionMap.get(key) || 0) + 1);
            }
        }
        
        // 2. 💡 เพิ่ม Logic การนับผู้โพสต์สำหรับ Channel 2 (channelIndex = 1)
        if (channelIndex === 1) { 
            let displayName, username;
            const id = message.author.id;
            
            if (userCache.has(id)) {
                ({ displayName, username } = userCache.get(id));
            } else {
                // ดึงข้อมูลผู้โพสต์ (Author)
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
                     try {
                        const user = await client.users.fetch(id);
                        displayName = user.username;
                        username = user.username;
                     } catch {
                        continue; // ข้ามถ้าหาผู้ใช้ไม่ได้
                     }
                }
                userCache.set(id, { displayName, username });
            }

            const authorKey = `${displayName}|${username}`;
            // เพิ่มการนับผู้โพสต์ 1 ครั้งต่อข้อความ
            authorMap.set(authorKey, (authorMap.get(authorKey) || 0) + 1);
        }
    }

    // 3. 💡 อัปเดต Mentions (ใช้ colIndex = 2, 3, 5)
    if (mentionMap.size > 0) {
        // Channel 1 Mentions (Col C)
        if (channelIndex === 0) {
            await batchUpdateMentions(mentionMap, 2); 
        }
        // Channel 2 Mentions (Col D)
        if (channelIndex === 1) {
            await batchUpdateMentions(mentionMap, 3);
        }
        // Channel 3 Mentions (Col F)
        if (channelIndex === 2) { 
            await batchUpdateMentions(mentionMap, 5); 
        }
    }
    
    // 4. 💡 อัปเดต Author Count (ใช้ colIndex = 4)
    if (authorMap.size > 0 && channelIndex === 1) {
        // เฉพาะ Channel Index 1 เท่านั้นที่นับผู้โพสต์ และใส่ใน Col E (Index 4)
        await batchUpdateMentions(authorMap, 4); 
    }
}

// 📌 ฟังก์ชัน processOldMessages (เหมือนเดิม)
async function processOldMessages(client, channelId, channelIndex) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.log(`❌ Channel ${channelId} not found. Skipping.`);

        let lastId = null;
        let processedCount = 0;

        console.log(`⏳ Starting process for channel ${channel.name} (${channelId})`);

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            await processMessagesBatch(client, [...messages.values()], channelIndex);
            
            processedCount += messages.size;
            console.log(`> Processed ${processedCount} messages in channel ${channel.name}...`);

            lastId = messages.last().id;
            await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY));
        }

        console.log(
            `✅ Finished processing ${processedCount} old messages for channel ${channel.name} (${channelId})`,
        );
    } catch (error) {
        console.error(`❌ Error processing channel ${channelId}:`, error.message);
    }
}

// ---------------------------------------------------------
// 5. MODULE INITIALIZATION
// ---------------------------------------------------------

// 🎨 DISCORD UI HANDLER (ใช้ MAX_CHANNELS เดิมคือ 3 สำหรับการแสดง Channel ID ที่ตั้งค่า)
function getStartCountMessage() {
    // จำกัด Channel IDs ที่จะแสดงผลไว้ที่ 3 (Channel 1, 2, 3)
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
        if (index === 0) label += ' C:Mentions)';
        else if (index === 1) label += ' D:Mentions, E:Author)';
        else if (index === 2) label += ' F:Mentions)';
        return label;
    }).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';

    return {
        content: `⚠️ สถานะปัจจุบัน (ดึงจาก config.json):\n> Sheet ID: **${CONFIG.SPREADSHEET_ID || 'ไม่ได้ตั้งค่า'}**\n> Sheet Name: **${CONFIG.SHEET_NAME || 'ไม่ได้ตั้งค่า'}**\n> Batch Delay: **${CONFIG.BATCH_DELAY}ms**\n> Channel ที่นับ (${validChannelIds.length}/3 แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`,
        components: [row],
    };
}


// ✅ แก้ไข: รับ commandChannelId เข้ามา
function initializeCountCase(client, commandChannelId) {
    // ⭐️ กำหนดค่า Channel ID ควบคุมให้กับ CONFIG
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
                // ✅ สำคัญ: Defer ทันที
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const activeChannelIds = CONFIG.CHANNEL_IDS.slice(0, 3); // ใช้แค่ 3 Channel แรก
                if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || activeChannelIds.length === 0) {
                    return await interaction.editReply({
                        content: "❌ **การตั้งค่าไม่สมบูรณ์!** โปรดตั้งค่า Sheet ID, Sheet Name และ Channel IDs ในปุ่มตั้งค่าก่อน",
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.editReply("⏳ กำลังล้างข้อมูลการนับเก่าใน Sheet และเริ่มนับข้อความเก่า... โปรดรอสักครู่");
                await clearCountsOnly();

                // ประมวลผลตาม Channel ID ที่ถูกตั้งค่าไว้ (สูงสุด 3 ช่อง)
                for (let i = 0; i < activeChannelIds.length; i++) {
                    await processOldMessages(client, activeChannelIds[i], i);
                }

                await interaction.editReply({
                    content: "🎉 **การนับข้อความเก่าเสร็จสมบูรณ์!** ข้อความนี้จะถูกลบใน 5 วินาที",
                    components: [],
                });
                
                await new Promise((r) => setTimeout(r, 5000));
                await interaction.deleteReply().catch(() => {});

            } catch (error) {
                console.error("[Historical Count Error]:", error);
                await interaction.editReply({
                    content: "❌ เกิดข้อผิดพลาดระหว่างการนับสถิติ โปรดตรวจสอบ Log ของบอท",
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        // --- 2. การกดปุ่มตั้งค่า (CONFIG_BUTTON_ID) ---
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
                    // 💡 แก้ไข Label เพื่อบอกจำนวนสูงสุดที่รองรับ
                    .setLabel(`Channel IDs (คั่นด้วย ,) - สูงสุด 3 ช่อง`) 
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

        // --- 3. การส่งข้อมูลจาก Modal (CONFIG_MODAL_ID) ---
        if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const newSpreadsheetId = interaction.fields.getTextInputValue('spreadsheet_id_input');
                const newSheetName = interaction.fields.getTextInputValue('sheet_name_input');
                const newChannelIdsRaw = interaction.fields.getTextInputValue('channel_list_input');
                const newBatchDelayRaw = interaction.fields.getTextInputValue('batch_delay_input');

                // บันทึกค่าใหม่ลงใน CONFIG object
                CONFIG.SPREADSHEET_ID = newSpreadsheetId;
                CONFIG.SHEET_NAME = newSheetName;
                // 💡 จำกัด Channel ID ที่นำมาใช้ให้เหลือสูงสุด 3 ช่อง
                CONFIG.CHANNEL_IDS = newChannelIdsRaw
                                                 ? newChannelIdsRaw.split(',').map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)).slice(0, 3) 
                                                 : [];
                CONFIG.BATCH_DELAY = parseInt(newBatchDelayRaw) || 150;

                // 1. บันทึก CONFIG ลงไฟล์
                saveConfig();

                // 2. อัปเดตข้อความควบคุมเดิม
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

                // 3. แก้ไข Reply ให้แสดงผลสำเร็จ
                await interaction.editReply({
                    content: `✅ **บันทึกการตั้งค่าและอัปเดตสถานะเรียบร้อย!** ข้อความนี้จะถูกลบใน 5 วินาที`,
                    flags: MessageFlags.Ephemeral
                });

                // 4. รอนาน 5 วินาทีและลบข้อความตอบกลับ
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
