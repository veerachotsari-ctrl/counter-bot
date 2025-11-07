// welcome.js

const { 
    PermissionFlagsBits, 
    ChannelType,
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder // นำเข้าสำหรับข้อความสวยงาม
} = require('discord.js');

// ----------------------------------------------------
// I. CONFIGURATION & STATE
// ----------------------------------------------------

// **NOTE: ในการใช้งานจริง ควรเก็บข้อมูลนี้ใน Database**
let config = {
    channelId: null,
    // ข้อความเริ่มต้นสำหรับต้อนรับ (ใช้ {mention} ในการต้อนรับ)
    welcomeMessage: "ยินดีต้อนรับ {mention} สู่เซิร์ฟเวอร์ **{server}** แนะนำตัว ได้เลยนะครับ 🎉",
    // ข้อความเริ่มต้นสำหรับบอกลา (ใช้ {mention} ตามที่ลูกค้าร้องขอ)
    goodbyeMessage: "สมาชิก **{mention}** ได้ออกจากเซิร์ฟเวอร์ไปแล้วครับ 😢 ตอนนี้เหลือ {membercount} คน", 
};

const CUSTOM_ID = {
    BUTTON_EDIT_WELCOME: 'edit_welcome_message_btn',
    BUTTON_EDIT_GOODBYE: 'edit_goodbye_message_btn',
    MODAL_EDIT_WELCOME: 'edit_welcome_message_modal',
    MODAL_EDIT_GOODBYE: 'edit_goodbye_message_modal',
    INPUT_WELCOME_MESSAGE: 'welcome_message_input',
    INPUT_GOODBYE_MESSAGE: 'goodbye_message_input',
};

const COMMANDS = [
    {
        name: 'welcome_status',
        description: 'ตรวจสอบสถานะและข้อความต้อนรับ/บอกลาปัจจุบัน พร้อมปุ่มตั้งค่า',
    },
    {
        name: 'set_welcome_channel',
        description: 'ตั้งค่าช่องสำหรับข้อความต้อนรับและบอกลา',
        options: [{
            name: 'channel',
            type: 7, // ChannelType.GuildText
            description: 'เลือกช่อง (Text Channel) สำหรับข้อความต้อนรับ',
            required: true,
            channelTypes: [ChannelType.GuildText]
        }],
        defaultMemberPermissions: [PermissionFlagsBits.ManageGuild],
    },
];

// ----------------------------------------------------
// II. MODULE INITIALIZATION (การเริ่มต้นโมดูล)
// ----------------------------------------------------

/**
 * ฟังก์ชันหลักที่รวบรวมและตั้งค่าทุกอย่างสำหรับฟีเจอร์ Welcome/Goodbye
 * @param {import('discord.js').Client} client - อินสแตนซ์ของ Discord Client
 */
