// CountCase.js - Ultra Optimized Version (Rate-Limit Aware, Low CPU)
// MANN + MEW SPECIAL EDITION 💙

const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// =============================
// ENV CONFIG
// =============================
const spreadsheetId = process.env.SHEET_ID;
const channel1Id = process.env.CH1;
const channel2Id = process.env.CH2;
const channel3Id = process.env.CH3;

// =============================
// GOOGLE AUTH
// =============================
const jwtClient = new JWT({
  email: process.env.GOOGLE_SERVICE_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth: jwtClient });

// =============================
// RATE LIMIT AWARE FETCH
// =============================
async function safeFetch(channel, opts) {
  try {
    return await channel.messages.fetch(opts);
  } catch (e) {
    if (e.status === 429) {
      const wait = (e.retry_after || 1) * 1000;
      console.log(`[RATE LIMIT] wait ${wait}ms`);
      await new Promise((res) => setTimeout(res, wait));
      return safeFetch(channel, opts);
    }
    throw e;
  }
}

// =============================
// MAIN COUNT FUNCTION
// =============================
async function CountCase(client) {
  console.log("[COUNT] Start optimized counting...");

  const counts = {};
  const CHANNELS = [channel1Id, channel2Id, channel3Id];

  for (const cid of CHANNELS) {
    const ch = await client.channels.fetch(cid).catch(() => null);
    if (!ch) continue;

    let lastId = null;
    let done = false;

    while (!done) {
      const msgs = await safeFetch(ch, { limit: 100, before: lastId }).catch(() => null);
      if (!msgs || msgs.size === 0) break;

      for (const msg of msgs.values()) {
        const author = msg.author;
        if (!author) continue;

        const uid = author.id;
        const dname = msg.member?.displayName || author.username;
        const uname = author.username;

        // init cache
        if (!counts[uid]) {
          counts[uid] = {
            displayName: dname,
            username: uname,
            tagsChannel1: 0,
            tagsChannel2: 0,
            postChannel2: 0,
            tagsChannel3: 0,
          };
        }

        const c = counts[uid];
        const mCount = msg.mentions?.users?.size || 0;

        // CHANNEL 1
        if (msg.channelId === channel1Id) c.tagsChannel1 += mCount;

        // CHANNEL 2
        if (msg.channelId === channel2Id) {
          c.tagsChannel2 += mCount;
          c.postChannel2 += 1;
        }

        // CHANNEL 3
        if (msg.channelId === channel3Id) c.tagsChannel3 += mCount;
      }

      lastId = msgs.last().id;
      if (msgs.size < 100) done = true;

      await new Promise((res) => setTimeout(res, 120)); // smooth fetch
    }
  }

  // =============================
  // WRITE TO SHEETS (BATCH ONLY)
  // =============================
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

  console.log("[COUNT] DONE — Ultra Optimized");
}

module.exports = CountCase;
