const {
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
    WebhookClient,
} = require("discord.js");

const READ_ONLY_TOOLS = new Set([
    "get_server_structure",
    "get_roles",
    "get_channel_permissions",
    "get_webhooks",
]);

const TOOL_DEFINITIONS = [
    {
        type: "function",
        name: "get_server_structure",
        description: "List categories and channels in the current guild, including IDs, types, parents and positions.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_roles",
        description: "List roles in the current guild with IDs, hierarchy positions, colours, display settings and key permission flags.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_channel_permissions",
        description: "Inspect permission overwrites for one channel by channel ID.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                channel_id: { type: "string" },
            },
            required: ["channel_id"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_webhooks",
        description: "List webhooks in the current guild without exposing webhook tokens.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "create_category",
        description: "Create a category in the current guild.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                name: { type: "string" },
            },
            required: ["name"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "create_text_channel",
        description: "Create a text channel, optionally inside a category.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                name: { type: "string" },
                category_id: { type: ["string", "null"] },
                topic: { type: ["string", "null"] },
            },
            required: ["name", "category_id", "topic"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "rename_channel",
        description: "Rename one existing channel by ID.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                channel_id: { type: "string" },
                name: { type: "string" },
            },
            required: ["channel_id", "name"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "move_channel",
        description: "Move a channel into a category or to no category.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                channel_id: { type: "string" },
                category_id: { type: ["string", "null"] },
            },
            required: ["channel_id", "category_id"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "create_role",
        description: "Create a role without dangerous administrative permissions.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                name: { type: "string" },
                hoist: { type: "boolean" },
                mentionable: { type: "boolean" },
            },
            required: ["name", "hoist", "mentionable"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "rename_role",
        description: "Rename an existing role by ID. Managed roles and the everyone role are blocked.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                role_id: { type: "string" },
                name: { type: "string" },
            },
            required: ["role_id", "name"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "set_role_color",
        description: "Change an existing role colour. Use a 6-digit hex colour such as #D4A24C, or null to reset to Discord's default colour.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                role_id: { type: "string" },
                color_hex: { type: ["string", "null"] },
            },
            required: ["role_id", "color_hex"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "set_role_position",
        description: "Move an existing role to an exact Discord hierarchy position. Position 1 is directly above @everyone. The role cannot be moved to or above the bot's highest role.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                role_id: { type: "string" },
                position: { type: "integer", minimum: 1 },
            },
            required: ["role_id", "position"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "set_role_display",
        description: "Change whether a role is displayed separately in the member list and whether members may mention it. Use null to leave a setting unchanged.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                role_id: { type: "string" },
                hoist: { type: ["boolean", "null"] },
                mentionable: { type: ["boolean", "null"] },
            },
            required: ["role_id", "hoist", "mentionable"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "set_role_permissions",
        description: "Set a safe subset of guild-level permissions for one role while preserving all unspecified permissions. Administrator, Manage Server, Manage Roles and other excluded high-risk permissions cannot be granted by this tool. Use null to leave a permission unchanged.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                role_id: { type: "string" },
                permissions: {
                    type: "object",
                    properties: {
                        view_channel: { type: ["boolean", "null"] },
                        send_messages: { type: ["boolean", "null"] },
                        read_message_history: { type: ["boolean", "null"] },
                        add_reactions: { type: ["boolean", "null"] },
                        attach_files: { type: ["boolean", "null"] },
                        embed_links: { type: ["boolean", "null"] },
                        use_application_commands: { type: ["boolean", "null"] },
                        connect: { type: ["boolean", "null"] },
                        speak: { type: ["boolean", "null"] },
                        mute_members: { type: ["boolean", "null"] },
                        deafen_members: { type: ["boolean", "null"] },
                        move_members: { type: ["boolean", "null"] },
                        manage_messages: { type: ["boolean", "null"] },
                        manage_threads: { type: ["boolean", "null"] },
                        manage_nicknames: { type: ["boolean", "null"] },
                        moderate_members: { type: ["boolean", "null"] },
                        kick_members: { type: ["boolean", "null"] },
                        ban_members: { type: ["boolean", "null"] },
                        view_audit_log: { type: ["boolean", "null"] },
                        manage_events: { type: ["boolean", "null"] },
                        manage_webhooks: { type: ["boolean", "null"] },
                    },
                    required: [
                        "view_channel",
                        "send_messages",
                        "read_message_history",
                        "add_reactions",
                        "attach_files",
                        "embed_links",
                        "use_application_commands",
                        "connect",
                        "speak",
                        "mute_members",
                        "deafen_members",
                        "move_members",
                        "manage_messages",
                        "manage_threads",
                        "manage_nicknames",
                        "moderate_members",
                        "kick_members",
                        "ban_members",
                        "view_audit_log",
                        "manage_events",
                        "manage_webhooks"
                    ],
                    additionalProperties: false,
                },
            },
            required: ["role_id", "permissions"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "set_channel_role_permissions",
        description: "Set a safe subset of channel permission overwrites for one role. Unspecified permissions remain unchanged.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                channel_id: { type: "string" },
                role_id: { type: "string" },
                permissions: {
                    type: "object",
                    properties: {
                        view_channel: { type: ["boolean", "null"] },
                        send_messages: { type: ["boolean", "null"] },
                        read_message_history: { type: ["boolean", "null"] },
                        add_reactions: { type: ["boolean", "null"] },
                        attach_files: { type: ["boolean", "null"] },
                        embed_links: { type: ["boolean", "null"] },
                        connect: { type: ["boolean", "null"] },
                        speak: { type: ["boolean", "null"] },
                    },
                    required: [
                        "view_channel",
                        "send_messages",
                        "read_message_history",
                        "add_reactions",
                        "attach_files",
                        "embed_links",
                        "connect",
                        "speak"
                    ],
                    additionalProperties: false,
                },
            },
            required: ["channel_id", "role_id", "permissions"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "create_webhook",
        description: "Create a webhook in a text-based channel. The token is never returned to the model.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                channel_id: { type: "string" },
                name: { type: "string" },
            },
            required: ["channel_id", "name"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "send_webhook_message",
        description: "Send a message through a webhook that already exists in the current guild, identified by webhook ID.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                webhook_id: { type: "string" },
                content: { type: "string" },
                username: { type: ["string", "null"] },
            },
            required: ["webhook_id", "content", "username"],
            additionalProperties: false,
        },
    },
];