function initializeWelcomeModule(client) {
    
    // 1. ลงทะเบียน Slash Commands เมื่อ Bot พร้อมใช้งาน
    client.once('clientReady', async () => { 
        try {
            await client.application.commands.set(COMMANDS);
            console.log('📝 Welcome Module: Successfully registered slash commands.');
        } catch (error) {
            console.error('Welcome Module: Failed to register commands:', error);
        }
    });

    // 2. จัดการ Interactions (Command, Button, Modal)
    client.on('interactionCreate', (interaction) => {
        if (interaction.isCommand()) {
            handleSlashCommand(interaction);
        } else if (interaction.isButton()) {
            handleButton(interaction); 
        } else if (interaction.isModalSubmit()) {
            handleModalSubmit(interaction); 
        }
    });

    // 3. จัดการ Event สมาชิกเข้าร่วม (Welcome)
    client.on('guildMemberAdd', (member) => {
        if (!config.channelId) return;
        const channel = member.guild.channels.cache.get(config.channelId);
        if (!channel) return;

        // ประมวลผลข้อความ
        const processedMessage = config.welcomeMessage
            .replace('{user}', member.user.tag)       
            .replace('{nickname}', member.displayName) 
            .replace('{username}', member.user.username) 
            .replace('{mention}', `<@${member.id}>`)    // @ แท็กผู้ใช้
            .replace('{server}', member.guild.name)     
            .replace('{membercount}', member.guild.memberCount); 

        // สร้าง Embed สวยงามพร้อมรูปโปรไฟล์
        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x00FF00) // สีเขียว
            .setTitle(`🎉 ยินดีต้อนรับสู่ ${member.guild.name}!`)
            .setDescription(processedMessage)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 })) // รูปโปรไฟล์
            .addFields(
                { name: '👤 สมาชิกใหม่', value: `<@${member.id}>`, inline: true },
                { name: '👥 สมาชิกรวม', value: `${member.guild.memberCount} คน`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Fresh Town Police Bot', iconURL: client.user.displayAvatarURL() });

        // ส่งข้อความพร้อม Embed และ Mention สมาชิกใหม่
        channel.send({ content: `<@${member.id}>`, embeds: [welcomeEmbed] });
    });

    // 4. จัดการ Event สมาชิกออกจากเซิร์ฟเวอร์ (Goodbye)
    client.on('guildMemberRemove', (member) => {
        if (!config.channelId) return;
        const channel = member.guild.channels.cache.get(config.channelId);
        if (!channel) return;

        // ประมวลผลข้อความ
        const processedMessage = config.goodbyeMessage
            .replace('{user}', member.user.tag)       
            .replace('{nickname}', member.displayName) 
            .replace('{username}', member.user.username) 
            .replace('{mention}', `<@${member.id}>`)    // @ แท็กผู้ใช้ (แม้จะออกจากเซิร์ฟเวอร์ไปแล้ว)
            .replace('{server}', member.guild.name)     
            .replace('{membercount}', member.guild.memberCount); 

        // สร้าง Embed สวยงามพร้อมรูปโปรไฟล์
        const goodbyeEmbed = new EmbedBuilder()
            .setColor(0xFF0000) // สีแดง
            .setTitle(`😭 สมาชิกออกจากเซิร์ฟเวอร์`)
            .setDescription(processedMessage)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 })) // รูปโปรไฟล์
            .addFields(
                // *** แสดงเป็น {mention} ตามที่ร้องขอ ***
                { name: '👤 ผู้จากไป', value: `<@${member.id}>`, inline: true }, 
                { name: '👥 สมาชิกที่เหลือ', value: `${member.guild.memberCount} คน`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Fresh Town Police Bot', iconURL: client.user.displayAvatarURL() });

        // ส่งข้อความพร้อม Embed
        channel.send({ embeds: [goodbyeEmbed] });
    });
}

// ----------------------------------------------------
// III. INTERACTION HANDLERS (จัดการการโต้ตอบ)
// ----------------------------------------------------

/** จัดการ Slash Command */
async function handleSlashCommand(interaction) {
    const { commandName, options } = interaction;
    
    if (commandName.startsWith('set_') && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: '❌ คุณไม่มีสิทธิ์ `Manage Server` ในการใช้คำสั่งตั้งค่านี้',
            ephemeral: true
        });
    }

    switch (commandName) {
        case 'welcome_status':
            const statusMessage = `
                **📊 สถานะบอทต้อนรับ/บอกลา**
                
                - **Channel ID ปัจจุบัน:** \`${config.channelId || 'ยังไม่ได้ตั้งค่า'}\`
                - **ข้อความต้อนรับ:** ${config.welcomeMessage}
                - **ข้อความบอกลา:** ${config.goodbyeMessage}

                **ℹ️ ตัวแปรที่ใช้ได้:** \`{user}\` (User#1234), \`{mention}\` (@user), \`{server}\` (ชื่อเซิร์ฟเวอร์), \`{membercount}\` (จำนวนสมาชิก), \`{nickname}\` (ชื่อเล่น), \`{username}\` (ชื่อไม่มี#)
            `;
            
            const editWelcomeBtn = new ButtonBuilder()
                .setCustomId(CUSTOM_ID.BUTTON_EDIT_WELCOME)
                .setLabel('✏️ แก้ไขข้อความต้อนรับ')
                .setStyle(ButtonStyle.Primary); 

            const editGoodbyeBtn = new ButtonBuilder()
                .setCustomId(CUSTOM_ID.BUTTON_EDIT_GOODBYE)
                .setLabel('✂️ แก้ไขข้อความบอกลา')
                .setStyle(ButtonStyle.Danger); 

            const row = new ActionRowBuilder().addComponents(editWelcomeBtn, editGoodbyeBtn);

            await interaction.reply({ 
                content: statusMessage, 
                components: [row], 
                ephemeral: true 
            });
            break;

        case 'set_welcome_channel':
            const channel = options.getChannel('channel');
            config.channelId = channel.id;
            await interaction.reply({
                content: `✅ ตั้งค่าช่องต้อนรับ/บอกลาสำเร็จแล้ว: ${channel}`,
                ephemeral: true
            });
            break;
    }
}

