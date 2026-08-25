const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require("discord.js");

const { setupCarrierDepartment } = require("../ai/carrierDepartment");

const ROLE_CHOICES = [
    { name: "Head of Carriers", value: "Head of Carriers" },
    { name: "Deputy Head of Carriers", value: "Deputy Head of Carriers" },
    { name: "Recruitment Lead", value: "Recruitment Lead" },
    { name: "Training Lead", value: "Training Lead" },
    { name: "Carrier Supervisor", value: "Carrier Supervisor" },
    { name: "Carrier Mentor", value: "Carrier Mentor" },
    { name: "Trainee Carrier", value: "Trainee Carrier" },
];

const SINGLETON_ROLES = new Set([
    "Head of Carriers",
    "Deputy Head of Carriers",
    "Recruitment Lead",
    "Training Lead",
]);

function hasDepartmentAccess(interaction) {
    if (!interaction.inGuild()) return false;

    const ownerAllowed = interaction.guild.ownerId === interaction.user.id;
    const adminAllowed = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const configuredRoleAllowed = Boolean(
        process.env.AI_MANAGER_ROLE_ID &&
        interaction.member?.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID)
    );

    return ownerAllowed || adminAllowed || configuredRoleAllowed;
}

function findRole(guild, roleName) {
    return guild.roles.cache.find(
        (role) => !role.managed && role.name.toLowerCase() === roleName.toLowerCase()
    ) || null;
}

async function assignDepartmentRole(interaction, roleName, user) {
    const role = findRole(interaction.guild, roleName);
    if (!role) {
        throw new Error(`${roleName} does not exist yet. Run /carrier-department setup first.`);
    }

    const botMember = interaction.guild.members.me;
    if (!botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
        throw new Error(`The bot role is not high enough to assign ${roleName}.`);
    }

    const member = await interaction.guild.members.fetch(user.id);

    if (SINGLETON_ROLES.has(roleName)) {
        await interaction.guild.members.fetch();
        for (const current of role.members.values()) {
            if (current.id === member.id) continue;
            await current.roles.remove(role, `Carrier Department reassignment by ${interaction.user.tag}`);
        }
    }

    await member.roles.add(role, `Carrier Department assignment by ${interaction.user.tag}`);
    return { member, role };
}

function formatSetupResult(result) {
    const lines = [
        "✅ **Carrier Department setup complete**",
        `Category: **${result.category.name}**`,
        `Roles created: **${result.created_roles.length}**`,
        `Channels created: **${result.created_channels.length}**`,
        `Permission overwrites updated: **${result.permission_overwrites_updated}**`,
    ];

    if (result.created_roles.length) {
        lines.push(`New roles: ${result.created_roles.join(", ")}`);
    }
    if (result.created_channels.length) {
        lines.push(`New channels: ${result.created_channels.join(", ")}`);
    }
    if (result.warnings?.length) {
        lines.push("", "⚠️ **Warnings**");
        for (const warning of result.warnings.slice(0, 8)) lines.push(`• ${warning}`);
        if (result.warnings.length > 8) lines.push(`• +${result.warnings.length - 8} more warning(s)`);
    }

    lines.push("", "No OpenAI request was used for this setup.");
    return lines.join("\n").slice(0, 1900);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("carrier-department")
        .setDescription("Set up and manage the Carrier Department without using AI credits")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription("Create/fix the approved one-category Carrier Department structure")
                .addUserOption((option) =>
                    option
                        .setName("head")
                        .setDescription("Optional: assign the Head of Carriers after setup")
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("assign")
                .setDescription("Assign a Carrier Department role without using AI")
                .addStringOption((option) =>
                    option
                        .setName("role")
                        .setDescription("Department role to assign")
                        .setRequired(true)
                        .addChoices(...ROLE_CHOICES)
                )
                .addUserOption((option) =>
                    option
                        .setName("member")
                        .setDescription("Member to receive the role")
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!hasDepartmentAccess(interaction)) {
            return interaction.editReply({
                content: "❌ You do not have permission to manage the Carrier Department.",
            });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === "setup") {
                const result = await setupCarrierDepartment(interaction);
                const head = interaction.options.getUser("head");

                let content = formatSetupResult(result);
                if (head) {
                    const assigned = await assignDepartmentRole(interaction, "Head of Carriers", head);
                    content += `\n\n🍻 **Head of Carriers:** ${assigned.member}`;
                }

                return interaction.editReply({ content: content.slice(0, 1900) });
            }

            const roleName = interaction.options.getString("role", true);
            const user = interaction.options.getUser("member", true);
            const assigned = await assignDepartmentRole(interaction, roleName, user);

            return interaction.editReply({
                content: `✅ Assigned ${assigned.member} to **${assigned.role.name}**.\n\nNo OpenAI request or AI credits were used.`,
            });
        } catch (error) {
            console.error("[CARRIER DEPARTMENT]", error);
            return interaction.editReply({
                content: `❌ Carrier Department action failed: ${error.message || "Unknown error"}`.slice(0, 1900),
            });
        }
    },
};
