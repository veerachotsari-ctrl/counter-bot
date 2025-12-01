// CountCase.js - rebuilt full version
// NOTE: Replace channel1Id, channel2Id, channel3Id before use

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// =============================
// CONFIG
// =============================
const spreadsheetId = process.env.SHEET_ID;
const channel1Id = process.env.CH1;
const channel2Id = process.env.CH2;
const channel3Id = process.env.CH3;

// =============================
// AUTH
// =============================
const jwtClient = new JWT({
  email: process.env.GOOGLE_SERVICE_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: jwtClient });

// =============================
// MAIN COUNT FUNCTION
// =============================
async function CountCase(client) {
  console.log("[COUNT] Start counting...");

  const counts = {};

  const channels = [channel1Id, channel2Id, channel3Id];

  for (const ch of channels) {
    const channel = await client.channels.fetch(ch).catch(() => null);
    if (!channel) continue;

    let lastId = null;
    let done = false;

    while (!done) {
      const messages = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
      if (!messages || messages.size === 0) break;

      messages.forEach((message) => {
        const userId = message.author.id;
        const displayName = message.member?.displayName || message.author.username;
        const username = message.author.username;

        if (!counts[userId]) {
          counts[userId] = {
            displayName,
            username,
            tagsChannel1: 0,
            tagsChannel2: 0,
            postChannel2: 0,
            tagsChannel3: 0,
          };
        }

        // ========== CHANNEL 1 ==========
        if (message.channelId === channel1Id) {
          counts[userId].tagsChannel1 += message.mentions.users.size;
        }

        // ========== CHANNEL 2 ==========
        if (message.channelId === channel2Id) {
          counts[userId].tagsChannel2 += message.mentions.users.size;
          counts[userId].postChannel2 += 1;
        }

        // ========== CHANNEL 3 ==========
        if (message.channelId === channel3Id) {
          counts[userId].tagsChannel3 += message.mentions.users.size;
        }
      });

      lastId = messages.last().id;
      if (messages.size < 100) done = true;
    }
  }

  console.log("[COUNT] Writing to Google Sheets...");

  const values = [["displayName", "username", "C_CH1", "D_CH2", "E_POST2", "F_CH3"]];

  for (const id in counts) {
    const c = counts[id];

    values.push([
      c.displayName,
      c.username,
      c.tagsChannel1,
      c.tagsChannel2,
      c.postChannel2,
      c.tagsChannel3,
    ]);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log("[COUNT] DONE");
}

module.exports = CountCase;