/** จัดการ Button Click */
async function handleButton(interaction) {
    // 1. ตรวจสอบสิทธิ์
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: '❌ คุณไม่มีสิทธิ์ `Manage Server` ในการแก้ไขข้อความ',
            ephemeral: true
        });
    }
    
    if (interaction.customId === CUSTOM_ID.BUTTON_EDIT_WELCOME) {
        // สร้าง Modal สำหรับ WELCOME
        const modal = new ModalBuilder()
            .setCustomId(CUSTOM_ID.MODAL_EDIT_WELCOME)
            .setTitle('แก้ไขข้อความต้อนรับ');

        // แก้ไข: ใช้ Label ที่สั้นลงเพื่อแก้ปัญหา Error
        const welcomeInput = new TextInputBuilder()
            .setCustomId(CUSTOM_ID.INPUT_WELCOME_MESSAGE)
            .setLabel("ข้อความต้อนรับใหม่") 
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('ตัวแปรที่ใช้ได้: {user}, {mention}, {server}, {membercount}, {nickname}') 
            .setValue(config.welcomeMessage) 
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(welcomeInput);
        modal.addComponents(actionRow);
        await interaction.showModal(modal);

    } else if (interaction.customId === CUSTOM_ID.BUTTON_EDIT_GOODBYE) {
        // สร้าง Modal สำหรับ GOODBYE
        const modal = new ModalBuilder()
            .setCustomId(CUSTOM_ID.MODAL_EDIT_GOODBYE)
            .setTitle('แก้ไขข้อความบอกลา');

        // แก้ไข: ใช้ Label ที่สั้นลงเพื่อแก้ปัญหา Error
        const goodbyeInput = new TextInputBuilder()
            .setCustomId(CUSTOM_ID.INPUT_GOODBYE_MESSAGE)
            .setLabel("ข้อความบอกลาใหม่") 
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('ตัวแปรที่ใช้ได้: {user}, {mention}, {server}, {membercount}, {nickname}')
            .setValue(config.goodbyeMessage) 
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(goodbyeInput);
        modal.addComponents(actionRow);
        await interaction.showModal(modal);
    }
}

/** จัดการ Modal Submission */
async function handleModalSubmit(interaction) {
    if (interaction.customId === CUSTOM_ID.MODAL_EDIT_WELCOME) {
        const newWelcomeMessage = interaction.fields.getTextInputValue(CUSTOM_ID.INPUT_WELCOME_MESSAGE);
        config.welcomeMessage = newWelcomeMessage;

        await interaction.reply({
            content: `✅ ข้อความต้อนรับถูกอัปเดตสำเร็จแล้ว! ดูตัวอย่าง:\n\`\`\`${newWelcomeMessage}\`\`\``,
            ephemeral: true 
        });

    } else if (interaction.customId === CUSTOM_ID.MODAL_EDIT_GOODBYE) {
        const newGoodbyeMessage = interaction.fields.getTextInputValue(CUSTOM_ID.INPUT_GOODBYE_MESSAGE);
        config.goodbyeMessage = newGoodbyeMessage;

        await interaction.reply({
            content: `✅ ข้อความบอกลาถูกอัปเดตสำเร็จแล้ว! ดูตัวอย่าง:\n\`\`\`${newGoodbyeMessage}\`\`\``,
            ephemeral: true 
        });
    }
}

module.exports = {
    initializeWelcomeModule
};
