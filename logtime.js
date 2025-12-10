// scanner.js
const axios = require("axios");
const { imageHash } = require("image-hash");
const crypto = require("crypto");
const { log, error } = require("./logger");
const memory = require("./memoryManager");

// ========================================================================
// Helper
// ========================================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

// ========================================================================
// Download Image
// ========================================================================
async function downloadImage(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(res.data);
    } catch (err) {
      await sleep(400);
    }
  }
  return null;
}

// ========================================================================
// Get Image Hash (MD5 + Perceptual Hash)
// ========================================================================
async function getImageHash(buffer) {
  return new Promise((resolve) => {
    imageHash({ data: buffer, bits: 16 }, (err, perceptual) => {
      if (err) return resolve(null);
      resolve({
        md5: md5(buffer),
        perceptual,
      });
    });
  });
}

// ========================================================================
// Google Sheets
// ========================================================================
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

function getSheetsClient() {
  const privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, "\n");
  const client = new JWT({
    email: process.env.CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth: client });
}

const SPREADSHEET_ID = process.env.SHEET_ID;

// ========================================================================
// Write Result to Google Sheet
// ========================================================================
async function writeToSheet(name, hash, steamIdFull) {
  try {
    const sheets = getSheetsClient();

    const read = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "DATA!B:H",
    });

    const rows = read.data.values || [];

    let foundC = false;

    // ------------------------------------------------------------
    // 1) ถ้าเจอชื่อใน C → ไม่ทำอะไร
    // ------------------------------------------------------------
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][1] === name) {
        foundC = true;
        break;
      }
    }

    if (foundC) return { status: "exists" };

    // ------------------------------------------------------------
    // 2) หาแถวว่างจาก B (แต่ "ไม่แตะ B")
    //    แล้วเขียนข้อมูลใหม่ลง C / D / E / H
    // ------------------------------------------------------------
    let targetRow = rows.length + 1; // ถัดจากสุดท้าย

    const values = [[
      "",              // B (ห้ามแตะ)
      name,            // C
      new Date().toLocaleDateString("th-TH"), // D
      new Date().toLocaleTimeString("th-TH"), // E
      "",              // F (ไม่ใช้งาน)
      "",              // G (ไม่ใช้งาน)
      steamIdFull      // H – เซฟ steam:xxxxxxxxx
    ]];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `DATA!B${targetRow}:H${targetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    return { status: "saved" };

  } catch (err) {
    error("writeToSheet", err.message);
  }
}

// ========================================================================
// Main Scan Function
// ========================================================================
async function scanImage(url, name, steamIdFull) {
  log(`Scanning image from ${url}`);

  const img = await downloadImage(url);
  if (!img) return { error: "download_failed" };

  const hash = await getImageHash(img);
  if (!hash) return { error: "hash_failed" };

  memory.saveHash(name, hash.md5);

  const result = await writeToSheet(name, hash, steamIdFull);
  return { result };
}

module.exports = {
  scanImage,
};
