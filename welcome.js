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
    EmbedBuilder,
    MessageFlags 
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
        description: 'ตรวจสอบสถานะและข้อความต้อนรับ/บอกลาปัจจุบัน', // คำอธิบายถูกแก้ให้สั้นลง
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
        const welcomeEmbed = createStatusEmbed(member, processedMessage, client, true);

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
        const goodbyeEmbed = createStatusEmbed(member, processedMessage, client, false);

        // ส่งข้อความพร้อม Embed
        channel.send({ embeds: [goodbyeEmbed] });
    });
}

/**
 * [เพิ่มฟังก์ชัน] สร้าง Embed สำหรับข้อความต้อนรับ/บอกลา
 * @param {import('discord.js').GuildMember} member
 * @param {string} message - ข้อความที่ประมวลผลแล้ว
 * @param {import('discord.js').Client} client
 * @param {boolean} isWelcome - true ถ้าเป็นข้อความต้อนรับ, false ถ้าเป็นบอกลา
 */
function createStatusEmbed(member, message, client, isWelcome = true) {
    const color = isWelcome ? 0x00FF00 : 0xFF0000; // เขียวสำหรับต้อนรับ, แดงสำหรับบอกลา
    const title = isWelcome 
        ? `🎉 ยินดีต้อนรับสู่ ${member.guild.name}!` 
        : `😭 สมาชิกออกจากเซิร์ฟเวอร์`;
    const fieldName1 = isWelcome ? '👤 สมาชิกใหม่' : '👤 ผู้จากไป';
    const fieldName2 = isWelcome ? '👥 สมาชิกรวม' : '👥 สมาชิกที่เหลือ';
    
    // ใช้ member.guild.memberCount ตรงตามโค้ดเดิมและตัวแปร {membercount}
    const memberCountValue = `${member.guild.memberCount} คน`;

    return new EmbedBuilder()
        .setColor(color) 
        .setTitle(title)
        .setDescription(message)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: fieldName1, value: `<@${member.id}>`, inline: true },
            { name: fieldName2, value: memberCountValue, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Fresh Town Police Bot', iconURL: client.user.displayAvatarURL() });
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
            flags: MessageFlags.Ephemeral
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
            
            // ❌ ลบส่วนการสร้างปุ่มออกไปแล้ว
            /*
            const editWelcomeBtn = new ButtonBuilder()
                .setCustomId(CUSTOM_ID.BUTTON_EDIT_WELCOME)
                ...
            const row = new ActionRowBuilder().addComponents(editWelcomeBtn, editGoodbyeBtn);
            */

            await interaction.reply({ 
                content: statusMessage, 
                // ❌ ลบ components: [row] ออกไปแล้ว
                flags: MessageFlags.Ephemeral 
            });
            break;

        case 'set_welcome_channel':
            const channel = options.getChannel('channel');
            config.channelId = channel.id;
            await interaction.reply({
                content: `✅ ตั้งค่าช่องต้อนรับ/บอกลาสำเร็จแล้ว: ${channel}`,
                flags: MessageFlags.Ephemeral
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
            flags: MessageFlags.Ephemeral
        });
    }
    
    // โค้ดส่วนนี้ยังคงอยู่ เพื่อให้การตั้งค่าผ่านปุ่มที่เคยถูกสร้างก่อนหน้ายังทำงานได้
    if (interaction.customId === CUSTOM_ID.BUTTON_EDIT_WELCOME) {
        // สร้าง Modal สำหรับ WELCOME
        const modal = new ModalBuilder()
            .setCustomId(CUSTOM_ID.MODAL_EDIT_WELCOME)
            .setTitle('แก้ไขข้อความต้อนรับ');

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
    // [แก้ไข: ตรวจสอบสิทธิ์ Modal Submit]
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: '❌ คุณไม่มีสิทธิ์ `Manage Server` ในการตั้งค่าข้อความ',
            flags: MessageFlags.Ephemeral 
        });
    }
    
    if (interaction.customId === CUSTOM_ID.MODAL_EDIT_WELCOME) {
        const newWelcomeMessage = interaction.fields.getTextInputValue(CUSTOM_ID.INPUT_WELCOME_MESSAGE);
        config.welcomeMessage = newWelcomeMessage;

        await interaction.reply({
            content: `✅ ข้อความต้อนรับถูกอัปเดตสำเร็จแล้ว! ดูตัวอย่าง:\n\`\`\`${newWelcomeMessage}\`\`\``,
            flags: MessageFlags.Ephemeral
        });

    } else if (interaction.customId === CUSTOM_ID.MODAL_EDIT_GOODBYE) {
        const newGoodbyeMessage = interaction.fields.getTextInputValue(CUSTOM_ID.INPUT_GOODBYE_MESSAGE);
        config.goodbyeMessage = newGoodbyeMessage;

        await interaction.reply({
            content: `✅ ข้อความบอกลาถูกอัปเดตสำเร็จแล้ว! ดูตัวอย่าง:\n\`\`\`${newGoodbyeMessage}\`\`\``,
            flags: MessageFlags.Ephemeral
        });
    }
}

module.exports = {
    initializeWelcomeModule
};
