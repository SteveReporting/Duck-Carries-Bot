const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require("discord.js");

const { runDiscordAgent } = require("../ai/agent");

function hasAiAccess(interaction) {
    if (!interaction.inGuild()) return false;

    const ownerAllowed = interaction.guild.ownerId === interaction.user.id;
    const adminAllowed = interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    );
    const configuredRoleAllowed = Boolean(
        process.env.AI_MANAGER_ROLE_ID &&
        interaction.member?.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID)
    );

    return ownerAllowed || adminAllowed || configuredRoleAllowed;
}

function splitMessage(text) {
    const value = String(text || "Done.");
    return value.match(/[\s\S]{1,1900}/g) || ["Done."];
}

async function runAgent(interaction, mode, prompt) {
    console.log(`[AI] Starting ${mode}`);

    try {
        const result = await runDiscordAgent({
            interaction,
            mode,
            prompt,
        });

        console.log(`[AI] ${mode} completed successfully`);

        const chunks = splitMessage(result);
        const first = chunks.shift() || "✅ Done.";

        await interaction.editReply(first);

        for (const chunk of chunks) {
            await interaction.followUp({ content: chunk });
        }
    } catch (error) {
        console.error(`[AI ERROR] ${mode}:`, error);

        const message = `❌ AI manager error: ${error.message || "Unknown error"}`.slice(
            0,
            1900
        );

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply(message);
            } else {
                await interaction.reply(message);
            }
        } catch (replyError) {
            console.error("[AI ERROR] Could not send error reply:", replyError);
        }
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
        console.log(`[AI] /ai received from ${interaction.user.username}`);

        if (!hasAiAccess(interaction)) {
            return interaction.reply({
                content: "❌ You do not have permission to use The Carry Tavern AI manager.",
                flags: MessageFlags.Ephemeral,
            });
        }

        // IMPORTANT: acknowledge Discord immediately. On this host, deferReply()
        // has repeatedly failed to acknowledge the interaction in time.
        await interaction.reply("⏳ **The Carry Tavern AI Manager is working...**");
        console.log("[AI] Initial Discord reply sent successfully");

        const subcommand = interaction.options.getSubcommand();
        console.log(`[AI] Subcommand: ${subcommand}`);

        if (subcommand === "ask") {
            return runAgent(
                interaction,
                "ask",
                interaction.options.getString("prompt", true)
            );
        }

        if (subcommand === "audit") {
            const focus = interaction.options.getString("focus");
            return runAgent(
                interaction,
                "audit",
                focus
                    ? `Audit the current Discord server. Focus especially on: ${focus}`
                    : "Audit the current Discord server. Inspect its categories, channels, roles, permissions and webhooks. Identify concrete organization, security or configuration problems and recommend fixes."
            );
        }

        return runAgent(
            interaction,
            "fix",
            interaction.options.getString("prompt", true)
        );
    },
};