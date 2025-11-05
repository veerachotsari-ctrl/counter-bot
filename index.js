require("dotenv").config();
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
const fs = require("fs");
const http = require("http"); // แก้ไขการเรียกใช้ HTTP

// =========================================================
// 🌐 CONFIG, CONSTANTS & INITIALIZATION
// =========================================================

// 1. โหลด Service Account Credentials
const credentials = {
    // ดึงอีเมลจาก Render Env Var ที่ชื่อ CLIENT_EMAIL
    client_email: process.env.CLIENT_EMAIL,
    // ดึง Private Key จาก Render Env Var ที่ชื่อ PRIVATE_KEY
    // ต้องแปลง Private Key ที่ถูกจัดเก็บใน Env Var ให้กลับมามี Newline (\n) เพื่อให้ JWT ใช้งานได้
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null, 
};
// เพิ่มการตรวจสอบ (Optional แต่มีประโยชน์)
if (!credentials.client_email || !credentials.private_key) {
    console.warn("⚠️ Google Sheets credentials (CLIENT_EMAIL/PRIVATE_KEY) not fully loaded from environment variables.");
}

// 2. โหลด CONFIG จากไฟล์ (เพื่อให้ค่าคงทน)
let CONFIG;
try {
    CONFIG = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
    console.log("✅ Loaded configuration from config.json");
} catch (error) {
    console.error("❌ Error loading config.json. Attempting to use default Env Vars.", error);
    // หากโหลด config.json ล้มเหลว ให้ตั้งค่าพื้นฐานที่จำเป็นจาก Env Var
    CONFIG = {
        COMMAND_CHANNEL_ID: process.env.COMMAND_CHANNEL_ID || '0', // ต้องตั้งค่าใน Render
        SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
        SHEET_NAME: 'Sheet1', // ค่าเริ่มต้น
        CHANNEL_IDS: [],
    };
}

function saveConfig() {
    try {
        // กรอง Channel ID ว่างเปล่าออกก่อนบันทึก
        CONFIG.CHANNEL_IDS = CONFIG.CHANNEL_IDS.filter(id => id && id.length > 10 && !isNaN(id)); 
        fs.writeFileSync("./config.json", JSON.stringify(CONFIG, null, 4), "utf-8");
        console.log("💾 Configuration saved to config.json");
    } catch (error) {
        console.error("❌ Error saving configuration:", error);
    }
}

// Discord Custom IDs
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";

const MAX_CHANNELS = 3;
const STARTING_ROW = 4; // แถวเริ่มต้นบันทึกข้อมูล (นับรวม Header แล้ว)

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

