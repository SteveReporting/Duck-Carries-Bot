const {
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const {
    saveSettings,
    treasuryPanelComponents,
    treasuryPanelEmbed,
} = require("../treasury/treasury");
const { goldDonationButtonRow } = require("../treasury/goldDonations");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("treasury-setup")
        .setDescription("Setup The Carry Tavern Treasury")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption((option) =>
            option
                .setName("panel")
                .setDescription("Channel where the Treasury panel will be posted")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .addChannelOption((option) =>
            option
                .setName("category")
                .setDescription("Category where Treasury tickets will be created")
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)
        )
        .addRoleOption((option) =>
            option
                .setName("staff-role")
                .setDescription("Role allowed to manage Treasury tickets")
                .setRequired(true)
        )
        .addChannelOption((option) =>
            option
                .setName("logs")
                .setDescription("Private Treasury log channel")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    async execute(interaction) {
        const panel = interaction.options.getChannel("panel");
        const category = interaction.options.getChannel("category");
        const staffRole = interaction.options.getRole("staff-role");
        const logs = interaction.options.getChannel("logs");

        saveSettings(
            interaction.guildId,
            panel.id,
            category.id,
            staffRole.id,
            logs.id
        );

        await panel.send({
            embeds: [treasuryPanelEmbed()],
            components: [
                ...treasuryPanelComponents(),
                goldDonationButtonRow(),
            ],
        });

        return interaction.reply({
            content: `✅ Treasury configured. Panel posted in ${panel}. Tickets will be created under **${category.name}** and managed by ${staffRole}.`,
            flags: MessageFlags.Ephemeral,
        });
    },
};