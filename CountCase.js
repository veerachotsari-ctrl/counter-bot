// CountCaseOptimized.js

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

// ----------------------
// 1. GOOGLE AUTH
// ----------------------
const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\n/g, '\n') : null,
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

// ----------------------
// 2. CONFIG & INIT
// ----------------------
const CONFIG_FILE = "config.json";
let CONFIG = {};
const STARTING_ROW = 4;
const COMMAND_CHANNEL_ID_DEFAULT = '0';

// Channel mapping: dynamic
// col: Google Sheet column, type: mention/author, channelIndex: index in CONFIG.CHANNEL_IDS
let CHANNEL_MAPPING = [
    { col: 'C', type: 'mention', channelIndex: 0 },
    { col: 'D', type: 'mention', channelIndex: 1 },
    { col: 'E', type: 'author', channelIndex: 1 },
    { col: 'F', type: 'mention', channelIndex: 2 }
];

let userCache = new Map(); // global user cache

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE);
        CONFIG = JSON.parse(data);
        console.log("✅ Loaded configuration from config.json.");
    } catch {
        console.error("❌ Failed to load config.json, using defaults.");
        CONFIG = {
            SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
            SHEET_NAME: process.env.SHEET_NAME || 'Sheet1',
            CHANNEL_IDS: [],
            BATCH_DELAY: 150,
            UPDATE_DELAY: 50,
        };
    }
    CONFIG.COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID || COMMAND_CHANNEL_ID_DEFAULT;
}

function saveConfig() {
    const savable = {
        SPREADSHEET_ID: CONFIG.SPREADSHEET_ID,
        SHEET_NAME: CONFIG.SHEET_NAME,
        CHANNEL_IDS: CONFIG.CHANNEL_IDS,
        BATCH_DELAY: CONFIG.BATCH_DELAY,
        UPDATE_DELAY: CONFIG.UPDATE_DELAY
    };
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(savable, null, 4));
        console.log("✅ Configuration saved to config.json.");
    } catch (e) {
        console.error("❌ Error writing config.json:", e.message);
    }
}

loadConfig();

// ----------------------
// 3. GOOGLE SHEET FUNCTIONS
// ----------------------
async function clearCountsOnly() {
    const lastCol = String.fromCharCode('A'.charCodeAt(0) + CHANNEL_MAPPING.length + 1); // e.g., G
    const range = `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:${lastCol}`;
    try {
        await gsapi.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range
        });
        console.log(`✅ Cleared count columns C-${lastCol} from row ${STARTING_ROW}`);
    } catch (error) {
        console.error("❌ Error clearing counts:", error);
        throw error;
    }
}

async function batchUpdateAllColumns(masterCountMap) {
    if (masterCountMap.size === 0) return;

    const lastCol = String.fromCharCode('A'.charCodeAt(0) + CHANNEL_MAPPING.length + 1);
    const dataRange = `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:${lastCol}`;

    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange
    });

    let rows = (response.data.values || []).filter(r => r.length > 0 && (r[0] || r[1]));
    const updates = [];
    const appendedRowsData = [];

    for (const [key, counts] of masterCountMap.entries()) {
        const [displayName, username] = key.split('|');
        let rowIndex = rows.findIndex(r => r[0] === displayName && r[1] === username);

        if (rowIndex >= 0) {
            const sheetRow = STARTING_ROW + rowIndex;
            let newRow = [...rows[rowIndex]];

            CHANNEL_MAPPING.forEach((map, i) => {
                if (counts[i] > 0) {
                    const colIndex = map.col.charCodeAt(0) - 'A'.charCodeAt(0);
                    const current = parseInt(newRow[colIndex] || '0');
                    newRow[colIndex] = String(current + counts[i]);
                }
            });

            // Add to batch update
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${sheetRow}:${lastCol}${sheetRow}`,
                values: [newRow]
            });
            rows[rowIndex] = newRow;

        } else {
            const appendRow = STARTING_ROW + rows.length + appendedRowsData.length;
            const newRow = [displayName, username];
            while (newRow.length < 2) newRow.push('');
            CHANNEL_MAPPING.forEach((map, i) => {
                newRow[map.col.charCodeAt(0) - 'A'.charCodeAt(0)] = String(counts[i] || 0);
            });
            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${appendRow}:${lastCol}${appendRow}`,
                values: [newRow]
            });
            appendedRowsData.push(newRow);
        }
    }

    if (updates.length > 0) {
        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: updates }
        });
    }
    await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
}

