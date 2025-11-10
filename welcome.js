// welcome.js - เวอร์ชันเสถียรและกระชับ (ตัดฟีเจอร์แก้ไขข้อความผ่านปุ่ม/Modal)

const { 
    PermissionFlagsBits, 
    ChannelType,
    EmbedBuilder,
    MessageFlags 
} = require('discord.js'); // 🗑️ ลบ ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder

// ----------------------------------------------------
// I. CONFIGURATION & STATE
// ----------------------------------------------------

let config = {
    channelId: "1425367667245711411",
    welcomeMessage: "ยินดีต้อนรับ {mention} สู่เซิร์ฟเวอร์ **{server}** แนะนำตัว ได้เลยนะครับ 🎉",
    goodbyeMessage: "สมาชิก **{mention}** ได้ออกจากเซิร์ฟเวอร์ไปแล้วครับ 😢 ตอนนี้เหลือ {membercount} คน", 
};

// 🗑️ ลบ CUSTOM_ID ที่เกี่ยวข้องกับการแก้ไขออกทั้งหมด (ไม่จำเป็นอีกต่อไป)
/*
const CUSTOM_ID = {
    BUTTON_EDIT_WELCOME: 'edit_welcome_message_btn',
    ...
};
*/

const COMMANDS = [
    {
        name: 'welcome_status',
        description: 'ตรวจสอบสถานะและข้อความต้อนรับ/บอกลาปัจจุบัน', 
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

function initializeWelcomeModule(client) {
    
    // 1. ลงทะเบียน Slash Commands
    client.once('clientReady', async () => { 
        try {
            await client.application.commands.set(COMMANDS);
            console.log('📝 Welcome Module: Successfully registered slash commands.');
        } catch (error) {
            console.error('Welcome Module: Failed to register commands:', error);
        }
    });

    // 2. จัดการ Interactions (เหลือแค่ Command)
    client.on('interactionCreate', (interaction) => {
        if (interaction.isCommand()) {
            handleSlashCommand(interaction);
        } 
        // 🗑️ ลบ handleButton และ handleModalSubmit listeners ออก
    });

    // 3. จัดการ Event สมาชิกเข้าร่วม (Welcome)
    client.on('guildMemberAdd', (member) => {
        if (!config.channelId) return;
        const channel = member.guild.channels.cache.get(config.channelId);
        if (!channel) return;

        const processedMessage = config.welcomeMessage
            .replace('{user}', member.user.tag)       
            .replace('{nickname}', member.displayName) 
            .replace('{username}', member.user.username) 
            .replace('{mention}', `<@${member.id}>`)    
            .replace('{server}', member.guild.name)      
            .replace('{membercount}', member.guild.memberCount); 

        const welcomeEmbed = createStatusEmbed(member, processedMessage, client, true);
        channel.send({ content: `<@${member.id}>`, embeds: [welcomeEmbed] });
    });

    // 4. จัดการ Event สมาชิกออกจากเซิร์ฟเวอร์ (Goodbye)
    client.on('guildMemberRemove', (member) => {
        if (!config.channelId) return;
        const channel = member.guild.channels.cache.get(config.channelId);
        if (!channel) return;

        const processedMessage = config.goodbyeMessage
            .replace('{user}', member.user.tag)       
            .replace('{nickname}', member.displayName) 
            .replace('{username}', member.user.username) 
            .replace('{mention}', `<@${member.id}>`)    
            // *Note: member.guild.memberCount ตรงนี้จะเป็นจำนวนสมาชิกปัจจุบันหลังสมาชิกคนนี้ออกไปแล้ว
            .replace('{server}', member.guild.name)      
            .replace('{membercount}', member.guild.memberCount); 

        const goodbyeEmbed = createStatusEmbed(member, processedMessage, client, false);
        channel.send({ embeds: [goodbyeEmbed] });
    });
}

function createStatusEmbed(member, message, client, isWelcome = true) {
    const color = isWelcome ? 0x00FF00 : 0xFF0000;
    const title = isWelcome 
        ? `🎉 ยินดีต้อนรับสู่ ${member.guild.name}!` 
        : `😭 สมาชิกออกจากเซิร์ฟเวอร์`;
    const fieldName1 = isWelcome ? '👤 สมาชิกใหม่' : '👤 ผู้จากไป';
    const fieldName2 = isWelcome ? '👥 สมาชิกรวม' : '👥 สมาชิกที่เหลือ';
    
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
            `;
            
            await interaction.reply({ 
                content: statusMessage, 
                flags: MessageFlags.Ephemeral 
            });
            break;

        case 'set_welcome_channel':
            const channel = options.getChannel('channel');
            config.channelId = channel.id;
            // *Note: ในการใช้งานจริง ควรบันทึก config.channelId ลงใน Database ที่นี่
            await interaction.reply({
                content: `✅ ตั้งค่าช่องต้อนรับ/บอกลาสำเร็จแล้ว: ${channel}`,
                flags: MessageFlags.Ephemeral
            });
            break;
    }
}

// 🗑️ ลบฟังก์ชัน handleButton ออก
// 🗑️ ลบฟังก์ชัน handleModalSubmit ออก

module.exports = {
    initializeWelcomeModule
};
