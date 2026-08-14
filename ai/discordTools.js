const {
    ChannelType,
    PermissionFlagsBits,
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
        description: "List roles in the current guild with IDs, positions and key permission flags.",
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
                    administrator: role.permissions.has(PermissionFlagsBits.Administrator),
                    manage_guild: role.permissions.has(PermissionFlagsBits.ManageGuild),
                    manage_roles: role.permissions.has(PermissionFlagsBits.ManageRoles),
                    manage_channels: role.permissions.has(PermissionFlagsBits.ManageChannels),
                    manage_webhooks: role.permissions.has(PermissionFlagsBits.ManageWebhooks),
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

        case "set_channel_role_permissions": {
            assertFixMode(mode);
            const channel = getGuildChannel(interaction, args.channel_id);
            const role = getGuildRole(interaction, args.role_id);
            ensureManageableRole(interaction, role);
            const mapping = {
                view_channel: PermissionFlagsBits.ViewChannel,
                send_messages: PermissionFlagsBits.SendMessages,
                read_message_history: PermissionFlagsBits.ReadMessageHistory,
                add_reactions: PermissionFlagsBits.AddReactions,
                attach_files: PermissionFlagsBits.AttachFiles,
                embed_links: PermissionFlagsBits.EmbedLinks,
                connect: PermissionFlagsBits.Connect,
                speak: PermissionFlagsBits.Speak,
            };
            const update = {};
            for (const [key, flag] of Object.entries(mapping)) {
                if (Object.prototype.hasOwnProperty.call(args.permissions, key)) {
                    update[flag] = args.permissions[key];
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
            await client.destroy();
            await sendAuditLog(interaction, name, `Sent webhook message through ${hook.name} (${hook.id})`);
            return { message_id: message.id, webhook_id: hook.id };
        }

        default:
            throw new Error(`Unknown Discord tool: ${name}`);
    }
}

module.exports = { TOOL_DEFINITIONS, READ_ONLY_TOOLS, executeTool };