// ----------------------
// 4. DISCORD PROCESSING
// ----------------------
async function getUserInfo(client, guild, id) {
    if (userCache.has(id)) return userCache.get(id);
    
    let displayName, username;
    try {
        const member = guild ? await guild.members.fetch(id).catch(()=>null) : null;
        if (member) { displayName = member.displayName; username = member.user.username; }
        else { const user = await client.users.fetch(id); displayName = user.username; username = user.username; }
    } catch {
        displayName = `UnknownUser_${id}`; username = `unknown_${id}`;
    }
    const info = { displayName, username };
    userCache.set(id, info);
    return info;
}

async function processMessagesBatch(client, messages, channelIndex, interaction = null, progressOffset = 0) {
    const masterCountMap = new Map();
    const guild = messages[0]?.guild;

    const total = messages.length;
    let processed = 0;

    for (const message of messages) {
        if (message.author.bot) continue;

        for (let i = 0; i < CHANNEL_MAPPING.length; i++) {
            const map = CHANNEL_MAPPING[i];
            if (map.channelIndex !== channelIndex) continue;

            if (map.type === 'mention' && message.content.includes('<@')) {
                const uniqueMentions = new Set();
                const regex = /<@!?(\d+)>/g; let match;
                while(match = regex.exec(message.content)) uniqueMentions.add(match[1]);

                for (const id of uniqueMentions) {
                    const { displayName, username } = await getUserInfo(client, guild, id);
                    const key = `${displayName}|${username}`;
                    const counts = masterCountMap.get(key) || Array(CHANNEL_MAPPING.length).fill(0);
                    counts[i] +=1;
                    masterCountMap.set(key, counts);
                }
            }
            if (map.type === 'author' && map.channelIndex === channelIndex) {
                const { displayName, username } = await getUserInfo(client, guild, message.author.id);
                const key = `${displayName}|${username}`;
                const counts = masterCountMap.get(key) || Array(CHANNEL_MAPPING.length).fill(0);
                counts[i] +=1;
                masterCountMap.set(key, counts);
            }
        }
        processed++;

        if (interaction && processed % 50 === 0) {
            const percent = Math.floor((processed + progressOffset)/total * 100);
            try { await interaction.editReply({ content: `⏳ Processing messages... ${percent}% done` }); } catch{};
        }
    }

    await batchUpdateAllColumns(masterCountMap);
}

async function processOldMessages(client, channelId, channelIndex, interaction=null, globalProgress={processed:0, total:0}) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.log(`❌ Channel ${channelId} not found.`);
        let lastId = null;
        let processedCount = 0;

        while(true){
            const options = { limit: 100 };
            if(lastId) options.before = lastId;
            const messages = await channel.messages.fetch(options);
            if(messages.size === 0) break;
            
            await processMessagesBatch(client, [...messages.values()], channelIndex, interaction, globalProgress.processed);
            processedCount += messages.size;
            globalProgress.processed += messages.size;
            lastId = messages.last().id;
        }

        console.log(`✅ Finished ${processedCount} messages in channel ${channel.name}`);
    } catch(e){ console.error(`❌ Error processing channel ${channelId}:`, e.message); }
}

// ----------------------
// 5. DISCORD UI
// ----------------------
function getStartCountMessage(){
    const validIds = CONFIG.CHANNEL_IDS.slice(0,3);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_historical_count').setLabel('⭐ เริ่มนับข้อความเก่า').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('open_config_modal').setLabel('⚙️ ตั้งค่า Sheet/Channel').setStyle(ButtonStyle.Secondary)
    );
    return {
        content: `⚠️ Sheet: ${CONFIG.SPREADSHEET_ID || 'ไม่ได้ตั้งค่า'}, Name: ${CONFIG.SHEET_NAME || 'ไม่ได้ตั้งค่า'}, Batch Delay: ${CONFIG.BATCH_DELAY}ms, Channels: ${validIds.length}/3`,
        components: [row]
    };
}

