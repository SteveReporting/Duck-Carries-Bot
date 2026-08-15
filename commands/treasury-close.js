const {
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const db = require("../database/database");
const { getSettings } = require("../treasury/treasury");

const CLOSED_LOAN_STATUSES = new Set([
    "rejected",
    "returned",
    "returned_after_scam",
]);

const CLOSED_DONATION_STATUSES = new Set([
    "accepted",
    "rejected",
]);

function memberIsTreasuryStaff(interaction, settings) {
    if (!interaction.member || !settings) return false;

    return (
        interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        interaction.member.roles.cache.has(settings.staffRole)
    );
}

async function logClosure(interaction, settings, recordType, record) {
    const logChannel = interaction.guild.channels.cache.get(settings.logChannel);
    if (!logChannel?.isTextBased()) return;

    await logChannel.send({
        content: [
            "🔒 **Treasury Ticket Closed**",
            `**Type:** ${recordType}`,
            `**Record:** #${record.id}`,
            `**Status:** ${record.status}`,
            `**Member:** <@${record.user}>`,
            `**Closed by:** ${interaction.user} (${interaction.user.id})`,
            `**Channel:** #${interaction.channel?.name || interaction.channelId}`,
        ].join("\n"),
    }).catch(() => {});
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("treasury-close")
        .setDescription("Close this Treasury ticket after it has been resolved"),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.channel) {
            return interaction.reply({
                content: "❌ This command can only be used inside a Treasury ticket.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const settings = getSettings(interaction.guildId);

        if (!settings || !memberIsTreasuryStaff(interaction, settings)) {
            return interaction.reply({
                content: "❌ Treasury staff only.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const loan = db.prepare(`
            SELECT * FROM treasury_loans
            WHERE guild = ? AND ticketChannel = ?
            LIMIT 1
        `).get(interaction.guildId, interaction.channelId);

        const donation = db.prepare(`
            SELECT * FROM treasury_donations
            WHERE guild = ? AND ticketChannel = ?
            LIMIT 1
        `).get(interaction.guildId, interaction.channelId);

        if (!loan && !donation) {
            return interaction.reply({
                content: "❌ This channel is not linked to a Treasury ticket.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const record = loan || donation;
        const recordType = loan ? "Loan" : "Donation";
        const resolved = loan
            ? CLOSED_LOAN_STATUSES.has(loan.status)
            : CLOSED_DONATION_STATUSES.has(donation.status);

        if (!resolved) {
            return interaction.reply({
                content: `❌ This ${recordType.toLowerCase()} is still **${record.status}**. Resolve it before closing the ticket.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.reply({
            content: `🔒 ${recordType} #${record.id} is resolved. Closing this ticket in 3 seconds...`,
        });

        await logClosure(interaction, settings, recordType, record);

        if (loan) {
            db.prepare(`
                UPDATE treasury_loans
                SET ticketChannel = NULL
                WHERE id = ? AND guild = ?
            `).run(record.id, interaction.guildId);
        } else {
            db.prepare(`
                UPDATE treasury_donations
                SET ticketChannel = NULL
                WHERE id = ? AND guild = ?
            `).run(record.id, interaction.guildId);
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));

        await interaction.channel.delete(
            `Resolved Treasury ${recordType.toLowerCase()} #${record.id} closed by ${interaction.user.tag}`
        );
    },
};
