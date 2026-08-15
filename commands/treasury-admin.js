const {
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const {
    clearTreasuryScam,
    getTreasuryProfile,
    setTreasuryTrust,
} = require("../treasury/treasury");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("treasury-admin")
        .setDescription("Manage Treasury trust and scam blocks")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName("view")
                .setDescription("View a member's Treasury profile")
                .addUserOption((option) =>
                    option
                        .setName("user")
                        .setDescription("Member to inspect")
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("trust")
                .setDescription("Set a member's Treasury Trust Score")
                .addUserOption((option) =>
                    option
                        .setName("user")
                        .setDescription("Member to edit")
                        .setRequired(true)
                )
                .addIntegerOption((option) =>
                    option
                        .setName("score")
                        .setDescription("Trust Score from 0 to 100")
                        .setMinValue(0)
                        .setMaxValue(100)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("clear-scam")
                .setDescription("Clear a member's Treasury scam block after staff review")
                .addUserOption((option) =>
                    option
                        .setName("user")
                        .setDescription("Member to unblock")
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const user = interaction.options.getUser("user");

        if (sub === "view") {
            const profile = getTreasuryProfile(interaction.guildId, user.id);
            return interaction.reply({
                content: [
                    `🏦 **Treasury Profile — ${user.tag}**`,
                    `Trust: **${profile.trust}/100**`,
                    `Borrowing blocked: **${profile.banned ? "Yes" : "No"}**`,
                    `Accepted donations: **${profile.donations}**`,
                    `Late returns: **${profile.lateReturns}**`,
                    `Scam flags: **${profile.scams}**`,
                ].join("\n"),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === "trust") {
            const score = interaction.options.getInteger("score");
            const profile = setTreasuryTrust(interaction.guildId, user.id, score);
            return interaction.reply({
                content: `✅ ${user}'s Treasury Trust Score is now **${profile.trust}/100**.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === "clear-scam") {
            const profile = clearTreasuryScam(interaction.guildId, user.id);
            return interaction.reply({
                content: `✅ ${user}'s Treasury borrowing block has been cleared. Trust remains **${profile.trust}/100**.`,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};