async function clearCountsOnly() {
    // คำนวณขอบเขตคอลัมน์ C ไปจนถึงคอลัมน์ที่รองรับจำนวน Channel IDs ทั้งหมด
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
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${String.fromCharCode(65 + 1 + channelCount)}`;
    
    // 1. อ่านข้อมูลทั้งหมดมาในครั้งเดียว (Batch Read)
    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });

    // rows คือข้อมูลตั้งแต่ A4 ลงมา
    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1])); 
    
    const updates = [];
    const colIndex = 2 + channelIndex; // C=2, D=3, E=4...
    const colLetter = String.fromCharCode(65 + colIndex);

    for (const [key, count] of batchMap.entries()) {
        const [displayName, username] = key.split("|");
        
        let rowIndex = rows.findIndex(
            (r) => r[0] === displayName && r[1] === username,
        );
        
        if (rowIndex >= 0) {
            // ผู้ใช้เดิม: คำนวณค่าใหม่ในหน่วยความจำ
            const sheetRowIndex = STARTING_ROW + rowIndex; 
            const currentRange = `${CONFIG.SHEET_NAME}!${colLetter}${sheetRowIndex}`;
            
            // ดึงค่าปัจจุบันจาก Array ที่ดึงมาทั้งหมด
            const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
            const newCount = currentValue + count;
            
            updates.push({
                range: currentRange,
                values: [[newCount]],
            });
            
            // อัปเดตค่าใน rows array ด้วย (สำคัญ: เพื่อให้การค้นหาใน batchMap รอบถัดไปใช้ค่าใหม่ได้ทันที)
            rows[rowIndex][colIndex] = String(newCount); 
            
        } else {
            // ผู้ใช้ใหม่: สร้างแถวใหม่
            const appendRow = STARTING_ROW + rows.length;
            // สร้างแถวที่มี [DisplayName, Username, 0, 0, ...]
            const newRow = [displayName, username, ...Array(channelCount).fill(0).map(String)]; 
            newRow[colIndex] = count;
            
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${String.fromCharCode(65 + 1 + channelCount)}${appendRow}`,
                values: [newRow],
            });
            // เพิ่มแถวใหม่เข้าไปใน rows เพื่อใช้ในการตรวจสอบรอบถัดไป
            rows.push(newRow); 
        }
    }
    
    // 2. ส่งข้อมูลอัปเดตกลับไปในครั้งเดียว (Batch Write)
    if (updates.length > 0) {
        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: {
                valueInputOption: "RAW",
                data: updates.map(u => ({ range: u.range, values: u.values })),
            }
        });
    }

    // หน่วงเวลาเพื่อหลีกเลี่ยงข้อจำกัดของ Google Sheets API
    await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY || 500)); 
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
                    // พยายาม fetch เป็น Member ก่อน เพื่อให้ได้ displayName (Nickname)
                    const member = await message.guild.members.fetch(id);
                    displayName = member.displayName;
                    username = member.user.username;
                } catch {
                    // หากไม่สามารถ fetch เป็น Member ได้ (อาจจะออกจากเซิร์ฟเวอร์ไปแล้ว) ให้ fetch เป็น User
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
            // หน่วงเวลาเพื่อหลีกเลี่ยง rate limit ของ Discord/Google Sheets
            await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY || 500)); 
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
    const validChannelIds = CONFIG.CHANNEL_IDS.filter(id => id.length > 10 && !isNaN(id));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(COUNT_BUTTON_ID)
            .setLabel("⭐ เริ่มนับข้อความเก่า")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(CONFIG_BUTTON_ID)
            .setLabel("⚙️ ตั้งค่า Google Sheet/Channel")
            .setStyle(ButtonStyle.Secondary),
    );

    const channelList = validChannelIds.map(id => `- <#${id}>`).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';
    
    return {
        content: `⚠️ สถานะปัจจุบัน:\n> Sheet ID: **${CONFIG.SPREADSHEET_ID}**\n> Sheet Name: **${CONFIG.SHEET_NAME}**\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS} แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือตั้งค่าใหม่:`,
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
    if (interaction.isButton() && interaction.customId === COUNT_BUTTON_ID) {
        try {
            await interaction.deferReply(); 

            if (!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || CONFIG.CHANNEL_IDS.length === 0) {
                return await interaction.editReply({ 
                    content: "❌ **การตั้งค่าไม่สมบูรณ์!** โปรดตั้งค่า Sheet ID, Sheet Name และ Channel IDs ก่อนเริ่มนับ",
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
    if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
        const modal = new ModalBuilder()
            .setCustomId(CONFIG_MODAL_ID)
            .setTitle('⚙️ ตั้งค่า Google Sheet & Channel');

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
            
        const id1 = CONFIG.CHANNEL_IDS[0] || '';
        const id2 = CONFIG.CHANNEL_IDS[1] || '';
        const id3 = CONFIG.CHANNEL_IDS[2] || '';

        const channel1Input = new TextInputBuilder()
            .setCustomId('channel_id_1_input')
            .setLabel("Channel ID 1 (คอลัมน์ C)")
            .setStyle(TextInputStyle.Short) 
            .setRequired(true)
            .setValue(id1);

        const channel2Input = new TextInputBuilder()
            .setCustomId('channel_id_2_input')
            .setLabel("Channel ID 2 (คอลัมน์ D) *ทางเลือก*")
            .setStyle(TextInputStyle.Short)
            .setRequired(false) 
            .setValue(id2);

        const channel3Input = new TextInputBuilder()
            .setCustomId('channel_id_3_input')
            .setLabel("Channel ID 3 (คอลัมน์ E) *ทางเลือก*")
            .setStyle(TextInputStyle.Short)
            .setRequired(false) 
            .setValue(id3);

        modal.addComponents(
            new ActionRowBuilder().addComponents(spreadsheetIdInput),
            new ActionRowBuilder().addComponents(sheetNameInput),
            new ActionRowBuilder().addComponents(channel1Input), 
            new ActionRowBuilder().addComponents(channel2Input),  
            new ActionRowBuilder().addComponents(channel3Input)
        );

        await interaction.showModal(modal);
        return;
    }

    // --- 3. การส่งข้อมูลจาก Modal (CONFIG_MODAL_ID) ---
    if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
        // ลบ { ephemeral: true } ออกเพื่อให้บอทสามารถลบข้อความตอบกลับได้
        await interaction.deferReply(); 
        
        try {
            const newSpreadsheetId = interaction.fields.getTextInputValue('spreadsheet_id_input').trim();
            const newSheetName = interaction.fields.getTextInputValue('sheet_name_input').trim();
            
            const id1 = interaction.fields.getTextInputValue('channel_id_1_input').trim();
            const id2 = interaction.fields.getTextInputValue('channel_id_2_input').trim();
            const id3 = interaction.fields.getTextInputValue('channel_id_3_input').trim();

            let newChannelIds = [id1, id2, id3]
                .filter(id => id.length > 10 && !isNaN(id)) 
                .slice(0, MAX_CHANNELS);

            if (newChannelIds.length === 0) {
                 return await interaction.editReply({ 
                    content: "❌ **ตั้งค่าล้มเหลว:** ไม่พบ Channel ID ที่ถูกต้อง (ต้องมีอย่างน้อย 1 ช่อง) โปรดลองอีกครั้ง",
                    ephemeral: true 
                });
            }

            CONFIG.SPREADSHEET_ID = newSpreadsheetId;
            CONFIG.SHEET_NAME = newSheetName;
            CONFIG.CHANNEL_IDS = newChannelIds;
            
            saveConfig();

            const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
            if (commandChannel && interaction.message) {
                const message = await commandChannel.messages.fetch(interaction.message.id);
                await message.edit(getStartCountMessage());
            }

            const replyMsg = await interaction.editReply({
                content: `✅ **ตั้งค่า Bot ใหม่เรียบร้อยแล้ว!** ข้อความนี้จะถูกลบใน 5 วินาที\n> Sheet ID: ${newSpreadsheetId}\n> Sheet Name: ${newSheetName}\n> Channel IDs ที่บันทึก: ${newChannelIds.join(', ')}`,
            });
            await new Promise((r) => setTimeout(r, 5000));
            await replyMsg.delete().catch(() => {});

        } catch (error) {
            console.error("[Modal Submit Error]:", error);
            await interaction.editReply({
                content: "❌ เกิดข้อผิดพลาดในการบันทึกค่า โปรดตรวจสอบ Log ของบอท",
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
