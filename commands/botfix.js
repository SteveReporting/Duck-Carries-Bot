const {
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const { runCodeRepairAgent } = require("../ai/codeRepairAgent");

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
        `**Result:** ${String(result.text || "No report").slice(0, 650)}`,
        result.changedFiles?.length ? `**Files changed:** ${result.changedFiles.join(", ").slice(0, 350)}` : "**Files changed:** None",
        result.commitSha ? `**Commit:** ${String(result.commitSha).slice(0, 12)}${result.pushed ? " (pushed to main)" : " (local only)"}` : "**Commit:** None",
        result.restartRequested ? `**Restart:** Requested — ${String(result.restartReason || "no reason supplied").slice(0, 200)}` : "**Restart:** Not requested",
    ].join("\n");

    await channel.send({ content: content.slice(0, 1900) }).catch(() => {});
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("botfix")
        .setDescription("Diagnose and repair Carry Tavern bot problems, including code fixes")
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
            content: "🛠️ **Emergency bot repair started.** I’m checking the live bot, logs and source code. If I confirm a code defect, I can patch it, validate it and push the fix to `main`.",
        });

        let result;
        try {
            result = await runCodeRepairAgent({
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
        const deployLine = result.commitSha
            ? `\n\n🧩 **Code commit:** \`${String(result.commitSha).slice(0, 12)}\` — ${result.pushed ? "pushed to `main`." : "created locally but was not pushed."}`
            : "";
        const restartLine = result.restartRequested
            ? "\n🔄 **A clean PM2 restart was requested.** The bot will restart after this report is sent."
            : "";

        const first = `${chunks.shift() || "Repair finished."}${deployLine}${restartLine}`.slice(0, 1950);
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