function assertFixMode(mode) {
    if (mode !== "fix") throw new Error("This action is only available in FIX mode.");
}

function getGuildChannel(interaction, id) {
    const channel = interaction.guild.channels.cache.get(id);
    if (!channel) throw new Error(`Channel ${id} was not found in this guild.`);
    return channel;
}

function getGuildRole(interaction, id) {
    const role = interaction.guild.roles.cache.get(id);
    if (!role) throw new Error(`Role ${id} was not found in this guild.`);
    return role;
}

function ensureManageableRole(interaction, role) {
    if (role.id === interaction.guild.id) throw new Error("The @everyone role cannot be edited by the AI manager.");
    if (role.managed) throw new Error("Managed integration roles cannot be edited by the AI manager.");
    const botMember = interaction.guild.members.me;
    if (!botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
        throw new Error(`The bot role is not high enough to manage ${role.name}.`);
    }
}

function normalizeRoleColor(value) {
    if (value == null) return 0;
    const raw = String(value).trim();
    const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) throw new Error("Role colour must be a 6-digit hex value such as #D4A24C, or null to reset it.");
    return `#${match[1].toUpperCase()}`;
}

async function sendAuditLog(interaction, action, details) {
    const channelId = process.env.AI_AUDIT_CHANNEL_ID;
    if (!channelId) return;
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return;
    await channel.send({
        content: [
            "🤖 **AI Manager Action**",
            `**Staff:** ${interaction.user.tag} (${interaction.user.id})`,
            `**Action:** ${action}`,
            `**Details:** ${details}`,
        ].join("\n").slice(0, 1900),
    }).catch(() => {});
}

