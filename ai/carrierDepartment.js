const {
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
} = require("discord.js");

const TOOL_DEFINITION = {
    type: "function",
    name: "setup_carrier_department",
    description: "Idempotently configure the existing single Carrier Team category for The Carry Tavern. Creates only missing Carrier management/trainee roles and missing Carrier channels, applies the approved private/public access matrix, preserves unrelated roles/channels/overwrites, keeps existing Carrier progression roles unchanged, and never creates another category. Prefer this tool for the standard Carrier Department restructure instead of many individual Discord tool calls.",
    strict: true,
    parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
    },
};

function normalizeName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function findRole(guild, name) {
    const wanted = normalizeName(name);
    return guild.roles.cache.find((role) => !role.managed && normalizeName(role.name) === wanted) || null;
}

function findCategory(guild) {
    return guild.channels.cache.find((channel) =>
        channel.type === ChannelType.GuildCategory &&
        normalizeName(channel.name).includes("carrierteam")
    ) || null;
}

function findChannelInCategory(guild, categoryId, name) {
    const wanted = normalizeName(name);
    return guild.channels.cache.find((channel) =>
        channel.parentId === categoryId &&
        channel.type === ChannelType.GuildText &&
        normalizeName(channel.name) === wanted
    ) || null;
}

async function setupCarrierDepartment(interaction) {
    const guild = interaction.guild;
    const reason = `Carrier Department setup requested by ${interaction.user.tag}`;
    const category = findCategory(guild);

    if (!category) {
        throw new Error("Could not find the existing Carrier Team category. No new category was created.");
    }

    const botMember = guild.members.me;
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error("The bot needs Manage Roles to create/configure Carrier management roles.");
    }
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error("The bot needs Manage Channels to create/configure Carrier channels and overwrites.");
    }

    const createdRoles = [];
    const createdChannels = [];
    const updatedPermissions = [];
    const warnings = [];

    const managementSpecs = [
        { name: "Head of Carriers", color: "#D4A24C" },
        { name: "Deputy Head of Carriers", color: "#C28A2C" },
        { name: "Recruitment Lead", color: "#9B6B1F" },
        { name: "Training Lead", color: "#9B6B1F" },
        { name: "Carrier Supervisor", color: "#8A672E" },
        { name: "Carrier Mentor", color: "#7B6542" },
        { name: "Trainee Carrier", color: "#6B6258" },
    ];

    const roles = {};

    for (const spec of managementSpecs) {
        let role = findRole(guild, spec.name);
        if (!role) {
            role = await guild.roles.create({
                name: spec.name,
                color: spec.color,
                hoist: false,
                mentionable: false,
                permissions: [],
                reason,
            });
            createdRoles.push(role.name);
        } else {
            if (botMember.roles.highest.comparePositionTo(role) > 0) {
                const dangerous = [
                    PermissionFlagsBits.Administrator,
                    PermissionFlagsBits.ManageGuild,
                    PermissionFlagsBits.ManageRoles,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageWebhooks,
                    PermissionFlagsBits.KickMembers,
                    PermissionFlagsBits.BanMembers,
                ];
                const next = new PermissionsBitField(role.permissions.bitfield);
                for (const flag of dangerous) next.remove(flag);
                await role.setPermissions(next, reason).catch((error) => warnings.push(`${role.name} permissions: ${error.message}`));
                await role.setColor(spec.color, reason).catch((error) => warnings.push(`${role.name} colour: ${error.message}`));
                await role.setHoist(false, reason).catch(() => {});
                await role.setMentionable(false, reason).catch(() => {});
            } else {
                warnings.push(`${role.name} is above the bot and could not be normalised.`);
            }
        }
        roles[spec.name] = role;
    }

    const carrierTeam = findRole(guild, "Carrier Team");
    if (!carrierTeam) {
        throw new Error("The existing Carrier Team role was not found. Setup stopped to avoid creating a duplicate.");
    }

    const progressionNames = [
        "Barback",
        "Bartender",
        "Caskkeeper",
        "Tapmaster",
        "Brewmaster",
        "Master of the Tap",
    ];
    const progressionRoles = progressionNames.map((name) => findRole(guild, name)).filter(Boolean);
    const hierarchyAnchor = Math.max(carrierTeam.position, ...progressionRoles.map((role) => role.position));
    const botHighest = botMember.roles.highest.position;

    if (botHighest > hierarchyAnchor + 6) {
        const bottomToTop = [
            "Carrier Mentor",
            "Carrier Supervisor",
            "Training Lead",
            "Recruitment Lead",
            "Deputy Head of Carriers",
            "Head of Carriers",
        ];
        for (let index = 0; index < bottomToTop.length; index += 1) {
            const role = roles[bottomToTop[index]];
            if (role && botMember.roles.highest.comparePositionTo(role) > 0) {
                await role.setPosition(hierarchyAnchor + index + 1, { reason }).catch((error) => {
                    warnings.push(`Could not position ${role.name}: ${error.message}`);
                });
            }
        }
    } else {
        warnings.push("Bot role is not high enough to place all Carrier management roles above the existing Carrier progression roles. Roles were created safely but hierarchy may need a manual drag.");
    }

    const refreshedCarrierTeam = findRole(guild, "Carrier Team");
    const trainee = roles["Trainee Carrier"];
    if (trainee && refreshedCarrierTeam && botMember.roles.highest.comparePositionTo(trainee) > 0) {
        const target = Math.max(1, refreshedCarrierTeam.position - 1);
        await trainee.setPosition(target, { reason }).catch((error) => warnings.push(`Could not position Trainee Carrier: ${error.message}`));
    }

    const channelSpecs = [
        { name: "carrier-training", display: "🎓・carrier-training", topic: "Training, onboarding and practical guidance for Trainee Carriers." },
        { name: "training-reports", display: "📝・training-reports", topic: "Private Carrier training assessments, reports and probation notes." },
        { name: "carrier-management", display: "🛡️・carrier-management", topic: "Private Carrier Department management discussion." },
        { name: "application-reviews", display: "📋・application-reviews", topic: "Private review of Carrier applications and recruitment decisions." },
        { name: "carrier-reports", display: "⚠️・carrier-reports", topic: "Private Carrier conduct, issue and disciplinary reports." },
    ];

    const channels = {};
    const existingAliases = {
        "become-a-carrier": "become-a-carrier",
        "bartender-chat": "bartender-chat",
        "carrier-news": "carrier-news",
        "carrier-guide": "carrier-guide",
        "carrier-leaderboard": "carrier-leaderboard",
    };

    for (const [key, name] of Object.entries(existingAliases)) {
        channels[key] = findChannelInCategory(guild, category.id, name);
        if (!channels[key]) warnings.push(`Existing channel ${name} was not found inside ${category.name}; it was not recreated or renamed.`);
    }

    for (const spec of channelSpecs) {
        let channel = findChannelInCategory(guild, category.id, spec.name);
        if (!channel) {
            channel = await guild.channels.create({
                name: spec.display,
                type: ChannelType.GuildText,
                parent: category.id,
                topic: spec.topic,
                reason,
            });
            createdChannels.push(channel.name);
        }
        channels[spec.name] = channel;
    }

    const everyone = guild.roles.everyone;
    const head = roles["Head of Carriers"];
    const deputy = roles["Deputy Head of Carriers"];
    const recruitment = roles["Recruitment Lead"];
    const training = roles["Training Lead"];
    const supervisor = roles["Carrier Supervisor"];
    const mentor = roles["Carrier Mentor"];

    async function overwrite(channelKey, role, permissions) {
        const channel = channels[channelKey];
        if (!channel || !role) return;
        try {
            await channel.permissionOverwrites.edit(role, permissions, { reason });
            updatedPermissions.push(`${channel.name}:${role.name}`);
        } catch (error) {
            warnings.push(`${channel.name} / ${role.name}: ${error.message}`);
        }
    }

    const readOnly = {
        ViewChannel: true,
        SendMessages: false,
        ReadMessageHistory: true,
        AddReactions: true,
    };
    const standard = {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AddReactions: true,
        AttachFiles: true,
        EmbedLinks: true,
        UseApplicationCommands: true,
    };
    const manager = {
        ...standard,
        ManageMessages: true,
        ManageThreads: true,
    };
    const hidden = { ViewChannel: false };

    // Existing public/member-facing channels.
    await overwrite("become-a-carrier", everyone, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true });
    await overwrite("become-a-carrier", head, manager);
    await overwrite("become-a-carrier", deputy, manager);
    await overwrite("become-a-carrier", recruitment, manager);

    await overwrite("bartender-chat", everyone, hidden);
    await overwrite("bartender-chat", carrierTeam, standard);
    await overwrite("bartender-chat", trainee, hidden);
    for (const role of [head, deputy, recruitment, training, supervisor]) await overwrite("bartender-chat", role, manager);
    await overwrite("bartender-chat", mentor, standard);

    await overwrite("carrier-news", everyone, hidden);
    await overwrite("carrier-news", carrierTeam, readOnly);
    await overwrite("carrier-news", trainee, readOnly);
    await overwrite("carrier-news", head, manager);
    await overwrite("carrier-news", deputy, manager);
    await overwrite("carrier-news", recruitment, standard);
    await overwrite("carrier-news", training, standard);
    await overwrite("carrier-news", supervisor, readOnly);
    await overwrite("carrier-news", mentor, readOnly);

    await overwrite("carrier-guide", everyone, hidden);
    await overwrite("carrier-guide", carrierTeam, readOnly);
    await overwrite("carrier-guide", trainee, readOnly);
    await overwrite("carrier-guide", head, manager);
    await overwrite("carrier-guide", deputy, manager);
    await overwrite("carrier-guide", training, manager);
    await overwrite("carrier-guide", recruitment, readOnly);
    await overwrite("carrier-guide", supervisor, readOnly);
    await overwrite("carrier-guide", mentor, readOnly);

    await overwrite("carrier-leaderboard", everyone, hidden);
    await overwrite("carrier-leaderboard", carrierTeam, readOnly);
    await overwrite("carrier-leaderboard", trainee, hidden);

    // Training channel.
    await overwrite("carrier-training", everyone, hidden);
    await overwrite("carrier-training", carrierTeam, hidden);
    await overwrite("carrier-training", trainee, standard);
    await overwrite("carrier-training", mentor, manager);
    await overwrite("carrier-training", supervisor, manager);
    await overwrite("carrier-training", training, manager);
    await overwrite("carrier-training", recruitment, standard);
    await overwrite("carrier-training", deputy, manager);
    await overwrite("carrier-training", head, manager);

    // Training reports.
    await overwrite("training-reports", everyone, hidden);
    await overwrite("training-reports", carrierTeam, hidden);
    await overwrite("training-reports", trainee, hidden);
    await overwrite("training-reports", mentor, standard);
    await overwrite("training-reports", supervisor, manager);
    await overwrite("training-reports", training, manager);
    await overwrite("training-reports", recruitment, standard);
    await overwrite("training-reports", deputy, manager);
    await overwrite("training-reports", head, manager);

    // General management.
    await overwrite("carrier-management", everyone, hidden);
    await overwrite("carrier-management", carrierTeam, hidden);
    await overwrite("carrier-management", trainee, hidden);
    await overwrite("carrier-management", mentor, hidden);
    for (const role of [supervisor, recruitment, training]) await overwrite("carrier-management", role, standard);
    await overwrite("carrier-management", deputy, manager);
    await overwrite("carrier-management", head, manager);

    // Application reviews.
    await overwrite("application-reviews", everyone, hidden);
    await overwrite("application-reviews", carrierTeam, hidden);
    await overwrite("application-reviews", trainee, hidden);
    await overwrite("application-reviews", mentor, hidden);
    await overwrite("application-reviews", supervisor, standard);
    await overwrite("application-reviews", training, standard);
    await overwrite("application-reviews", recruitment, manager);
    await overwrite("application-reviews", deputy, manager);
    await overwrite("application-reviews", head, manager);

    // Carrier reports.
    await overwrite("carrier-reports", everyone, hidden);
    await overwrite("carrier-reports", carrierTeam, hidden);
    await overwrite("carrier-reports", trainee, hidden);
    await overwrite("carrier-reports", mentor, hidden);
    await overwrite("carrier-reports", supervisor, standard);
    await overwrite("carrier-reports", recruitment, standard);
    await overwrite("carrier-reports", training, standard);
    await overwrite("carrier-reports", deputy, manager);
    await overwrite("carrier-reports", head, manager);

    return {
        category: { id: category.id, name: category.name },
        created_roles: createdRoles,
        created_channels: createdChannels,
        permission_overwrites_updated: updatedPermissions.length,
        preserved_progression_roles: progressionRoles.map((role) => role.name),
        warnings,
        note: "No new category was created. Existing unrelated roles, channels and permission overwrites were preserved.",
    };
}

module.exports = { TOOL_DEFINITION, setupCarrierDepartment };
