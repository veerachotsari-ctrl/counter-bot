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
// const fs = require("fs"); // ลบการเรียกใช้ fs ออกไป
const http = require("http");

// =========================================================
// 🌐 CONFIG, CONSTANTS & INITIALIZATION
// =========================================================

// 1. โหลด Service Account Credentials
const credentials = {
    // ดึงอีเมลจาก Env Var ที่ชื่อ CLIENT_EMAIL
    client_email: process.env.CLIENT_EMAIL,
    // ดึง Private Key จาก Env Var ที่ชื่อ PRIVATE_KEY
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null, 
};

if (!credentials.client_email || !credentials.private_key) {
    console.warn("⚠️ Google Sheets credentials (CLIENT_EMAIL/PRIVATE_KEY) not fully loaded from environment variables.");
}

// 2. โหลด CONFIG จาก Environment Variables เท่านั้น (แทนที่ส่วนที่เคยอ่านไฟล์)
const MAX_CHANNELS = 3; // กำหนดค่าคงที่ Max Channel
let CONFIG = {
    // **ค่าเริ่มต้น** ที่บอทต้องการ
    COMMAND_CHANNEL_ID: process.env.COMMAND_CHANNEL_ID || '0', 
    SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
    SHEET_NAME: process.env.SHEET_NAME || 'Sheet1', 
    
    // โหลด Channel IDs จาก Env Var (สมมติว่ากำหนดในรูปแบบ 'id1,id2,id3')
    // และกรองให้เหลือไม่เกิน MAX_CHANNELS
    CHANNEL_IDS: (process.env.CHANNEL_IDS ? process.env.CHANNEL_IDS.split(',').map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)) : []).slice(0, MAX_CHANNELS),
    
    // ตั้งค่า BATCH_DELAY สำหรับ API Rate Limit
    BATCH_DELAY: parseInt(process.env.BATCH_DELAY || '500'),
};

console.log("✅ Loaded configuration from Environment Variables.");

// **ลบ** ฟังก์ชัน saveConfig() ออกไป เนื่องจากไม่ใช้ไฟล์ config.json แล้ว

// Discord Custom IDs
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";

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
            .setLabel("⚙️ ดูค่าที่ใช้งาน (ตั้งค่าต้องแก้ Env Var)") // แก้ไข Label
            .setStyle(ButtonStyle.Secondary),
    );

    const channelList = validChannelIds.map(id => `- <#${id}>`).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';
    
    return {
        content: `⚠️ สถานะปัจจุบัน (ดึงจาก Env Vars):\n> Sheet ID: **${CONFIG.SPREADSHEET_ID}**\n> Sheet Name: **${CONFIG.SHEET_NAME}**\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS} แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือดูค่า Env Vars:`,
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
                    content: "❌ **การตั้งค่าไม่สมบูรณ์!** โปรดตั้งค่า Sheet ID, Sheet Name และ Channel IDs ใน Environment Variables ก่อน",
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
    // เปลี่ยนพฤติกรรมเป็นการแสดงค่าปัจจุบันเท่านั้น เนื่องจากไม่สามารถบันทึกได้แล้ว
    if (interaction.isButton() && interaction.customId === CONFIG_BUTTON_ID) {
        const modal = new ModalBuilder()
            .setCustomId(CONFIG_MODAL_ID)
            .setTitle('⚙️ ค่า Configuration ปัจจุบัน (Env Vars)');

        const spreadsheetIdInput = new TextInputBuilder()
            .setCustomId('spreadsheet_id_input')
            .setLabel("Google Sheet ID (แก้ใน Env Var)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(CONFIG.SPREADSHEET_ID);

        const sheetNameInput = new TextInputBuilder()
            .setCustomId('sheet_name_input')
            .setLabel("Sheet Name (แก้ใน Env Var)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(CONFIG.SHEET_NAME);
            
        const channelIds = CONFIG.CHANNEL_IDS.join(', ');

        const channelListInput = new TextInputBuilder()
            .setCustomId('channel_list_input')
            .setLabel("Channel IDs (แก้ไขใน Env Var)")
            .setStyle(TextInputStyle.Paragraph) // ใช้ Paragraph เพื่อแสดงหลาย ID
            .setRequired(false) 
            .setValue(channelIds);

        modal.addComponents(
            new ActionRowBuilder().addComponents(spreadsheetIdInput),
            new ActionRowBuilder().addComponents(sheetNameInput),
            new ActionRowBuilder().addComponents(channelListInput) 
        );

        await interaction.showModal(modal);
        return;
    }

    // --- 3. การส่งข้อมูลจาก Modal (CONFIG_MODAL_ID) ---
    // เปลี่ยนพฤติกรรมเป็นการแสดงข้อความแจ้งเตือนว่าไม่สามารถบันทึกได้
    if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
        await interaction.deferReply({ ephemeral: true }); 
        
        // เราจะไม่ดึงค่าและบันทึก แต่จะแจ้งผู้ใช้ว่าต้องแก้ไข Env Var แทน
        await interaction.editReply({
            content: "⚠️ **ไม่สามารถบันทึกค่าได้!** เนื่องจากบอททำงานในโหมด Environment Variables หากต้องการแก้ไขค่า โปรดทำการแก้ไขและ Deploy ใหม่ในระบบโฮสติ้ง (เช่น Render)",
            ephemeral: true
        });
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
