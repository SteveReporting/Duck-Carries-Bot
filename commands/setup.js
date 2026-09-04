const {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { saveGuildConfig } = require("../platform/guildConfig");
const { activateAfterSetup } = require("../platform/guildRuntime");

const NAMES = Object.freeze({
  category: "🍺 CARRY OPERATIONS",
  queue: "carry-queue",
  completed: "carry-completed",
  logs: "tavern-logs",
  operations: "tavern-ops",
  waiting: "Waiting for Carrier",
  carrierRole: "🍺 Carrier",
  staffRole: "🛡️ Tavern Staff",
});

function findRole(guild, name) {
  return guild.roles.cache.find((role) => role.name === name) || null;
}

function findChannel(guild, type, name) {
  return guild.channels.cache.find((channel) => channel.type === type && channel.name === name) || null;
}

async function ensureRole(guild, provided, name, reason) {
  if (provided) return { value: provided, created: false };
  const existing = findRole(guild, name);
  if (existing) return { value: existing, created: false };
  const role = await guild.roles.create({ name, reason });
  return { value: role, created: true };
}

async function ensureCategory(guild) {
  const existing = findChannel(guild, ChannelType.GuildCategory, NAMES.category);
  if (existing) return { value: existing, created: false };
  const category = await guild.channels.create({
    name: NAMES.category,
    type: ChannelType.GuildCategory,
    reason: "The Carry Tavern /setup",
  });
  return { value: category, created: true };
}

async function ensureTextChannel(guild, provided, name, parentId, permissionOverwrites = undefined) {
  if (provided) return { value: provided, created: false };
  const existing = findChannel(guild, ChannelType.GuildText, name);
  if (existing) return { value: existing, created: false };
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    permissionOverwrites,
    reason: "The Carry Tavern /setup",
  });
  return { value: channel, created: true };
}

async function ensureWaitingVoice(guild, parentId) {
  const existing = findChannel(guild, ChannelType.GuildVoice, NAMES.waiting);
  if (existing) return { value: existing, created: false };
  const channel = await guild.channels.create({
    name: NAMES.waiting,
    type: ChannelType.GuildVoice,
    parent: parentId || undefined,
    reason: "The Carry Tavern /setup",
  });
  return { value: channel, created: true };
}

function privateStaffOverwrites(guild, staffRoleId, botId) {
  return [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
}

function creationLabel(result, mention) {
  return `${result.created ? "🆕" : "✅"} ${mention}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Install or repair The Carry Tavern in this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((option) =>
      option
        .setName("queue")
        .setDescription("Existing carry queue channel (optional; one is created if omitted)")
        .addChannelTypes(ChannelType.GuildText),
    )
    .addChannelOption((option) =>
      option
        .setName("completed")
        .setDescription("Existing completed-carries channel (optional)")
        .addChannelTypes(ChannelType.GuildText),
    )
    .addRoleOption((option) =>
      option
        .setName("carrier_role")
        .setDescription("Existing Carrier role (optional; one is created if omitted)"),
    )
    .addRoleOption((option) =>
      option
        .setName("staff_role")
        .setDescription("Existing staff role (optional; one is created if omitted)"),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ `/setup` must be used inside a server.", flags: MessageFlags.Ephemeral });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "❌ You need **Manage Server** to run `/setup`.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me) return interaction.editReply("❌ I could not resolve my server permissions.");

    const required = [
      [PermissionFlagsBits.ManageChannels, "Manage Channels"],
      [PermissionFlagsBits.ManageRoles, "Manage Roles"],
      [PermissionFlagsBits.ViewChannel, "View Channels"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
    ];
    const missing = required.filter(([permission]) => !me.permissions.has(permission)).map(([, label]) => label);
    if (missing.length) {
      return interaction.editReply(`❌ I need these permissions before setup can finish: **${missing.join(", ")}**.`);
    }

    const providedQueue = interaction.options.getChannel("queue");
    const providedCompleted = interaction.options.getChannel("completed");
    const providedCarrierRole = interaction.options.getRole("carrier_role");
    const providedStaffRole = interaction.options.getRole("staff_role");

    try {
      const carrierRole = await ensureRole(guild, providedCarrierRole, NAMES.carrierRole, "The Carry Tavern carrier role");
      const staffRole = await ensureRole(guild, providedStaffRole, NAMES.staffRole, "The Carry Tavern staff role");
      const category = await ensureCategory(guild);

      const queue = await ensureTextChannel(guild, providedQueue, NAMES.queue, category.value.id);
      const completed = await ensureTextChannel(guild, providedCompleted, NAMES.completed, category.value.id);
      const staffOverwrites = privateStaffOverwrites(guild, staffRole.value.id, interaction.client.user.id);
      const logs = await ensureTextChannel(guild, null, NAMES.logs, category.value.id, staffOverwrites);
      const operations = await ensureTextChannel(guild, null, NAMES.operations, category.value.id, staffOverwrites);
      const waiting = await ensureWaitingVoice(guild, category.value.id);

      const config = saveGuildConfig(guild.id, {
        guild_name: guild.name,
        setup_complete: 1,
        setup_by: interaction.user.id,
        setup_at: Date.now(),
        enabled: 1,
        queue_channel_id: queue.value.id,
        completed_channel_id: completed.value.id,
        ticket_category_id: category.value.id,
        waiting_voice_id: waiting.value.id,
        carrier_role_id: carrierRole.value.id,
        staff_role_id: staffRole.value.id,
        mod_log_channel_id: logs.value.id,
        operations_channel_id: operations.value.id,
      });

      await activateAfterSetup(interaction.client, guild.id).catch((error) => {
        console.warn(`[SETUP] Core setup saved but background activation failed: ${error.message}`);
      });

      const createdCount = [carrierRole, staffRole, category, queue, completed, logs, operations, waiting]
        .filter((entry) => entry.created).length;

      const embed = new EmbedBuilder()
        .setTitle("🍺 Tavern installation complete")
        .setDescription([
          `**${guild.name}** is now an independent Tavern guild.`,
          "This server no longer depends on the original Carry Tavern guild ID.",
          "",
          creationLabel(queue, `<#${config.queue_channel_id}> • carry queue`),
          creationLabel(completed, `<#${config.completed_channel_id}> • completed carries`),
          creationLabel(logs, `<#${config.mod_log_channel_id}> • staff logs`),
          creationLabel(operations, `<#${config.operations_channel_id}> • operations`),
          creationLabel(waiting, `<#${config.waiting_voice_id}> • waiting voice`),
          creationLabel(carrierRole, `<@&${config.carrier_role_id}> • Carrier`),
          creationLabel(staffRole, `<@&${config.staff_role_id}> • staff`),
          "",
          `**${createdCount}** resource${createdCount === 1 ? "" : "s"} created; existing resources were reused where possible.`,
          "Members can now use the Tavern command surface in this server.",
        ].join("\n"))
        .setFooter({ text: `Guild ${guild.id} • re-run /setup any time to repair configuration` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[SETUP]", error);
      return interaction.editReply(`❌ Setup stopped safely: ${error.message || "unknown error"}`);
    }
  },
};
