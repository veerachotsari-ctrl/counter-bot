// ==============================
// CountCase.js (FULL VERSION)
// ==============================

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
// GOOGLE AUTH
// ---------------------------------------------------------

const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY
        ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n')
        : null,
};

const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const gsapi = google.sheets({ version: "v4", auth });

// ---------------------------------------------------------

let CONFIG = {};
const CONFIG_FILE = "config.json";

const COUNT_BUTTON_ID = "start_historical_count";
const CONFIG_BUTTON_ID = "open_config_modal";
const CONFIG_MODAL_ID = "config_form_submit";

const STARTING_ROW = 4;

// C D E F G
const COL_INDEX = {
    C: 2,
    D: 3,
    E: 4,
    F: 5,
    G: 6,
};

const COUNT_COLS = 5;

// ---------------------------------------------------------
// CONFIG
// ---------------------------------------------------------

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE);
        CONFIG = JSON.parse(data);
    } catch {
        CONFIG = {
            SPREADSHEET_ID: '',
            SHEET_NAME: 'Sheet1',
            CHANNEL_IDS: [],
            BATCH_DELAY: 150,
        };
    }

    CONFIG.COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID || '0';
}

function saveConfig() {

    const save = {
        SPREADSHEET_ID: CONFIG.SPREADSHEET_ID,
        SHEET_NAME: CONFIG.SHEET_NAME,
        CHANNEL_IDS: CONFIG.CHANNEL_IDS,
        BATCH_DELAY: CONFIG.BATCH_DELAY,
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(save, null, 4));
}

loadConfig();

// ---------------------------------------------------------
// GOOGLE SHEET
// ---------------------------------------------------------

async function clearCountsOnly() {

    const range =
        `${CONFIG.SHEET_NAME}!C${STARTING_ROW}:G`;

    await gsapi.spreadsheets.values.clear({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range,
    });
}

// ---------------------------------------------------------

async function batchUpdateAllColumns(masterCountMap) {

    if (masterCountMap.size === 0) return;

    const dataRange =
        `${CONFIG.SHEET_NAME}!A${STARTING_ROW}:G`;

    const res = await gsapi.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: dataRange,
    });

    let rows = res.data.values || [];

    const updates = [];

    for (const [key, counts] of masterCountMap) {

        const [display, user] = key.split("|");

        let idx = rows.findIndex(
            r => r[0] === display && r[1] === user
        );

        if (idx >= 0) {

            const sheetRow = STARTING_ROW + idx;

            for (let i = 0; i < COUNT_COLS; i++) {

                if (counts[i] > 0) {

                    const col = COL_INDEX.C + i;
                    const letter = String.fromCharCode(65 + col);

                    const old = parseInt(rows[idx][col] || 0);
                    const val = old + counts[i];

                    updates.push({
                        range: `${CONFIG.SHEET_NAME}!${letter}${sheetRow}`,
                        values: [[val]],
                    });
                }
            }

        } else {

            const row = [display, user];

            while (row.length < 2) row.push('');

            for (let i = 0; i < COUNT_COLS; i++) {
                row.push(counts[i] || 0);
            }

            const newRow = STARTING_ROW + rows.length;

            updates.push({
                range: `${CONFIG.SHEET_NAME}!A${newRow}:G${newRow}`,
                values: [row],
            });

            rows.push(row);
        }
    }

    if (updates.length) {

        await gsapi.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: {
                valueInputOption: "RAW",
                data: updates,
            }
        });
    }

    await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
}

// ---------------------------------------------------------
// CONTROL PANEL MESSAGE
// ---------------------------------------------------------

function getStartCountMessage() {

    const ids = CONFIG.CHANNEL_IDS.slice(0, 4);

    const row = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
            .setCustomId(COUNT_BUTTON_ID)
            .setLabel("⭐ เริ่มนับข้อความเก่า")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId(CONFIG_BUTTON_ID)
            .setLabel("⚙️ ตั้งค่า")
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        content:
            `📊 ระบบนับคดี\n\n` +
            `Sheet: ${CONFIG.SHEET_NAME}\n` +
            `Channels: ${ids.length}/4\n`,
        components: [row],
    };
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------

function initializeCountCase(client, commandChannelId) {

    CONFIG.COMMAND_CHANNEL_ID = commandChannelId;

    client.once(Events.ClientReady, async () => {

        const ch = await client.channels
            .fetch(CONFIG.COMMAND_CHANNEL_ID)
            .catch(() => null);

        if (!ch) return;

        const msg = getStartCountMessage();

        await ch.send(msg);
    });
}

// ---------------------------------------------------------
// EXPORT
// ---------------------------------------------------------

module.exports = {
    initializeCountCase,
    getStartCountMessage
};
