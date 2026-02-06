// CountCase.js (ฉบับแก้ไขเพิ่มคำสั่ง /นับเคส)

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
// 1. GOOGLE AUTH SETUP & CONFIG
// ---------------------------------------------------------
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

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
        } else {
            CONFIG = { SPREADSHEET_ID: "", SHEET_NAME: "test", CHANNEL_IDS: [], BATCH_DELAY: 150 };
        }
    } catch (e) {
        CONFIG = { SPREADSHEET_ID: "", SHEET_NAME: "test", CHANNEL_IDS: [], BATCH_DELAY: 150 };
    }
}

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 4));
}

function getStartCountMessage() {
    const channelMentions = CONFIG.CHANNEL_IDS && CONFIG.CHANNEL_IDS.length > 0
        ? CONFIG.CHANNEL_IDS.map(id => `<#${id}>`).join(", ")
        : "ยังไม่ได้ตั้งค่าช่อง";

    const embed = {
        title: "📊 ระบบนับสถิติเคสย้อนหลัง",
        description: `บอทจะนับเคสจากช่อง: ${channelMentions}\n\n**Spreadsheet ID:** \`${CONFIG.SPREADSHEET_ID || "ว่าง"}\`\n**Sheet Name:** \`${CONFIG.SHEET_NAME}\``,
        color: 0x3498db,
        timestamp: new Date(),
    };

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(COUNT_BUTTON_ID)
            .setLabel("เริ่มนับสถิติ")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(CONFIG_BUTTON_ID)
            .setLabel("ตั้งค่า")
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

// --- ฟังก์ชันใหม่สำหรับคำสั่ง /นับเคส ---
async function sendStartButton(interaction) {
    const startMessage = getStartCountMessage();
    await interaction.reply(startMessage);
}

function initializeCountCase(client, commandChannelId) {
    loadConfig();
    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;

    client.once(Events.ClientReady, async () => {
        const channel = await client.channels.fetch(commandChannelId).catch(() => null);
        if (!channel) return;

        const messages = await channel.messages.fetch({ limit: 10 });
        const existingMsg = messages.find(m => m.components[0]?.components.some(c => c.customId === COUNT_BUTTON_ID));

        if (!existingMsg) {
            await channel.send(getStartCountMessage());
        } else {
            await existingMsg.edit(getStartCountMessage());
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isButton()) {
            if (interaction.customId === CONFIG_BUTTON_ID) {
                const modal = new ModalBuilder()
                    .setCustomId('config_modal')
                    .setTitle('ตั้งค่าระบบนับเคส');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spreadsheet_id_input').setLabel("Spreadsheet ID").setStyle(TextInputStyle.Short).setValue(CONFIG.SPREADSHEET_ID || "")),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sheet_name_input').setLabel("ชื่อ Sheet").setStyle(TextInputStyle.Short).setValue(CONFIG.SHEET_NAME || "test")),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_list_input').setLabel("Channel IDs (คั่นด้วยลูกน้ำ)").setStyle(TextInputStyle.Paragraph).setValue(CONFIG.CHANNEL_IDS.join(", "))),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('batch_delay_input').setLabel("Delay (ms)").setStyle(TextInputStyle.Short).setValue(String(CONFIG.BATCH_DELAY || 150)))
                );

                await interaction.showModal(modal);
            }
        }

        if (interaction.isModalSubmit() && interaction.customId === 'config_modal') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                CONFIG.SPREADSHEET_ID = interaction.fields.getTextInputValue('spreadsheet_id_input');
                CONFIG.SHEET_NAME = interaction.fields.getTextInputValue('sheet_name_input');
                const rawIds = interaction.fields.getTextInputValue('channel_list_input');
                CONFIG.CHANNEL_IDS = rawIds ? rawIds.split(',').map(id => id.trim()).filter(id => id.length > 10).slice(0, 5) : [];
                CONFIG.BATCH_DELAY = parseInt(interaction.fields.getTextInputValue('batch_delay_input')) || 150;

                saveConfig();
                await interaction.editReply({ content: `✅ **บันทึกเรียบร้อย!**` });
            } catch (error) {
                await interaction.editReply({ content: `❌ **เกิดข้อผิดพลาด!**` });
            }
        }
    });
}

// แก้ไขการ Export ให้รองรับ sendStartButton
module.exports = { initializeCountCase, sendStartButton };
