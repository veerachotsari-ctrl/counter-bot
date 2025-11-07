require("dotenv").config();
const fs = require("fs");
const http = require("http");
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

// 2. CONFIG: ย้ายค่าที่ปรับได้ไป config.json
const MAX_CHANNELS = 3;
let CONFIG = {};
const CONFIG_FILE = "config.json";

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE);
        CONFIG = JSON.parse(data);
        console.log("✅ Loaded configuration from config.json.");
    } catch (e) {
        console.error("❌ Failed to load config.json, using defaults.");
        // กำหนดค่า Default หากไฟล์ไม่มี/อ่านไม่ได้
        CONFIG = {
            SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
            SHEET_NAME: process.env.SHEET_NAME || 'Sheet1',
            CHANNEL_IDS: [],
            BATCH_DELAY: 150, // ค่า Default ที่แนะนำ
            UPDATE_DELAY: 50,
        };
    }

    // ดึงค่าสำคัญที่ไม่ควรเปลี่ยนผ่านปุ่ม (COMMAND_CHANNEL_ID) จาก Env Vars เสมอ
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
// ⚙️ GOOGLE SHEET FUNCTIONS
// =========================================================

async function clearCountsOnly() {
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:E`; // ✅ ล้างเฉพาะ C–E ตั้งแต่แถวที่กำหนด (เช่น 4)
    try {
        await gsapi.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range,
        });
        console.log("✅ Cleared columns C–E (from row 4 down) but kept F–Z and header safe.");
    } catch (error) {
        console.error("❌ Error clearing counts:", error);
        throw error;
    }
}

async function batchUpdateMentions(batchMap, channelIndex) {
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${String.fromCharCode(65 + 1 + channelCount)}`;

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

async function processMessagesBatch(messages, channelIndex) {
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
        content: `⚠️ สถานะปัจจุบัน (ดึงจาก config.json):\n> Sheet ID: **${CONFIG.SPREADSHEET_ID}**\n> Sheet Name: **${CONFIG.SHEET_NAME}**\n> Batch Delay: **${CONFIG.BATCH_DELAY}ms**\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS} แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือแก้ไขการตั้งค่า:`,
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
            // 1. ตรวจสอบข้อความล่าสุด 5 ข้อความใน Command Channel
            const messages = await commandChannel.messages.fetch({ limit: 5 });

            // 2. หาว่ามีข้อความใดที่มีปุ่มควบคุมที่เราต้องการ (COUNT_BUTTON_ID) อยู่แล้วหรือไม่
            const existingControlMessage = messages.find(m =>
                m.components.length > 0 &&
                m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID)
            );

            if (existingControlMessage) {
                // หากพบข้อความเก่า ให้ตรวจสอบว่าสถานะตรงกันหรือไม่ แล้วแก้ไข (เพื่อให้มั่นใจว่าข้อมูลล่าสุด)
                const updatedMessage = getStartCountMessage();
                await existingControlMessage.edit(updatedMessage);
                console.log(
                    `ℹ️ Found and updated existing control buttons in channel ${CONFIG.COMMAND_CHANNEL_ID}.`,
                );
            } else {
                // 3. ถ้าไม่มีข้อความที่มีปุ่มอยู่แล้ว ให้ส่งข้อความใหม่
                await commandChannel.send(getStartCountMessage());
                console.log(
                    `✅ Sent new control buttons to channel ${CONFIG.COMMAND_CHANNEL_ID}`,
                );
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
            await interaction.deferReply();

            if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || CONFIG.CHANNEL_IDS.length === 0) {
                return await interaction.editReply({
                content: "❌ **การตั้งค่าไม่สมบูรณ์!** โปรดตั้งค่า Sheet ID, Sheet Name และ Channel IDs ในปุ่มตั้งค่าก่อน",
                flags: 64
            });

            }

            await interaction.editReply("⏳ กำลังล้างข้อมูลการนับเก่าใน Sheet และเริ่มนับข้อความเก่า... โปรดรอสักครู่");
            await clearCountsOnly();

            for (let i = 0; i < CONFIG.CHANNEL_IDS.length; i++) {
                await processOldMessages(CONFIG.CHANNEL_IDS[i], i);
            }

            // ใช้ interaction.editReply() และไม่เก็บค่า replyMsg
            await interaction.editReply({
                content: "🎉 **การนับข้อความเก่าเสร็จสมบูรณ์!** ข้อความนี้จะถูกลบใน 5 วินาที",
                components: [],
            });
            
            await new Promise((r) => setTimeout(r, 5000));
            // แก้ไข: ใช้ deleteReply() ซึ่งถูกต้องกว่าสำหรับ Interaction Reply
            await interaction.deleteReply().catch(() => {});

        } catch (error) {
            console.error("[Historical Count Error]:", error);
            await interaction.editReply({
            content: "❌ เกิดข้อผิดพลาดระหว่างการนับสถิติ โปรดตรวจสอบ Log ของบอท",
            flags: 64
        });
        }
        return;
    }

    // --- 2. การกดปุ่มตั้งค่า (CONFIG_BUTTON_ID) ---
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

        const batchDelayInput = new TextInputBuilder()
            .setCustomId('batch_delay_input')
            .setLabel("Batch Delay (ms)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(CONFIG.BATCH_DELAY || 150));

        // ❌ Note: เราละ UPDATE_DELAY ไว้เพื่อไม่ให้เกิน 5 Input

        modal.addComponents(
            new ActionRowBuilder().addComponents(spreadsheetIdInput),
            new ActionRowBuilder().addComponents(sheetNameInput),
            new ActionRowBuilder().addComponents(channelListInput),
            new ActionRowBuilder().addComponents(batchDelayInput)
        );

        // ✅ ป้องกันบอท Crash จาก Error 10062
        try {
            await interaction.showModal(modal);
        } catch (error) {
            console.error("❌ Error 10062: Failed to show modal, Interaction expired or already replied.", error.message);
            // ตอบกลับชั่วคราวเพื่อจบ Interaction และแจ้งให้ผู้ใช้ลองใหม่
            return interaction.reply({ 
            content: "❌ **เกิดข้อผิดพลาด!** กรุณาลองกดปุ่มตั้งค่าใหม่อีกครั้งทันที", 
            flags: 64
        }).catch(() => {});
        }
        return;
    }

    // --- 3. การส่งข้อมูลจาก Modal (CONFIG_MODAL_ID) ---
    if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
        // ต้อง deferReply ก่อน เพราะเราใช้ editReply()
        await interaction.deferReply({ flags: 64 });

        try {
            const newSpreadsheetId = interaction.fields.getTextInputValue('spreadsheet_id_input');
            const newSheetName = interaction.fields.getTextInputValue('sheet_name_input');
            const newChannelIdsRaw = interaction.fields.getTextInputValue('channel_list_input');
            const newBatchDelayRaw = interaction.fields.getTextInputValue('batch_delay_input');

            // บันทึกค่าใหม่ลงใน CONFIG object
            CONFIG.SPREADSHEET_ID = newSpreadsheetId;
            CONFIG.SHEET_NAME = newSheetName;
            CONFIG.CHANNEL_IDS = newChannelIdsRaw
                                 ? newChannelIdsRaw.split(',').map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)).slice(0, MAX_CHANNELS)
                                 : [];
            CONFIG.BATCH_DELAY = parseInt(newBatchDelayRaw) || 150;

            // 1. บันทึก CONFIG ลงไฟล์
            saveConfig();

            // 2. ***** หาและอัปเดตข้อความควบคุมเดิม *****
            const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);

            if (commandChannel && commandChannel.isTextBased()) {
                // ต้อง fetch ใหม่เพื่อหาข้อความที่มีปุ่มควบคุม
                const messages = await commandChannel.messages.fetch({ limit: 5 });
                const existingControlMessage = messages.find(m =>
                    m.components.length > 0 &&
                    m.components[0].components.some(c => c.customId === COUNT_BUTTON_ID)
                );

                if (existingControlMessage) {
                    // อัปเดตข้อความควบคุมหลักด้วยค่า CONFIG ใหม่
                    const updatedMessage = getStartCountMessage();
                    await existingControlMessage.edit(updatedMessage);
                    console.log("✅ Updated control message with new config.");
                }
            }
            // ********************************************

            // 3. แก้ไข Reply ให้แสดงผลสำเร็จ 
            await interaction.editReply({
            content: `✅ **บันทึกการตั้งค่าและอัปเดตสถานะเรียบร้อย!** ข้อความนี้จะถูกลบใน 5 วินาที`,
            flags: 64
        });

            // 4. รอนาน 5 วินาทีและลบข้อความตอบกลับ
            await new Promise((r) => setTimeout(r, 5000));
            await interaction.deleteReply().catch(() => {});

        } catch (error) {
            console.error("❌ Error processing modal submit or updating message:", error);
            await interaction.editReply({
            content: `❌ **เกิดข้อผิดพลาดในการบันทึกค่า!** โปรดตรวจสอบ Log ของบอท`,
            flags: 64
        });

        }
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
