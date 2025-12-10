// =========================================================
// LogTime.js (เวอร์ชันเต็มล่าสุด)
// เงื่อนไข:
//  - อ่านชื่อจาก Embed Title
//  - ค้นหาชื่อในคอลัมน์ B และ C
//  - ถ้าเจอชื่อใน B → เพิ่มข้อมูลในคอลัมน์ C ด้วย
//  - ถ้าไม่เจอทั้ง B และ C → เพิ่มชื่อในคอลัมน์ C เท่านั้น (ไม่แตะ B)
// =========================================================

module.exports = (client, sheets) => {
    const channelId = "1445640443986710548";
    const spreadsheetId = "1GIgLq2Pr0Omne6QH64a_K2Iw2Po8FVjRqnltlw-a5zM"; // <== ใส่ของจริง

    client.on("messageCreate", async (message) => {
        if (message.channel.id !== channelId) return;
        if (!message.embeds.length) return;

        try {
            // ======== 1) ดึงข้อมูลจาก Embed ========
            const embed = message.embeds[0];
            const name = embed.title?.trim();  // ชื่อ
            const description = embed.description || "";

            if (!name) return;

            // ======== 2) ดึงข้อมูล column B และ C จากชีต ========
            const sheetName = "LogTime"; // <== ชื่อชีตแก้ได้
            const rangeB = `${sheetName}!B:B`;
            const rangeC = `${sheetName}!C:C`;

            const readB = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: rangeB,
            });
            const readC = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: rangeC,
            });

            const colB = readB.data.values ? readB.data.values.flat() : [];
            const colC = readC.data.values ? readC.data.values.flat() : [];

            // ======== 3) ค้นหาชื่อใน B และ C ========
            const indexB = colB.findIndex(v => v === name);
            const indexC = colC.findIndex(v => v === name);

            let writeRow = null;

            if (indexB !== -1) {
                // ---------- พบใน B ----------
                // → ต้องเขียนข้อมูลลง C ด้วย
                writeRow = indexB + 1;  // แถวเดียวกับ B
                console.log(`พบชื่อในคอลัมน์ B ที่แถว ${writeRow}`);
            } 
            else if (indexC !== -1) {
                // ---------- พบใน C ----------
                writeRow = indexC + 1;
                console.log(`พบชื่อในคอลัมน์ C ที่แถว ${writeRow}`);
            } 
            else {
                // ---------- ไม่พบทั้ง B และ C ----------
                // → ให้เพิ่มใน C อย่างเดียว (ไม่แตะ B)
                writeRow = colC.length + 1;
                console.log(`ไม่พบชื่อ เพิ่มใหม่ที่ C แถว ${writeRow}`);

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `${sheetName}!C${writeRow}`,
                    valueInputOption: "USER_ENTERED",
                    resource: { values: [[name]] }
                });
            }

            // ======== 4) เพิ่มข้อมูล Description ลงช่อง D (หรือช่องอื่นตามต้องการ) ========
            const logTime = description;

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!D${writeRow}`,
                valueInputOption: "USER_ENTERED",
                resource: { values: [[logTime]] }
            });

            console.log("บันทึกข้อมูลสำเร็จ");

        } catch (err) {
            console.error("ERROR LogTime:", err);
        }
    });
};
