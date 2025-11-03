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
    EmbedBuilder, // สำหรับข้อความ Welcome/Farewell แบบสวยงาม
} = require("discord.js");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const http = require("http");
// ไม่ต้อง require("dotenv").config() บน Render

// =========================================================
// 🌐 CONFIG, CONSTANTS & INITIALIZATION
// =========================================================

// ดึง Port จาก Environment Variable ของ Render หรือใช้ 3000 เป็นค่าเริ่มต้น
const PORT = process.env.PORT || 3000; 

// 1. โหลด Service Account Credentials
const credentials = {
    // ดึงอีเมลจาก Render Env Var
    client_email: process.env.CLIENT_EMAIL,
    // ดึง Private Key จาก Render Env Var และแปลง \n กลับ
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : null, 
};

// 2. CONFIG: ใช้ Object ธรรมดา และดึงค่าทั้งหมดจาก Env Vars
let CONFIG = {
    // สำหรับบอทนับข้อความ
    COMMAND_CHANNEL_ID: process.env.COMMAND_CHANNEL_ID || '0', 
    SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
    SHEET_NAME: process.env.SHEET_NAME || 'Sheet1',
    CHANNEL_IDS: (process.env.CHANNEL_IDS || '').split(',').map(id => id.trim()).filter(id => id.length > 10 && !isNaN(id)),
    BATCH_DELAY: parseInt(process.env.BATCH_DELAY || '500'),
    
    // สำหรับบอทต้อนรับ/อำลา 
    WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID || '0', 
};

// **ลบฟังก์ชัน saveConfig() ออก หรือทำให้มันไม่มีผลบน Render**
function saveConfig() {
    console.warn("⚠️ [Render Warning]: saveConfig() was called, but saving to file (config.json) is skipped on Render. Configuration is updated in memory only.");
}

// Discord Custom IDs
const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";

const MAX_CHANNELS = 3;
const STARTING_ROW = 4; // แถวเริ่มต้นบันทึกข้อมูล

// Google Sheets setup
if (!credentials.client_email || !credentials.private_key) {
    console.error("❌ Google Sheets credentials missing! Check CLIENT_EMAIL/PRIVATE_KEY Env Vars.");
    // ไม่ควรไปต่อ
}
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
        GatewayIntentBits.GuildMembers, // ** [สำคัญ] ต้องมีเพื่อรับ Event เข้า/ออก **
    ], // <<-- [แก้ไข Syntax Error] ต้องปิด Array Intents ด้วย `]`
});

// =========================================================
// ⚙️ GOOGLE SHEET FUNCTIONS (OPTIMIZED)
// =========================================================

async function clearCountsOnly() {
    const channelCount = CONFIG.CHANNEL_IDS.length;
    // คำนวณขอบเขตคอลัมน์ C ไปจนถึงคอลัมน์สุดท้าย
    const lastColLetter = String.fromCharCode(65 + 2 + channelCount - 1);
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:${lastColLetter}`; 
    try {
        await gsapi.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range,
        });
        console.log(
            `✅ Cleared previous mention counts (Range: ${range}) but kept usernames.`,
        );
    } catch (error) {
        console.error("❌ Error clearing counts. Check Sheet ID and permissions:", error.message);
        throw error;
    }
}

async function batchUpdateMentions(batchMap, channelIndex) {
    const channelCount = CONFIG.CHANNEL_IDS.length;
    const lastColLetter = String.fromCharCode(65 + 1 + channelCount);
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${lastColLetter}`;
    
    // 1. อ่านข้อมูลทั้งหมดมาในครั้งเดียว (Batch Read)
    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });

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
            
            const currentValue = parseInt(rows[rowIndex][colIndex] || "0");
            const newCount = currentValue + count;
            
            updates.push({
                range: currentRange,
                values: [[newCount]],
            });
            
            rows[rowIndex][colIndex] = String(newCount); 
            
        } else {
            // ผู้ใช้ใหม่: สร้างแถวใหม่
            const appendRow = STARTING_ROW + rows.length;
            const newRow = [displayName, username, ...Array(channelCount).fill(0).map(String)]; 
            newRow[colIndex] = count;
            
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${lastColLetter}${appendRow}`,
                values: [newRow],
            });
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
// 💬 DISCORD MESSAGE PROCESSING (นับสถิติ)
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
                    displayName = user.globalName || user.username; // ใช้ globalName หากมี
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
// 🔔 WELCOME / FAREWELL HANDLERS (Embed + Delay)
// =========================================================

// 1. Event: สมาชิกเข้าเซิร์ฟเวอร์ (Welcome) - พร้อม Delay 3 วินาที
client.on('guildMemberAdd', member => {
    if (CONFIG.WELCOME_CHANNEL_ID === '0') return;

    const channel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);

    if (channel && channel.isTextBased()) {
        
        setTimeout(() => {
            
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#00ff99') 
                .setTitle(`🎉 ยินดีต้อนรับสู่ ${member.guild.name}!`)
                .setDescription(`# สวัสดี ${member}! ยินดีที่สอบผ่าน กรอกข้อมูลห้องแนะนำตัวได้เลยครับ`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 })) 
                .setTimestamp()
            
            channel.send({ content: `Hey ${member}!`, embeds: [welcomeEmbed] })
                .catch(err => console.error("Error sending welcome message:", err));
                
        }, 3000); // หน่วง 3 วินาที
    }
});


