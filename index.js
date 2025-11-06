require("dotenv").config();
// นำ fs กลับมาใช้งาน
const fs = require("fs"); 
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
    ChannelType,
} = require("discord.js");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const http = require("http");

// =========================================================
// 🌐 CONFIG, CONSTANTS & INITIALIZATION
// =========================================================

// 1. โหลด Service Account Credentials (ยังคงดึงจาก Env Vars)
const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null, 
};

if (!credentials.client_email || !credentials.private_key) {
    console.warn("⚠️ Google Sheets credentials (CLIENT_EMAIL/PRIVATE_KEY) not fully loaded from environment variables.");
}

// 2. CONFIG: ย้ายค่าที่ปรับได้ไป config.json และค่าที่ไม่ปรับได้ไป Env Vars
const MAX_CHANNELS = 3; 
let CONFIG = {}; // กำหนด CONFIG เป็น Object ว่างก่อน
const CONFIG_FILE = "config.json"; // ชื่อไฟล์ Config ที่จะใช้

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE);
        // โหลดค่า SPREADSHEET_ID, SHEET_NAME, CHANNEL_IDS, BATCH_DELAY, UPDATE_DELAY
        CONFIG = JSON.parse(data); 
        console.log("✅ Loaded configuration from config.json.");
    } catch (e) {
        console.error("❌ Failed to load config.json, using defaults.");
        // กำหนดค่า Default หากไฟล์ไม่มี/อ่านไม่ได้
        CONFIG = {
            SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
            SHEET_NAME: process.env.SHEET_NAME || 'Sheet1', 
            CHANNEL_IDS: [],
            BATCH_DELAY: 500,
            UPDATE_DELAY: 50,
        };
    }
    
    // **ดึงค่าสำคัญที่ไม่ควรเปลี่ยนผ่านปุ่ม (COMMAND_CHANNEL_ID) จาก Env Vars เสมอ**
    CONFIG.COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID || '0';
}