// ----------------------
// 6. MODULE INIT
// ----------------------
function initializeCountCase(client, commandChannelId){
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;

    client.once(Events.ClientReady, async ()=>{
        console.log('[CountCase] Ready.');
        try{
            const ch = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
            if(ch?.isTextBased()){
                const messages = await ch.messages.fetch({limit:5});
                const existing = messages.find(m => m.components.length>0 && m.components[0].components.some(c=>c.customId==='start_historical_count'));
                if(existing) await existing.edit(getStartCountMessage());
                else await ch.send(getStartCountMessage());
            }
        }catch(e){console.error(e);}
    });

    client.on(Events.InteractionCreate, async interaction=>{
        if(interaction.isButton() && interaction.customId==='start_historical_count'){
            await interaction.deferReply({flags:MessageFlags.Ephemeral});
            try{
                if(!CONFIG.SPREADSHEET_ID || !CONFIG.SHEET_NAME || CONFIG.CHANNEL_IDS.length===0){
                    return await interaction.editReply({content:'❌ การตั้งค่าไม่สมบูรณ์', flags:MessageFlags.Ephemeral});
                }
                await interaction.editReply('⏳ ล้างข้อมูลและเริ่มนับ...');
                await clearCountsOnly();

                const globalProgress = {processed:0, total:0};
                CONFIG.CHANNEL_IDS.forEach(id => globalProgress.total += 1000); // placeholder estimate

                for(let i=0;i<CONFIG.CHANNEL_IDS.length;i++){
                    await processOldMessages(client, CONFIG.CHANNEL_IDS[i], i, interaction, globalProgress);
                }

                await interaction.editReply({content:'🎉 นับข้อความเก่าเสร็จสมบูรณ์!', components:[]});
                await new Promise(r=>setTimeout(r,5000));
                await interaction.deleteReply().catch(()=>{});
            }catch(e){
                console.error(e);
                await interaction.editReply({content:'❌ เกิดข้อผิดพลาด', flags:MessageFlags.Ephemeral});
            }
        }

        if(interaction.isButton() && interaction.customId==='open_config_modal'){
            try{
                const modal = new ModalBuilder().setCustomId('config_form_submit').setTitle('🛠️ ตั้งค่า');
                const spreadsheetInput = new TextInputBuilder().setCustomId('spreadsheet_id_input').setLabel('Sheet ID').setStyle(TextInputStyle.Short).setRequired(true).setValue(CONFIG.SPREADSHEET_ID||'');
                const sheetNameInput = new TextInputBuilder().setCustomId('sheet_name_input').setLabel('Sheet Name').setStyle(TextInputStyle.Short).setRequired(true).setValue(CONFIG.SHEET_NAME||'');
                const channelListInput = new TextInputBuilder().setCustomId('channel_list_input').setLabel('Channel IDs (,)').setStyle(TextInputStyle.Paragraph).setValue(CONFIG.CHANNEL_IDS?.join(',')||'');
                const batchDelayInput = new TextInputBuilder().setCustomId('batch_delay_input').setLabel('Batch Delay').setStyle(TextInputStyle.Short).setValue(CONFIG.BATCH_DELAY?.toString()||'150');
                modal.addComponents(new ActionRowBuilder().addComponents(spreadsheetInput), new ActionRowBuilder().addComponents(sheetNameInput), new ActionRowBuilder().addComponents(channelListInput), new ActionRowBuilder().addComponents(batchDelayInput));
                await interaction.showModal(modal);
            }catch(e){console.error(e);}
        }

        if(interaction.isModalSubmit() && interaction.customId==='config_form_submit'){
            await interaction.deferReply({flags:MessageFlags.Ephemeral});
            try{
                CONFIG.SPREADSHEET_ID = interaction.fields.getTextInputValue('spreadsheet_id_input');
                CONFIG.SHEET_NAME = interaction.fields.getTextInputValue('sheet_name_input');
                CONFIG.CHANNEL_IDS = interaction.fields.getTextInputValue('channel_list_input').split(',').map(s=>s.trim()).filter(id=>id.length>10 && !isNaN(id)).slice(0,3);
                CONFIG.BATCH_DELAY = parseInt(interaction.fields.getTextInputValue('batch_delay_input'))||150;
                saveConfig();

                const ch = await client.channels.fetch(CONFIG.COMMAND_CHANNEL_ID);
                if(ch?.isTextBased()){
                    const messages = await ch.messages.fetch({limit:5});
                    const existing = messages.find(m => m.components.length>0 && m.components[0].components.some(c=>c.customId==='start_historical_count'));
                    if(existing) await existing.edit(getStartCountMessage());
                }
                await interaction.editReply({content:'✅ บันทึกการตั้งค่าแล้ว!', flags:MessageFlags.Ephemeral});
                await new Promise(r=>setTimeout(r,5000));
                await interaction.deleteReply().catch(()=>{});
            }catch(e){
                console.error(e);
                await interaction.editReply({content:'❌ เกิดข้อผิดพลาดในการบันทึกค่า', flags:MessageFlags.Ephemeral});
            }
        }
    });
}

module.exports = { initializeCountCase };
