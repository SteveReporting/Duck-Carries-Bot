const {
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
} = require("discord.js");

const TOOL_DEFINITION = {
    type: "function",
    name: "setup_carrier_department",
    description: "Idempotently configure the exact existing Carrier Team category for The Carry Tavern. Reuses existing department channels, removes only accidental duplicate department channels from Carrier Team Tickets when a correct copy exists, creates only genuinely missing Carrier management/trainee roles or department channels, applies the approved access matrix, preserves unrelated roles/channels/overwrites, keeps existing Carrier progression roles unchanged, never creates another category, and never changes role hierarchy positions.",
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
        normalizeName(channel.name) === "carrierteam"
    ) || null;
}

function findTicketCategory(guild) {
    return guild.channels.cache.find((channel) =>
        channel.type === ChannelType.GuildCategory &&
        normalizeName(channel.name) === "carrierteamtickets"
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

function findChannelsInCategory(guild, categoryId, name) {
    const wanted = normalizeName(name);
    return guild.channels.cache.filter((channel) =>
        channel.parentId === categoryId &&
        channel.type === ChannelType.GuildText &&
        normalizeName(channel.name) === wanted
    );
}

async function setupCarrierDepartment(interaction) {
    const guild = interaction.guild;
    const reason = `Carrier Department setup requested by ${interaction.user.tag}`;
    const category = findCategory(guild);

    if (!category) {
        throw new Error("Could not find the exact CARRIER TEAM category. No category or channels were created.");
    }

    const ticketCategory = findTicketCategory(guild);
    const botMember = guild.members.me;
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error("The bot needs Manage Roles to create/configure Carrier management roles.");
    }
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error("The bot needs Manage Channels to create/configure Carrier channels and overwrites.");
    }

    const createdRoles = [];
    const createdChannels = [];
    const recoveredChannels = [];
    const deletedDuplicateChannels = [];
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
        }

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
            warnings.push(`${role.name} is above the bot and could not be fully normalised.`);
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
    const trainee = roles["Trainee Carrier"];

    // Role hierarchy is intentionally untouched here. The old setup anchored
    // Carrier roles to Carrier Team and could drag the entire block to the
    // bottom of the server. Hierarchy is now changed only by the explicit
    // /carrier-department hierarchy command with an owner-selected anchor.

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

        if (!channel && ticketCategory) {
            const misplaced = findChannelsInCategory(guild, ticketCategory.id, spec.name).first() || null;
            if (misplaced) {
                await misplaced.setParent(category.id, { lockPermissions: false, reason });
                channel = misplaced;
                recoveredChannels.push(channel.name);
            }
        }

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

        if (ticketCategory) {
            const duplicates = findChannelsInCategory(guild, ticketCategory.id, spec.name);
            for (const duplicate of duplicates.values()) {
                try {
                    const duplicateName = duplicate.name;
                    await duplicate.delete(`Removing accidental Carrier Department duplicate created in Carrier Team Tickets by ${interaction.user.tag}`);
                    deletedDuplicateChannels.push(duplicateName);
                } catch (error) {
                    warnings.push(`Could not delete duplicate ${duplicate.name} from ${ticketCategory.name}: ${error.message}`);
                }
            }
        }
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

    await overwrite("carrier-training", everyone, hidden);
    await overwrite("carrier-training", carrierTeam, hidden);
    await overwrite("carrier-training", trainee, standard);
    await overwrite("carrier-training", mentor, manager);
    await overwrite("carrier-training", supervisor, manager);
    await overwrite("carrier-training", training, manager);
    await overwrite("carrier-training", recruitment, standard);
    await overwrite("carrier-training", deputy, manager);
    await overwrite("carrier-training", head, manager);

    await overwrite("training-reports", everyone, hidden);
    await overwrite("training-reports", carrierTeam, hidden);
    await overwrite("training-reports", trainee, hidden);
    await overwrite("training-reports", mentor, standard);
    await overwrite("training-reports", supervisor, manager);
    await overwrite("training-reports", training, manager);
    await overwrite("training-reports", recruitment, standard);
    await overwrite("training-reports", deputy, manager);
    await overwrite("training-reports", head, manager);

    await overwrite("carrier-management", everyone, hidden);
    await overwrite("carrier-management", carrierTeam, hidden);
    await overwrite("carrier-management", trainee, hidden);
    await overwrite("carrier-management", mentor, hidden);
    for (const role of [supervisor, recruitment, training]) await overwrite("carrier-management", role, standard);
    await overwrite("carrier-management", deputy, manager);
    await overwrite("carrier-management", head, manager);

    await overwrite("application-reviews", everyone, hidden);
    await overwrite("application-reviews", carrierTeam, hidden);
    await overwrite("application-reviews", trainee, hidden);
    await overwrite("application-reviews", mentor, hidden);
    await overwrite("application-reviews", supervisor, standard);
    await overwrite("application-reviews", training, standard);
    await overwrite("application-reviews", recruitment, manager);
    await overwrite("application-reviews", deputy, manager);
    await overwrite("application-reviews", head, manager);

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
        ticket_category: ticketCategory ? { id: ticketCategory.id, name: ticketCategory.name } : null,
        created_roles: createdRoles,
        created_channels: createdChannels,
        recovered_channels: recoveredChannels,
        deleted_duplicate_channels: deletedDuplicateChannels,
        permission_overwrites_updated: updatedPermissions.length,
        preserved_progression_roles: progressionRoles.map((role) => role.name),
        hierarchy_changed: false,
        warnings,
        note: "Targeted the exact CARRIER TEAM category only. Existing correct department channels were reused. Only same-name accidental department duplicates inside Carrier Team Tickets were eligible for deletion; duck-request ticket channels and unrelated content were untouched. Role hierarchy positions were not changed.",
    };
}

module.exports = { TOOL_DEFINITION, setupCarrierDepartment };