function saveConfig() {
    // กรองเฉพาะค่าที่สามารถบันทึกได้กลับเข้าไฟล์ config.json
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

// เรียกใช้ loadConfig ทันทีที่เริ่มต้น
loadConfig(); 

// Discord Custom IDs
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";

const STARTING_ROW = 4; 

// Google Sheets setup
const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const gsapi = google.sheets({ version: "v4", auth });

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// =========================================================
// ⚙️ GOOGLE SHEET FUNCTIONS (OPTIMIZED)
// =========================================================
// **(โค้ดส่วนนี้ไม่ต้องแก้ไข)**
async function clearCountsOnly() {
    // ... (โค้ดเดิม)
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:${String.fromCharCode(65 + 2 + CONFIG.CHANNEL_IDS.length - 1)}`;
    try {
        await gsapi.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range,
        });
        console.log(
            "✅ Cleared previous mention counts (C:...) but kept usernames.",
        );
    } catch (error) {
        console.error("❌ Error clearing counts:", error);
        throw error;
    }
}

async function batchUpdateMentions(batchMap, channelIndex) {
    // ... (โค้ดเดิม)
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${String.fromCharCode(65 + 1 + channelCount)}`;
    
    // 1. อ่านข้อมูลทั้งหมดมาในครั้งเดียว (Batch Read)
    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });
    
    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1])); 
    
    const updates = [];
    const colIndex = 2 + channelIndex; 
    const colLetter = String.fromCharCode(65 + colIndex);

    for (const [key, count] of batchMap.entries()) {
        const [displayName, username] = key.split("|");
        
        let rowIndex = rows.findIndex(
            (r) => r[0] === displayName && r[1] === username,
        );
        
        if (rowIndex >= 0) {
            const sheetRowIndex = STARTING_ROW + rowIndex; 
            const currentRange = `${CONFIG.SHEET_NAME}!${colLetter}${sheetRowIndex}`;
            
            const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
            const newCount = currentValue + count;
            
            updates.push({
                range: currentRange,
                values: [[newCount]],
            });
            
            rows[rowIndex][colIndex] = String(newCount); 
            
        } else {
            const appendRow = STARTING_ROW + rows.length;
            const newRow = [displayName, username, ...Array(channelCount).fill(0).map(String)]; 
            newRow[colIndex] = count;
            
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${String.fromCharCode(65 + 1 + channelCount)}${appendRow}`,
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


// =========================================================
// 💬 DISCORD MESSAGE PROCESSING
// =========================================================
// **(โค้ดส่วนนี้ไม่ต้องแก้ไข)**
async function processMessagesBatch(messages, channelIndex) {
    // ... (โค้ดเดิม)
    const batchMap = new Map();
    const userCache = new Map();

    for (const message of messages) {
        if (message.author.bot) continue;
        if (!message.content.includes("<@")) continue;

        const mentionRegex = /<@!?(\d+)>/g;
        let match;

        while ((match = mentionRegex.exec(message.content)) !== null) {
            const id = match[1];
            let displayName, username;

            if (userCache.has(id)) {
                ({ displayName, username } = userCache.get(id));
            } else {
                try {
                    const member = await message.guild.members.fetch(id);
                    displayName = member.displayName;
                    username = member.user.username;
                } catch {
                    const user = await client.users.fetch(id);
                    displayName = user.username;
                    username = user.username;
                }
                userCache.set(id, { displayName, username });
            }

            const key = `${displayName}|${username}`;
            batchMap.set(key, (batchMap.get(key) || 0) + 1);
        }
    }

    if (batchMap.size > 0) {
        await batchUpdateMentions(batchMap, channelIndex);
    }
}

async function processOldMessages(channelId, channelIndex) {
    // ... (โค้ดเดิม)
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.log(`❌ Channel ${channelId} not found. Skipping.`);

        let lastId = null;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            await processMessagesBatch([...messages.values()], channelIndex);
            lastId = messages.last().id;
            await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY)); 
        }

        console.log(
            `✅ Finished processing old messages for channel ${channel.name} (${channelId})`,
        );
    } catch (error) {
        console.error(`❌ Error processing channel ${channelId}:`, error.message);
    }
}

// =========================================================
// 🎨 DISCORD UI & EVENT HANDLERS
// =========================================================

function getStartCountMessage() {
    // **(แก้ไข Label ของปุ่มให้ถูกต้อง)**
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
    
    // **(แก้ไขข้อความสถานะให้ถูกต้อง)**
    return {
        content: `⚠️ สถานะปัจจุบัน (ดึงจาก config.json):\n> Sheet ID: **${CONFIG.SPREADSHEET_ID}**\n> Sheet Name: **${CONFIG.SHEET_NAME}**\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS} แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`,
        components: [row],
    };
}

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        const commandChannel = await client.channels.fetch(
            CONFIG.COMMAND_CHANNEL_ID,
        );
        if (commandChannel && commandChannel.isTextBased()) {
            await commandChannel.send(getStartCountMessage());
            console.log(
                `✅ Sent control buttons to channel ${CONFIG.COMMAND_CHANNEL_ID}`,
            );
        }
    } catch (error) {
        console.error("❌ Error sending control buttons:", error);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    // --- 1. การกดปุ่มนับ (COUNT_BUTTON_ID) ---
    // **(โค้ดส่วนนี้ไม่ต้องแก้ไข)**
    if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
        try {
            await interaction.deferReply(); 

            if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || CONFIG.CHANNEL_IDS.length === 0) {
                // **(แก้ไขข้อความ Error ให้สอดคล้องกับการใช้ config.json)**
                return await interaction.editReply({ 
                    content: "❌ **การตั้งค่าไม่สมบูรณ์!** โปรดตั้งค่า Sheet ID, Sheet Name และ Channel IDs ในปุ่มตั้งค่าก่อน",
                    ephemeral: true 
                });
            }

            await interaction.editReply("⏳ กำลังล้างข้อมูลการนับเก่าใน Sheet และเริ่มนับข้อความเก่า... โปรดรอสักครู่");
            await clearCountsOnly();

            for (let i = 0; i < CONFIG.CHANNEL_IDS.length; i++) {
                await processOldMessages(CONFIG.CHANNEL_IDS[i], i);
            }
            
            const replyMsg = await interaction.editReply({
                content: "🎉 **การนับข้อความเก่าเสร็จสมบูรณ์!** ข้อความนี้จะถูกลบใน 5 วินาที",
                components: [],
            });
            await new Promise((r) => setTimeout(r, 5000));
            await replyMsg.delete().catch(() => {}); 
            
        } catch (error) {
            console.error("[Historical Count Error]:", error);
            await interaction.editReply({
                content: "❌ เกิดข้อผิดพลาดระหว่างการนับสถิติ โปรดตรวจสอบ Log ของบอท",
                ephemeral: true 
            });
        }
        return;
    }

    // --- 2. การกดปุ่มตั้งค่า (CONFIG_BUTTON_ID) ---
    // **(แก้ไข Label และเพิ่ม Input fields สำหรับ BATCH_DELAY, UPDATE_DELAY)**
    if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
        const modal = new ModalBuilder()
            .setCustomId(CONFIG_MODAL_ID)
            .setTitle('⚙️ แก้ไข Config (บันทึกในไฟล์)');

        const spreadsheetIdInput = new TextInputBuilder()
            .setCustomId('spreadsheet_id_input')
            .setLabel("Google Sheet ID")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(CONFIG.SPREADSHEET_ID);

        const sheetNameInput = new TextInputBuilder()
            .setCustomId('sheet_name_input')
            .setLabel("Sheet Name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(CONFIG.SHEET_NAME);
            
        const channelIds = (CONFIG.CHANNEL_IDS || []).join(', ');

        const channelListInput = new TextInputBuilder()
            .setCustomId('channel_list_input')
            .setLabel("Channel IDs (รูปแบบ: id1,id2,id3)")
            .setStyle(TextInputStyle.Paragraph) 
            .setRequired(false) 
            .setValue(channelIds);
            
        // **เพิ่ม Input สำหรับ BATCH_DELAY**
        const batchDelayInput = new TextInputBuilder()
            .setCustomId('batch_delay_input')
            .setLabel("Batch Delay (ms)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true) 
            .setValue(String(CONFIG.BATCH_DELAY || 500));

        // **เพิ่ม Input สำหรับ UPDATE_DELAY (ไม่เกิน 5 Input)**
        // *หมายเหตุ: Discord Modal จำกัดได้แค่ 5 ช่อง, เราจะละ UPDATE_DELAY ไปก่อนเพื่อไม่ให้เกิน*
        // *หากต้องการเพิ่ม UPDATE_DELAY ต้องยุบรวมช่องใดช่องหนึ่ง*
        
        modal.addComponents(
            new ActionRowBuilder().addComponents(spreadsheetIdInput),
            new ActionRowBuilder().addComponents(sheetNameInput),
            new ActionRowBuilder().addComponents(channelListInput),
            new ActionRowBuilder().addComponents(batchDelayInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // --- 3. การส่งข้อมูลจาก Modal (CONFIG_MODAL_ID) ---
    // **(นำ Logic การดึงค่าและบันทึกกลับมา)**
    if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
        await interaction.deferReply({ ephemeral: true }); 
        
        try {
            // ดึงค่าจาก Modal
            const newSpreadsheetId = interaction.fields.getTextInputValue('spreadsheet_id_input');
            const newSheetName = interaction.fields.getTextInputValue('sheet_name_input');
            const newChannelIdsRaw = interaction.fields.getTextInputValue('channel_list_input');
            const newBatchDelayRaw = interaction.fields.getTextInputValue('batch_delay_input');
            
            // ประมวลผลและอัปเดต CONFIG
            CONFIG.SPREADSHEET_ID = newSpreadsheetId;
            CONFIG.SHEET_NAME = newSheetName;
            
            // ประมวลผล Channel IDs
            CONFIG.CHANNEL_IDS = newChannelIdsRaw 
                                 ? newChannelIdsRaw.split(',').map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)).slice(0, MAX_CHANNELS)
                                 : [];
            
            // ประมวลผล Delay
            CONFIG.BATCH_DELAY = parseInt(newBatchDelayRaw) || 500;
            
            // **บันทึกค่าลงไฟล์**
            saveConfig(); 
            
            // ตอบกลับผู้ใช้
            await interaction.editReply({
                content: `✅ **บันทึกการตั้งค่าเรียบร้อย!** บอทจะเริ่มใช้ค่าใหม่ทันที`,
                ephemeral: true
            });

        } catch (error) {
            console.error("❌ Error processing modal submit:", error);
             await interaction.editReply({
                content: `❌ **เกิดข้อผิดพลาดในการบันทึกค่า!** โปรดตรวจสอบ Log ของบอท`,
                ephemeral: true
            });
        }
        return;
    }
});

// =========================================================
// 🌐 KEEP-ALIVE SERVER & LOGIN
// =========================================================

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(3000, () => console.log("🌐 Web server running on port 3000."));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