async function executeTool(interaction, name, args, mode) {
    switch (name) {
        case "get_server_structure": {
            return interaction.guild.channels.cache
                .sort((a, b) => a.rawPosition - b.rawPosition)
                .map((channel) => ({
                    id: channel.id,
                    name: channel.name,
                    type: ChannelType[channel.type] || String(channel.type),
                    parent_id: channel.parentId || null,
                    position: channel.rawPosition,
                }));
        }

        case "get_roles": {
            return interaction.guild.roles.cache
                .sort((a, b) => b.position - a.position)
                .map((role) => ({
                    id: role.id,
                    name: role.name,
                    position: role.position,
                    managed: role.managed,
                    color: role.color,
                    hex_color: role.hexColor,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    member_count: role.members?.size ?? 0,
                    administrator: role.permissions.has(PermissionFlagsBits.Administrator),
                    manage_guild: role.permissions.has(PermissionFlagsBits.ManageGuild),
                    manage_roles: role.permissions.has(PermissionFlagsBits.ManageRoles),
                    manage_channels: role.permissions.has(PermissionFlagsBits.ManageChannels),
                    manage_webhooks: role.permissions.has(PermissionFlagsBits.ManageWebhooks),
                    manage_messages: role.permissions.has(PermissionFlagsBits.ManageMessages),
                    manage_threads: role.permissions.has(PermissionFlagsBits.ManageThreads),
                    moderate_members: role.permissions.has(PermissionFlagsBits.ModerateMembers),
                    kick_members: role.permissions.has(PermissionFlagsBits.KickMembers),
                    ban_members: role.permissions.has(PermissionFlagsBits.BanMembers),
                }));
        }

        case "get_channel_permissions": {
            const channel = getGuildChannel(interaction, args.channel_id);
            return channel.permissionOverwrites.cache.map((overwrite) => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.toArray(),
                deny: overwrite.deny.toArray(),
            }));
        }

        case "get_webhooks": {
            const hooks = await interaction.guild.fetchWebhooks();
            return hooks.map((hook) => ({
                id: hook.id,
                name: hook.name,
                channel_id: hook.channelId,
                owner_id: hook.owner?.id || null,
            }));
        }

        case "create_category": {
            assertFixMode(mode);
            const channel = await interaction.guild.channels.create({ name: args.name, type: ChannelType.GuildCategory });
            await sendAuditLog(interaction, name, `Created category ${channel.name} (${channel.id})`);
            return { id: channel.id, name: channel.name };
        }

        case "create_text_channel": {
            assertFixMode(mode);
            if (args.category_id) {
                const parent = getGuildChannel(interaction, args.category_id);
                if (parent.type !== ChannelType.GuildCategory) throw new Error("category_id does not refer to a category.");
            }
            const channel = await interaction.guild.channels.create({
                name: args.name,
                type: ChannelType.GuildText,
                parent: args.category_id || undefined,
                topic: args.topic || undefined,
            });
            await sendAuditLog(interaction, name, `Created #${channel.name} (${channel.id})`);
            return { id: channel.id, name: channel.name, parent_id: channel.parentId };
        }

        case "rename_channel": {
            assertFixMode(mode);
            const channel = getGuildChannel(interaction, args.channel_id);
            const oldName = channel.name;
            await channel.setName(args.name);
            await sendAuditLog(interaction, name, `Renamed ${oldName} (${channel.id}) to ${channel.name}`);
            return { id: channel.id, old_name: oldName, new_name: channel.name };
        }

        case "move_channel": {
            assertFixMode(mode);
            const channel = getGuildChannel(interaction, args.channel_id);
            if (args.category_id) {
                const parent = getGuildChannel(interaction, args.category_id);
                if (parent.type !== ChannelType.GuildCategory) throw new Error("category_id does not refer to a category.");
            }
            await channel.setParent(args.category_id || null, { lockPermissions: false });
            await sendAuditLog(interaction, name, `Moved ${channel.name} (${channel.id}) to ${args.category_id || "no category"}`);
            return { id: channel.id, parent_id: channel.parentId };
        }

        case "create_role": {
            assertFixMode(mode);
            const role = await interaction.guild.roles.create({
                name: args.name,
                hoist: args.hoist,
                mentionable: args.mentionable,
                permissions: [],
                reason: `AI manager request by ${interaction.user.tag}`,
            });
            await sendAuditLog(interaction, name, `Created role ${role.name} (${role.id})`);
            return { id: role.id, name: role.name };
        }

        case "rename_role": {
            assertFixMode(mode);
            const role = getGuildRole(interaction, args.role_id);
            ensureManageableRole(interaction, role);
            const oldName = role.name;
            await role.setName(args.name, `AI manager request by ${interaction.user.tag}`);
            await sendAuditLog(interaction, name, `Renamed role ${oldName} (${role.id}) to ${role.name}`);
            return { id: role.id, old_name: oldName, new_name: role.name };
        }

        case "set_role_color": {
            assertFixMode(mode);
            const role = getGuildRole(interaction, args.role_id);
            ensureManageableRole(interaction, role);
            const oldColor = role.hexColor;
            const requestedColor = normalizeRoleColor(args.color_hex);
            const updated = await role.setColor(requestedColor, `AI manager request by ${interaction.user.tag}`);
            await sendAuditLog(interaction, name, `Changed ${role.name} (${role.id}) colour from ${oldColor} to ${updated.hexColor}`);
            return { id: role.id, name: role.name, old_color: oldColor, new_color: updated.hexColor };
        }

        case "set_role_position": {
            assertFixMode(mode);
            const role = getGuildRole(interaction, args.role_id);
            ensureManageableRole(interaction, role);
            const requestedPosition = Number(args.position);
            if (!Number.isInteger(requestedPosition) || requestedPosition < 1) {
                throw new Error("Role hierarchy position must be an integer of 1 or greater.");
            }
            const botMember = interaction.guild.members.me;
            const highestBotPosition = botMember?.roles?.highest?.position ?? 0;
            if (requestedPosition >= highestBotPosition) {
                throw new Error(`The AI manager cannot move a role to position ${requestedPosition} because the bot's highest role is at position ${highestBotPosition}.`);
            }
            const oldPosition = role.position;
            const updated = await role.setPosition(requestedPosition, { reason: `AI manager request by ${interaction.user.tag}` });
            await sendAuditLog(interaction, name, `Moved ${role.name} (${role.id}) from hierarchy position ${oldPosition} to ${updated.position}`);
            return { id: role.id, name: role.name, old_position: oldPosition, new_position: updated.position };
        }

        case "set_role_display": {
            assertFixMode(mode);
            const role = getGuildRole(interaction, args.role_id);
            ensureManageableRole(interaction, role);
            const old = { hoist: role.hoist, mentionable: role.mentionable };
            let updated = role;
            if (args.hoist !== null) {
                updated = await updated.setHoist(args.hoist, `AI manager request by ${interaction.user.tag}`);
            }
            if (args.mentionable !== null) {
                updated = await updated.setMentionable(args.mentionable, `AI manager request by ${interaction.user.tag}`);
            }
            await sendAuditLog(interaction, name, `Updated display settings for ${role.name} (${role.id}): hoist ${old.hoist} -> ${updated.hoist}, mentionable ${old.mentionable} -> ${updated.mentionable}`);
            return {
                id: role.id,
                name: role.name,
                old,
                new: { hoist: updated.hoist, mentionable: updated.mentionable },
            };
        }

        case "set_role_permissions": {
            assertFixMode(mode);
            const role = getGuildRole(interaction, args.role_id);
            ensureManageableRole(interaction, role);
            const mapping = {
                view_channel: PermissionFlagsBits.ViewChannel,
                send_messages: PermissionFlagsBits.SendMessages,
                read_message_history: PermissionFlagsBits.ReadMessageHistory,
                add_reactions: PermissionFlagsBits.AddReactions,
                attach_files: PermissionFlagsBits.AttachFiles,
                embed_links: PermissionFlagsBits.EmbedLinks,
                use_application_commands: PermissionFlagsBits.UseApplicationCommands,
                connect: PermissionFlagsBits.Connect,
                speak: PermissionFlagsBits.Speak,
                mute_members: PermissionFlagsBits.MuteMembers,
                deafen_members: PermissionFlagsBits.DeafenMembers,
                move_members: PermissionFlagsBits.MoveMembers,
                manage_messages: PermissionFlagsBits.ManageMessages,
                manage_threads: PermissionFlagsBits.ManageThreads,
                manage_nicknames: PermissionFlagsBits.ManageNicknames,
                moderate_members: PermissionFlagsBits.ModerateMembers,
                kick_members: PermissionFlagsBits.KickMembers,
                ban_members: PermissionFlagsBits.BanMembers,
                view_audit_log: PermissionFlagsBits.ViewAuditLog,
                manage_events: PermissionFlagsBits.ManageEvents,
                manage_webhooks: PermissionFlagsBits.ManageWebhooks,
            };
            const next = new PermissionsBitField(role.permissions.bitfield);
            const changed = {};
            for (const [key, flag] of Object.entries(mapping)) {
                const value = args.permissions[key];
                if (value === null || value === undefined) continue;
                if (value) next.add(flag);
                else next.remove(flag);
                changed[key] = value;
            }
            const updated = await role.setPermissions(next, `AI manager request by ${interaction.user.tag}`);
            await sendAuditLog(interaction, name, `Updated safe guild permissions for ${role.name} (${role.id}): ${JSON.stringify(changed)}`);
            return {
                id: role.id,
                name: role.name,
                changed,
                permissions: updated.permissions.toArray(),
            };
        }

        case "set_channel_role_permissions": {
            assertFixMode(mode);
            const channel = getGuildChannel(interaction, args.channel_id);
            const role = getGuildRole(interaction, args.role_id);
            ensureManageableRole(interaction, role);
            const mapping = {
                view_channel: "ViewChannel",
                send_messages: "SendMessages",
                read_message_history: "ReadMessageHistory",
                add_reactions: "AddReactions",
                attach_files: "AttachFiles",
                embed_links: "EmbedLinks",
                connect: "Connect",
                speak: "Speak",
            };
            const update = {};
            for (const [key, permissionName] of Object.entries(mapping)) {
                if (Object.prototype.hasOwnProperty.call(args.permissions, key)) {
                    update[permissionName] = args.permissions[key];
                }
            }
            await channel.permissionOverwrites.edit(role, update, { reason: `AI manager request by ${interaction.user.tag}` });
            await sendAuditLog(interaction, name, `Updated safe permissions for ${role.name} (${role.id}) in ${channel.name} (${channel.id})`);
            return { channel_id: channel.id, role_id: role.id, changed: args.permissions };
        }

        case "create_webhook": {
            assertFixMode(mode);
            const channel = getGuildChannel(interaction, args.channel_id);
            if (!channel.isTextBased() || !channel.createWebhook) throw new Error("This channel cannot host webhooks.");
            const hook = await channel.createWebhook({ name: args.name, reason: `AI manager request by ${interaction.user.tag}` });
            await sendAuditLog(interaction, name, `Created webhook ${hook.name} (${hook.id}) in ${channel.name}`);
            return { id: hook.id, name: hook.name, channel_id: hook.channelId };
        }

        case "send_webhook_message": {
            assertFixMode(mode);
            const hooks = await interaction.guild.fetchWebhooks();
            const hook = hooks.get(args.webhook_id);
            if (!hook || !hook.token) throw new Error("Webhook not found in this guild, or its token is unavailable to this bot.");
            const client = new WebhookClient({ id: hook.id, token: hook.token });
            const message = await client.send({ content: args.content.slice(0, 2000), username: args.username || undefined });
            client.destroy();
            await sendAuditLog(interaction, name, `Sent webhook message through ${hook.name} (${hook.id})`);
            return { message_id: message.id, webhook_id: hook.id };
        }

        default:
            throw new Error(`Unknown Discord tool: ${name}`);
    }
}

module.exports = { TOOL_DEFINITIONS, READ_ONLY_TOOLS, executeTool };
