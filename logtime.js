// DutyLogger.js
const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
const rows = response.data.values || [];
const target = normalizeName(name);


const index = rows.findIndex(row => row[0] && normalizeName(row[0]) === target);
return index === -1 ? null : index + 3;
}


async function saveLog(name, date, time) {
const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM";
const sheetName = "logtime";
const auth = getSheetsClient();
if (!auth) return;


await auth.authorize();
const sheets = google.sheets({ version: "v4", auth });
const row = await findRowByName(sheets, spreadsheetId, sheetName, name);


if (row) {
await sheets.spreadsheets.values.update({
spreadsheetId,
range: `${sheetName}!D${row}:E${row}`,
valueInputOption: "USER_ENTERED",
resource: { values: [[date, time]] },
});
console.log(`🔄 Updated row ${row} →`, name, date, time);
} else {
await sheets.spreadsheets.values.append({
spreadsheetId,
range: `${sheetName}!C3`,
valueInputOption: "USER_ENTERED",
resource: { values: [[name, date, time]] },
});
console.log("➕ Added new row →", name, date, time);
}
}


function extractMinimal(text) {
text = text.replace(/`/g, "").replace(/\u200B/g, "").replace(/[ \t]+/g, " ").trim();


const n = text.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i);
const rawName = n ? n[1].trim() : null;
const name = rawName ? rawName.normalize("NFKC").replace(/\s+/g, " ").trim() : null;


const out = text.match(/เวลาออกงาน[\s\S]*?(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)\s*-\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
const date = out ? out[1] : null;
const time = out ? out[2] : null;


return { name, date, time };
}


function initializeLogListener(client) {
const LOG_CHANNEL = "1445640443986710548";


client.on("messageCreate", async message => {
if (message.channel.id !== LOG_CHANNEL) return;
let text = message.content ? message.content + "\n" : "";


if (message.embeds?.length > 0) {
for (const embed of message.embeds) {
const e = embed.data ?? embed;
if (e.title) text += e.title + "\n";
if (e.description) text += e.description + "\n";
if (e.fields) e.fields.forEach(f => text += `${f.name}\n${f.value}\n`);
}
}


const { name, date, time } = extractMinimal(text);


if (!name) return console.log("❌ NAME NOT FOUND");
if (!date || !time) return console.log("❌ DATE/TIME NOT FOUND");


await saveLog(name, date, time);
console.log("✔ DONE:", name, date, time);
});
}


module.exports = { initializeLogListener };
