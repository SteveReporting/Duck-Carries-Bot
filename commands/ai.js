const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");
const { runDiscordAgent } = require("../ai/agent");

function hasAiAccess(interaction) {
    if (!interaction.inGuild()) return false;

    const ownerAllowed = interaction.guild.ownerId === interaction.user.id;
    const adminAllowed = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const configuredRoleAllowed = Boolean(
        process.env.AI_MANAGER_ROLE_ID &&
        interaction.member?.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID)
    );

    return ownerAllowed || adminAllowed || configuredRoleAllowed;
}

async function run(interaction, mode, prompt) {
    if (!hasAiAccess(interaction)) {
        return interaction.reply({
            content: "❌ You do not have permission to use The Carry Tavern AI manager.",
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const result = await runDiscordAgent({ interaction, mode, prompt });
        const chunks = result.match(/[\s\S]{1,1900}/g) || ["Done."];
        await interaction.editReply(chunks.shift());
        for (const chunk of chunks) {
            await interaction.followUp({ content: chunk, ephemeral: true });
        }
    } catch (error) {
        console.error(`AI ${mode} command failed:`, error);
        await interaction.editReply(
            `❌ AI manager error: ${error.message}`.slice(0, 1900)
        );
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai")
        .setDescription("The Carry Tavern AI server manager")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("ask")
                .setDescription("Ask the AI about the current Discord server")
                .addStringOption((option) =>
                    option
                        .setName("prompt")
                        .setDescription("What do you want the AI to inspect or explain?")
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("audit")
                .setDescription("Audit the server structure, roles, permissions and webhooks")
                .addStringOption((option) =>
                    option
                        .setName("focus")
                        .setDescription("Optional area to focus on")
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("fix")
                .setDescription("Let the AI perform safe, non-destructive server changes")
                .addStringOption((option) =>
                    option
                        .setName("prompt")
                        .setDescription("Describe exactly what you want changed")
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "ask") {
            return run(interaction, "ask", interaction.options.getString("prompt", true));
        }

        if (subcommand === "audit") {
            const focus = interaction.options.getString("focus");
            return run(
                interaction,
                "audit",
                focus
                    ? `Audit the current Discord server. Focus especially on: ${focus}`
                    : "Audit the current Discord server. Inspect its categories, channels, roles, permissions and webhooks. Identify concrete organization, security or configuration problems and recommend fixes."
            );
        }

        return run(interaction, "fix", interaction.options.getString("prompt", true));
    },
};
