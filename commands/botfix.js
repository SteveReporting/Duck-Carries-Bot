const {
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const { runBotRepairAgent } = require("../ai/botRepairAgent");

function splitMessage(text) {
    const value = String(text || "Repair finished.");
    return value.match(/[\s\S]{1,1850}/g) || ["Repair finished."];
}

async function sendAudit(interaction, issue, result) {
    const channelId = process.env.AI_AUDIT_CHANNEL_ID;
    if (!channelId || !interaction.guild) return;

    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return;

    const content = [
        "🛠️ **Bot Repair Command**",
        `**Administrator:** ${interaction.user.tag} (${interaction.user.id})`,
        `**Issue:** ${String(issue).slice(0, 700)}`,
        `**Result:** ${String(result.text || "No report").slice(0, 800)}`,
        result.restartRequested ? `**Restart:** Requested — ${String(result.restartReason || "no reason supplied").slice(0, 250)}` : "**Restart:** Not requested",
    ].join("\n");

    await channel.send({ content: content.slice(0, 1900) }).catch(() => {});
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("botfix")
        .setDescription("Diagnose and safely repair a Carry Tavern bot problem")
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName("issue")
                .setDescription("Describe what is broken, including any error message you saw")
                .setRequired(true)
                .setMaxLength(1800)
        ),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: "❌ This command is restricted to server administrators.",
                ephemeral: true,
            });
        }

        const issue = interaction.options.getString("issue", true).trim();

        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({
            content: "🛠️ **Emergency bot repair started.** I’m checking the live bot, recent errors and safe recovery options.",
        });

        let result;
        try {
            result = await runBotRepairAgent({
                interaction,
                client: interaction.client,
                issue,
            });
        } catch (error) {
            console.error("[BOTFIX] Repair agent failed:", error);
            return interaction.editReply({
                content: `❌ **Bot repair could not complete:** ${String(error.message || "Unknown error").slice(0, 1700)}`,
            });
        }

        const chunks = splitMessage(result.text);
        const restartLine = result.restartRequested
            ? "\n\n🔄 **A clean PM2 restart was requested.** The bot will restart after this report is sent."
            : "";

        const first = `${chunks.shift() || "Repair finished."}${restartLine}`.slice(0, 1950);
        await interaction.editReply({ content: first });

        for (const chunk of chunks) {
            await interaction.followUp({ content: chunk, ephemeral: true });
        }

        await sendAudit(interaction, issue, result);

        if (result.restartRequested) {
            console.warn(`[BOTFIX] Restart requested by ${interaction.user.tag}: ${result.restartReason || "No reason supplied"}`);
            const timer = setTimeout(() => {
                process.exit(0);
            }, 3500);
            timer.unref?.();
        }
    },
};
