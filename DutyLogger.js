const { google } = require("googleapis");

async function appendToSheet(row) {
    const auth = new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
        ["https://www.googleapis.com/auth/spreadsheets"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
        spreadsheetId: "YOUR_SHEET_ID",
        range: "เวลางาน!A1",
        valueInputOption: "USER_ENTERED",
        resource: { values: [row] }
    });
}