// 2. Event: สมาชิกออกจากเซิร์ฟเวอร์ (Farewell)
client.on('guildMemberRemove', member => {
    if (CONFIG.WELCOME_CHANNEL_ID === '0') return;

    const channel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
    
    if (channel && channel.isTextBased()) {
        const farewellEmbed = new EmbedBuilder()
            .setColor('#ff0000') 
            .setTitle(`😭 ${member.user.tag} ได้ออกจากเซิร์ฟเวอร์ไปแล้ว`)
            .setDescription(`# เสียใจด้วยคุณไม่ได้ไปต่อ ${member.displayName || member.user.username} ไว้เจอกันคร๊าฟ!`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 })) 
            .setTimestamp()

        channel.send({ embeds: [farewellEmbed] })
            .catch(err => console.error("Error sending farewell message:", err));
    }
});


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

    const welcomeChannelStatus = CONFIG.WELCOME_CHANNEL_ID !== '0' 
        ? `✅ ช่องต้อนรับ: <#${CONFIG.WELCOME_CHANNEL_ID}>` 
        : `❌ ช่องต้อนรับ: **ยังไม่ได้ตั้งค่า (โปรดตั้งค่าใน Env Vars)**`;

    const channelList = validChannelIds.map(id => `- <#${id}>`).join('\n') || '- ยังไม่มีช่องสำหรับการนับ -';
    
    return {
        content: `⚠️ สถานะปัจจุบัน:\n> Sheet ID: **${CONFIG.SPREADSHEET_ID}**\n> Sheet Name: **${CONFIG.SHEET_NAME}**\n> ${welcomeChannelStatus}\n> Channel ที่นับ (${validChannelIds.length}/${MAX_CHANNELS} แห่ง):\n${channelList}\n\nกดปุ่มด้านล่างเพื่อเริ่มนับข้อความเก่า หรือตั้งค่าใหม่:`,
        components: [row],
    };
}

client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);

    // (ส่วนนี้ใช้ได้สำหรับบอทนับข้อความ)
    try {
        const commandChannel = await client.channels.fetch(
            CONFIG.COMMAND_CHANNEL_ID,
        );
        if (commandChannel && commandChannel.isTextBased()) {
            // ลบข้อความเก่าๆ ที่อาจจะถูกส่งมาก่อนหน้านี้
            const messages = await commandChannel.messages.fetch({ limit: 10 });
            for (const message of messages.values()) {
                if (message.author.id === client.user.id && message.components.length > 0) {
                    await message.delete().catch(() => {});
                    break; 
                }
            }
            await commandChannel.send(getStartCountMessage());
            console.log(
                `✅ Sent control buttons to channel ${CONFIG.COMMAND_CHANNEL_ID}`,
            );
        }
    } catch (error) {
        console.error("❌ Error sending control buttons (Check COMMAND_CHANNEL_ID Env Var):", error);
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
                content: `❌ เกิดข้อผิดพลาดระหว่างการนับสถิติ: ${error.message}. โปรดตรวจสอบ Log ของบอท`,
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

        const allChannelIds = CONFIG.CHANNEL_IDS.join(', ') || ''; 

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
            
        const channelInputCombined = new TextInputBuilder()
            .setCustomId('channel_ids_combined_input') 
            .setLabel("Channel IDs (ป้อนหลาย ID คั่นด้วยคอมมา , )")
            .setStyle(TextInputStyle.Paragraph) 
            .setRequired(true)
            .setValue(allChannelIds); 

        modal.addComponents(
            new ActionRowBuilder().addComponents(spreadsheetIdInput),
            new ActionRowBuilder().addComponents(sheetNameInput),
            new ActionRowBuilder().addComponents(channelInputCombined), 
        );

        await interaction.showModal(modal);
        return;
    }

    // --- 3. การส่งข้อมูลจาก Modal (CONFIG_MODAL_ID) ---
    if (interaction.isModalSubmit() && interaction.customId === CONFIG_MODAL_ID) {
        await interaction.deferReply(); 
        
        try {
            const newSpreadsheetId = interaction.fields.getTextInputValue('spreadsheet_id_input').trim();
            const newSheetName = interaction.fields.getTextInputValue('sheet_name_input').trim();
            
            const combinedChannelIdsInput = interaction.fields.getTextInputValue('channel_ids_combined_input').trim();

            let newChannelIds = combinedChannelIdsInput.split(',') 
                .map(id => id.trim()) 
                .filter(id => id.length > 10 && !isNaN(id)) 
                .slice(0, MAX_CHANNELS); 

            if (newChannelIds.length === 0) {
                 return await interaction.editReply({ 
                    content: "❌ **ตั้งค่าล้มเหลว:** ไม่พบ Channel ID ที่ถูกต้อง (ต้องมีอย่างน้อย 1 ช่อง) โปรดลองอีกครั้ง",
                    ephemeral: true 
                   });
            }

            // อัปเดต CONFIG ในหน่วยความจำ (ค่านี้จะหายไปเมื่อบอทรีสตาร์ท)
            CONFIG.SPREADSHEET_ID = newSpreadsheetId;
            CONFIG.SHEET_NAME = newSheetName;
            CONFIG.CHANNEL_IDS = newChannelIds;
            
            saveConfig(); // บรรทัดนี้จะแค่แสดง Warning บน Render

            const commandChannel = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
            if (commandChannel && interaction.message) {
                const message = await commandChannel.messages.fetch(interaction.message.id);
                await message.edit(getStartCountMessage());
            }

            const replyMsg = await interaction.editReply({
                content: `✅ **ตั้งค่า Bot ใหม่เรียบร้อยแล้ว! (เฉพาะในหน่วยความจำ)** ข้อความนี้จะถูกลบใน 5 วินาที\n> Sheet ID: ${newSpreadsheetId}\n> Sheet Name: ${newSheetName}\n> Channel IDs ที่บันทึก: ${newChannelIds.join(', ')}`,
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

// Web server สำหรับ Render Keep-Alive
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("✅ Discord Bot is alive and running!");
}).listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}.`));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
