const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ChannelType,
} = require("discord.js");

function hasAccess(interaction) {
    if (!interaction.inGuild()) return false;
    const ownerAllowed = interaction.guild.ownerId === interaction.user.id;
    const adminAllowed = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const configuredRoleAllowed = Boolean(
        process.env.AI_MANAGER_ROLE_ID &&
        interaction.member?.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID)
    );
    return ownerAllowed || adminAllowed || configuredRoleAllowed;
}

function normalizeName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function exactCarrierCategory(guild) {
    return guild.channels.cache.find(
        (channel) =>
            channel.type === ChannelType.GuildCategory &&
            normalizeName(channel.name) === "carrierteam"
    ) || null;
}

function findTextChannelAnywhere(guild, normalizedName) {
    return guild.channels.cache.find(
        (channel) =>
            channel.type === ChannelType.GuildText &&
            normalizeName(channel.name) === normalizedName
    ) || null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("carrier-department-repair")
        .setDescription("Move Carrier Department channels into the exact Carrier Team category without AI credits"),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!hasAccess(interaction)) {
            return interaction.editReply({
                content: "❌ You do not have permission to repair the Carrier Department.",
            });
        }

        const guild = interaction.guild;
        const category = exactCarrierCategory(guild);
        if (!category) {
            return interaction.editReply({
                content: "❌ Could not find the exact `CARRIER TEAM` category. Nothing was moved.",
            });
        }

        const targetNames = [
            "carriertraining",
            "trainingreports",
            "carriermanagement",
            "applicationreviews",
            "carrierreports",
        ];

        const moved = [];
        const alreadyCorrect = [];
        const missing = [];
        const failures = [];

        for (const normalized of targetNames) {
            const channel = findTextChannelAnywhere(guild, normalized);
            if (!channel) {
                missing.push(normalized);
                continue;
            }

            if (channel.parentId === category.id) {
                alreadyCorrect.push(channel.name);
                continue;
            }

            try {
                const from = channel.parent?.name || "no category";
                await channel.setParent(category.id, {
                    lockPermissions: false,
                    reason: `Carrier Department category repair by ${interaction.user.tag}`,
                });
                moved.push(`${channel.name} (${from} → ${category.name})`);
            } catch (error) {
                failures.push(`${channel.name}: ${error.message}`);
            }
        }

        const lines = [
            "✅ **Carrier Department category repair finished**",
            `Target category: **${category.name}**`,
            "",
        ];

        if (moved.length) {
            lines.push("**Moved:**");
            for (const entry of moved) lines.push(`• ${entry}`);
        }
        if (alreadyCorrect.length) {
            lines.push("", `Already correct: ${alreadyCorrect.join(", ")}`);
        }
        if (missing.length) {
            lines.push("", `Missing channels: ${missing.join(", ")}`);
        }
        if (failures.length) {
            lines.push("", "⚠️ **Failed:**");
            for (const entry of failures) lines.push(`• ${entry}`);
        }

        lines.push("", "No OpenAI request or AI credits were used.");
        return interaction.editReply({ content: lines.join("\n").slice(0, 1900) });
    },
};
