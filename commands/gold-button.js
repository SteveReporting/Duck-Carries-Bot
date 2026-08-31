const {
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const { goldDonationButtonRow } = require("../treasury/goldDonations");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("gold-button")
        .setDescription("Post the gold donation button in this channel")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        return interaction.reply({
            components: [goldDonationButtonRow()],
        });
    },
};