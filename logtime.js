// scanner.js
const axios = require("axios");
const { imageHash } = require("image-hash");
const crypto = require("crypto");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// --------------------- config/env ---------------------
const SPREADSHEET_ID = process.env.SHEET_ID; // ใส่ ID ใน .env
const LOG_CHANNEL = process.env.LOG_CHANNEL || "1445640443986710548"; // default
// ------------------------------------------------------

// --------------------- helpers -------------------------
function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Download image with small retry (optimized)
async function downloadImage(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 });
      return Buffer.from(res.data);
    } catch (err) {
      await sleep(200);
    }
  }
  return null;
}

// perceptual + md5 hash (non-blocking callback)
async function getImageHash(buffer) {
  return new Promise((resolve) => {
    // bits:16 is kept for compatibility; algorithm left default for stability
    imageHash({ data: buffer, bits: 16 }, (err, perceptual) => {
      if (err) return resolve(null);
      resolve({ md5: md5(buffer), perceptual });
    });
  });
}

// ------------------- Google Auth (cached) ----------------
let cachedAuthClient = null;
function getAuthClient() {
  if (cachedAuthClient) return cachedAuthClient;

  const privateKey = process.env.PRIVATE_KEY
    ? process.env.PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

  if (!process.env.CLIENT_EMAIL || !privateKey) {
    console.error("❌ Missing GOOGLE ENV (CLIENT_EMAIL / PRIVATE_KEY)");
    return null;
  }

  cachedAuthClient = new JWT({
    email: process.env.CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return cachedAuthClient;
}

async function getSheetsService() {
  const auth = getAuthClient();
  if (!auth) return null;
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

// ------------------- Extract from text -------------------
function extractMinimal(text) {
  if (!text) return { name: null, date: null, time: null, steamFullID: null };

  text = text.replace(/`/g, "").replace(/\*/g, "").replace(/\u200B/g, "");

  // NAME (same pattern as before)
  const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
  const name = n ? n[1].trim() : null;

  // DATE/TIME (หลังคำว่า 'เวลาออกงาน')
  const out = text.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
  const date = out ? out[1] : null;
  const time = out ? out[2] : null;

  // STEAM FULL (เก็บทั้งสตริง เช่น "steam:110000107392ebb")
  const steamMatch = text.match(/steam:[0-9a-fA-F]+/i);
  const steamFullID = steamMatch ? steamMatch[0] : null;

  return { name, date, time, steamFullID };
}

// ------------------- Core: find row by B ------------------
// Return row number (1-based). We search B3:B (so returned row >= 3)
// If not found -> return -1
async function findRowByB(sheets, spreadsheetId, sheetName, name) {
  // read B3:B
  const respB = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!B3:B`,
    majorDimension: "COLUMNS",
  });

  const colB = (respB.data.values && respB.data.values[0]) || []; // array of values or empty
  // iterate and find index where cell contains name (case-insensitive)
  const lowered = name ? name.trim().toLowerCase() : "";
  for (let i = 0; i < colB.length; i++) {
    const cell = (colB[i] || "").toString();
    if (!cell) continue;
    if (cell.toLowerCase().includes(lowered)) {
      return i + 3; // because we read from B3 => index 0 -> row 3
    }
  }
  return -1;
}

// ------------------- Save/Update (logtime behavior) ----------------
/*
 Behavior per your choice A:
 - If name exists in B -> find that row
    - If C at that row is empty -> write C, D, E, H
    - If C at that row already has value -> skip (do nothing)
 - If name NOT in B -> SKIP (do nothing)
 - NEVER modify column B
*/
async function saveLog(name, date, time, steamFullID) {
  try {
    const sheetName = "logtime";
    const sheets = await getSheetsService();
    if (!sheets) return { error: "no_sheets" };

    // 1) find row by B
    const row = await findRowByB(sheets, SPREADSHEET_ID, sheetName, name);
    if (row === -1) {
      console.log(`⏭ SKIP — name "${name}" not found in B`);
      return { status: "skipped_no_B" };
    }

    // 2) check C at that row
    const respC = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!C${row}`,
    });
    const existsC = respC.data.values && respC.data.values[0] && respC.data.values[0][0];
    if (existsC && String(existsC).trim() !== "") {
      console.log(`⏭ SKIP — C${row} already has value ("${existsC}")`);
      return { status: "skipped_C_exists", row };
    }

    // 3) prepare timestamp (single Date object, Thai locale)
    const now = new Date();
    const dateTH = date || now.toLocaleDateString("th-TH");
    const timeTH = time || now.toLocaleTimeString("th-TH");

    // 4) write C (name), D (date), E (time), leave F/G blank, H steamFullID
    const values = [[
      name,       // C
      dateTH,     // D
      timeTH,     // E
      "",         // F
      "",         // G
      steamFullID // H
    ]];

    // Because we are writing C..H, compute range C{row}:H{row}
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!C${row}:H${row}`,
      valueInputOption: "USER_ENTERED",
      resource: { values },
    });

    console.log(`✔ Saved into row ${row} (C,D,E,H) ->`, { name, date: dateTH, time: timeTH, steamFullID });
    return { status: "saved", row };
  } catch (err) {
    console.error("saveLog error:", err.message || err);
    return { error: err.message || err };
  }
}

// ------------------- Example image scanning flow (optional) -------------
async function scanImageAndSave(url, fallbackName, fallbackSteam) {
  // Downloads and hashes image (if you use image-based names). Kept for compatibility.
  const img = await downloadImage(url);
  if (!img) return { error: "download_failed" };

  const hash = await getImageHash(img);
  if (!hash) return { error: "hash_failed" };

  // memory manager save could be added here if you have one
  // memory.saveHash && memory.saveHash(fallbackName, hash.md5);

  // fallbackName and fallbackSteam are used to call saveLog
  return await saveLog(fallbackName, null, null, fallbackSteam);
}

// ------------------- Discord listener initializer -----------------------
function initializeLogListener(client) {
  client.on("messageCreate", async (message) => {
    if (message.channel.id !== LOG_CHANNEL) return;

    console.log("\n📥 NEW MESSAGE IN LOG CHANNEL");

    let text = "";
    if (message.content) text += message.content + "\n";

    if (message.embeds?.length > 0) {
      for (const embed of message.embeds) {
        const e = embed.data ?? embed;
        if (e.title) text += e.title + "\n";
        if (e.description) text += e.description + "\n";
        if (e.fields) {
          for (const f of e.fields) {
            if (!f) continue;
            text += `${f.name}\n${f.value}\n`;
          }
        }
      }
    }

    // Extract
    const { name, date, time, steamFullID } = extractMinimal(text);

    if (!name) return console.log("❌ NAME NOT FOUND");
    if (!date || !time) {
      // We allow missing date/time in text: saveLog will use now() if not provided.
      console.log("⚠ DATE/TIME not both found in message — will fallback to current time.");
    }
    if (!steamFullID) return console.log("❌ STEAM ID NOT FOUND");

    console.log("🟩 NAME:", name);
    console.log("🟩 TIME:", date, time);
    console.log("🟩 STEAM:", steamFullID);

    const res = await saveLog(name, date, time, steamFullID);
    console.log("→ result:", res);
  });
}

// ------------------- exports -----------------------
module.exports = {
  initializeLogListener,
  saveLog,
  scanImageAndSave,
};
