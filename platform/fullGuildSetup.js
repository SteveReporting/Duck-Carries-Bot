const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const { installGuild, BRAND } = require("./guildInstaller");
const { finalizeGuildSetup } = require("./setupFinalizer");
const { ensureFullGuildRoles, serialiseRoleMap } = require("./fullGuildRoles");
const { getGuildConfig, saveGuildConfig } = require("./guildConfig");
const { ensureLiveCarryBoard } = require("./liveCarryBoard");
const { publishOperationsHub } = require("../commands/panel");
const { startSecurity } = require("../security/runtime");

const NAMES = Object.freeze({
  carriesCategory: "⚔️・CARRIES",
  request: "⚔️・request-carry",
  queue: "📡・live-queue",
  completed: "✅・carry-completed",
  carrierCategory: "🍻・CARRIER TEAM",
  carrierDesk: "🍻・carrier-desk",
  carrierLeaderboard: "🏆・carrier-leaderboard",
});

const REQUEST_FOOTER = "The Carry Tavern • Request Carry";
const CARRIER_DESK_FOOTER = "The Carry Tavern • Carrier Desk";
const LEADERBOARD_FOOTER = "The Carry Tavern • Carrier Leaderboard";

const PERMISSION_KEYS = Object.freeze([
  ["ViewChannel", PermissionFlagsBits.ViewChannel],
  ["SendMessages", PermissionFlagsBits.SendMessages],
  ["ReadMessageHistory", PermissionFlagsBits.ReadMessageHistory],
  ["EmbedLinks", PermissionFlagsBits.EmbedLinks],
  ["AttachFiles", PermissionFlagsBits.AttachFiles],
  ["ManageMessages", PermissionFlagsBits.ManageMessages],
  ["ManageChannels", PermissionFlagsBits.ManageChannels],
  ["Connect", PermissionFlagsBits.Connect],
  ["Speak", PermissionFlagsBits.Speak],
  ["MoveMembers", PermissionFlagsBits.MoveMembers],
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function overwritePermissionMap(overwrite) {
  const permissions = {};
  const allowed = new Set(overwrite?.allow || []);
  const denied = new Set(overwrite?.deny || []);
  for (const [name, flag] of PERMISSION_KEYS) {
    if (allowed.has(flag)) permissions[name] = true;
    if (denied.has(flag)) permissions[name] = false;
  }
  return permissions;
}

function remember(resources, kind, value, created = false) {
  if (!value?.id) return value;
  if (!resources.some((item) => item.id === value.id)) {
    resources.push({ kind, name: value.name, id: value.id, created });
  }
  return value;
}

async function ensureCategory(guild, name) {
  let category = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(name),
  ) || null;
  let created = false;
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      reason: "Complete /setup server structure",
    });
    created = true;
  }
  return { value: category, created };
}

function publicReadOnlyOverwrites(guild, botId) {
  return [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
}

function privateRoleOverwrites(guild, botId, roleIds) {
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
  ];
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...[...new Set(roleIds)].map((id) => ({ id, allow })),
    {
      id: botId,
      allow: [
        ...allow,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
}

async function ensureTextChannel(guild, name, parentId, overwrites, topic) {
  let channel = guild.channels.cache.find((item) =>
    item.type === ChannelType.GuildText
    && item.parentId === parentId
    && normalize(item.name) === normalize(name),
  ) || null;
  let created = false;

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentId,
      topic,
      permissionOverwrites: overwrites,
      reason: "Complete /setup server structure",
    });
    created = true;
  } else {
    if (channel.name !== name) await channel.setName(name, "Repair /setup channel name").catch(() => {});
    if (topic && channel.topic !== topic) await channel.setTopic(topic, "Repair /setup channel topic").catch(() => {});
  }

  for (const overwrite of overwrites || []) {
    await channel.permissionOverwrites.edit(
      overwrite.id,
      overwritePermissionMap(overwrite),
      { reason: "Repair /setup channel permissions" },
    ).catch(() => {});
  }

  return { value: channel, created };
}

async function publishOrRefresh(channel, footer, payload, reason) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const current = recent?.find((message) =>
    message.author?.id === channel.client.user.id
    && message.embeds?.some((embed) => String(embed.footer?.text || "") === footer),
  ) || null;

  if (current) {
    await current.edit(payload);
    if (!current.pinned) await current.pin(reason).catch(() => {});
    return current;
  }
  const message = await channel.send(payload);
  await message.pin(reason).catch(() => {});
  return message;
}

async function publishRequestPanel(channel) {
  const guild = channel.guild;
  return publishOrRefresh(channel, REQUEST_FOOTER, {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND.gold)
        .setAuthor({
          name: `${guild.name} • CARRY REQUESTS`.toUpperCase(),
          ...(guild.iconURL() ? { iconURL: guild.iconURL({ size: 128 }) } : {}),
        })
        .setTitle("⚔️ Request a Carry")
        .setDescription([
          "This channel does **one job**: creating a carry request.",
          "",
          "Press **Request Carry**, choose your dungeon, difficulty and run count, then the bot handles matching, tickets, ready checks and progress automatically.",
          "",
          "Your request is tracked privately after submission — you never need to search the public queue for yourself.",
        ].join("\n"))
        .addFields(
          { name: "1️⃣ Request", value: "Choose dungeon + difficulty + runs", inline: true },
          { name: "2️⃣ Match", value: "Smart Carrier grouping", inline: true },
          { name: "3️⃣ Carry", value: "Private session + verified progress", inline: true },
        )
        .setFooter({ text: REQUEST_FOOTER })
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("carry_request_start_v4")
          .setLabel("Request Carry")
          .setEmoji("⚔️")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("premium_my_carries")
          .setLabel("My Carries")
          .setEmoji("📋")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  }, "Permanent carry request panel");
}

async function publishCarrierDesk(channel) {
  return publishOrRefresh(channel, CARRIER_DESK_FOOTER, {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND.gold)
        .setTitle("🍻 Carrier Desk")
        .setDescription([
          "Carrier tools live here — members do not need to use this channel.",
          "",
          "**Go available → browse compatible queue groups → claim → run the private session.**",
          "The queue browser is paginated and remains readable even with hundreds of active requests.",
        ].join("\n"))
        .setFooter({ text: CARRIER_DESK_FOOTER })
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("premium_carrier_desk")
          .setLabel("Carrier Controls")
          .setEmoji("🍻")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("premium_queue_open")
          .setLabel("Browse Queue")
          .setEmoji("📡")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("premium_my_carries")
          .setLabel("My Active Carries")
          .setEmoji("📋")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  }, "Permanent Carrier Desk");
}

async function publishLeaderboardInfo(channel) {
  return publishOrRefresh(channel, LEADERBOARD_FOOTER, {
    embeds: [
      new EmbedBuilder()
        .setColor(0xf2b705)
        .setTitle("🏆 Carrier Leaderboard")
        .setDescription([
          "Carrier performance is ranked from verified service data rather than manual claims.",
          "",
          "Use `/leaderboard` for the current live rankings. Verified service time, completed sessions and runs are recorded automatically by the carry system.",
        ].join("\n"))
        .setFooter({ text: LEADERBOARD_FOOTER })
        .setTimestamp(),
    ],
  }, "Permanent Carrier Leaderboard information");
}

async function moveAndRepairPublicChannel(channel, name, parentId, guild, botId) {
  if (!channel) return null;
  if (channel.parentId !== parentId) {
    await channel.setParent(parentId, { lockPermissions: false, reason: "Separate Carry system layout" });
  }
  if (channel.name !== name) await channel.setName(name, "Separate Carry system layout").catch(() => {});
  for (const overwrite of publicReadOnlyOverwrites(guild, botId)) {
    await channel.permissionOverwrites.edit(
      overwrite.id,
      overwritePermissionMap(overwrite),
      { reason: "Carry area permissions" },
    ).catch(() => {});
  }
  return channel;
}

async function resolveFromConfig(guild, id, expectedType = null) {
  if (!id) return null;
  const value = guild.channels.cache.get(String(id)) || await guild.channels.fetch(String(id)).catch(() => null);
  if (!value) return null;
  if (expectedType != null && value.type !== expectedType) return null;
  return value;
}

async function resolveRole(guild, id) {
  if (!id) return null;
  return guild.roles.cache.get(String(id)) || await guild.roles.fetch(String(id)).catch(() => null);
}

function fullPermissionCheck(member) {
  const required = [
    [PermissionFlagsBits.ManageChannels, "Manage Channels"],
    [PermissionFlagsBits.ManageRoles, "Manage Roles"],
    [PermissionFlagsBits.ManageMessages, "Manage Messages"],
    [PermissionFlagsBits.ManageWebhooks, "Manage Webhooks"],
    [PermissionFlagsBits.ViewAuditLog, "View Audit Log"],
    [PermissionFlagsBits.KickMembers, "Kick Members"],
    [PermissionFlagsBits.BanMembers, "Ban Members"],
    [PermissionFlagsBits.ModerateMembers, "Timeout Members"],
    [PermissionFlagsBits.MoveMembers, "Move Members"],
    [PermissionFlagsBits.ViewChannel, "View Channels"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  ];
  return required.filter(([permission]) => !member.permissions.has(permission)).map(([, label]) => label);
}

async function repairPrivateCategoryAccess(guild, roleIds) {
  const targets = [
    "🛡️・STAFF",
    "🎟️・TAVERN SUPPORT TICKETS",
  ];
  for (const categoryName of targets) {
    const category = guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(categoryName),
    );
    if (!category) continue;
    for (const roleId of roleIds) {
      await category.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        EmbedLinks: true,
        AttachFiles: true,
      }, { reason: "Full /setup staff access" }).catch(() => {});
    }
  }
}

async function installSecurity(guild, client, trustedRoleIds) {
  const runtime = await startSecurity(client, guild.id);
  for (const roleId of trustedRoleIds) runtime.store.addTrustedRole(roleId);

  await runtime.engine.ensureSecurityChannels(guild);
  const category = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory
    && normalize(channel.name) === normalize(runtime.config.securityCategoryName),
  ) || null;

  const allow = {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    EmbedLinks: true,
  };
  if (category) {
    for (const roleId of trustedRoleIds) {
      await category.permissionOverwrites.edit(roleId, allow, { reason: "Trusted Security role access" }).catch(() => {});
    }
  }

  for (const channelId of runtime.engine.channels.values()) {
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;
    for (const roleId of trustedRoleIds) {
      await channel.permissionOverwrites.edit(roleId, allow, { reason: "Trusted Security role access" }).catch(() => {});
    }
  }

  await runtime.engine.snapshotGuild(guild, "full /setup completed");
  await runtime.engine.updateOverview(guild);
  return { runtime, category };
}

async function installFullGuild({ guild, userId, client, provided = {} }) {
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error("I could not resolve my server permissions.");
  const missing = fullPermissionCheck(me);
  if (missing.length) {
    throw new Error(`Full setup needs these bot permissions first: ${missing.join(", ")}.`);
  }

  const existingConfig = getGuildConfig(guild.id);
  const resolvedProvided = { ...provided };
  if (!resolvedProvided.queue) resolvedProvided.queue = await resolveFromConfig(guild, existingConfig?.queue_channel_id, ChannelType.GuildText);
  if (!resolvedProvided.completed) resolvedProvided.completed = await resolveFromConfig(guild, existingConfig?.completed_channel_id, ChannelType.GuildText);
  if (!resolvedProvided.carrierRole) resolvedProvided.carrierRole = await resolveRole(guild, existingConfig?.carrier_role_id);
  if (!resolvedProvided.staffRole) resolvedProvided.staffRole = await resolveRole(guild, existingConfig?.staff_role_id);

  const core = await installGuild({ guild, userId, client, provided: resolvedProvided });
  let config = core.config;
  const resources = [...core.resources];
  const ui = [...core.ui];
  const warnings = [];

  const fullRoles = await ensureFullGuildRoles(guild, {
    carrierRole: await resolveRole(guild, config.carrier_role_id),
    staffRole: await resolveRole(guild, config.staff_role_id),
  });
  for (const item of fullRoles.resources) remember(resources, item.kind, { id: item.id, name: item.name }, item.created);
  warnings.push(...fullRoles.warnings);

  const staffRole = fullRoles.roles.staff;
  const carrierRole = fullRoles.roles.carrier;
  config = saveGuildConfig(guild.id, {
    staff_role_id: staffRole.id,
    carrier_role_id: carrierRole.id,
    roles_json: serialiseRoleMap(fullRoles.roles),
  });

  const carriesCategoryResult = await ensureCategory(guild, NAMES.carriesCategory);
  const carriesCategory = remember(resources, "category", carriesCategoryResult.value, carriesCategoryResult.created);
  const carrierCategoryResult = await ensureCategory(guild, NAMES.carrierCategory);
  const carrierCategory = remember(resources, "category", carrierCategoryResult.value, carrierCategoryResult.created);

  const requestResult = await ensureTextChannel(
    guild,
    NAMES.request,
    carriesCategory.id,
    publicReadOnlyOverwrites(guild, client.user.id),
    "Create a carry request here. Queue browsing is kept in the separate Live Queue channel.",
  );
  const requestChannel = remember(resources, "channel", requestResult.value, requestResult.created);

  const queueChannel = await resolveFromConfig(guild, config.queue_channel_id, ChannelType.GuildText);
  const completedChannel = await resolveFromConfig(guild, config.completed_channel_id, ChannelType.GuildText);
  await moveAndRepairPublicChannel(queueChannel, NAMES.queue, carriesCategory.id, guild, client.user.id);
  await moveAndRepairPublicChannel(completedChannel, NAMES.completed, carriesCategory.id, guild, client.user.id);

  const carrierDeskResult = await ensureTextChannel(
    guild,
    NAMES.carrierDesk,
    carrierCategory.id,
    privateRoleOverwrites(guild, client.user.id, fullRoles.carrierAccessRoleIds),
    "Private Carrier controls, queue claiming and active sessions.",
  );
  const carrierDesk = remember(resources, "channel", carrierDeskResult.value, carrierDeskResult.created);

  const leaderboardResult = await ensureTextChannel(
    guild,
    NAMES.carrierLeaderboard,
    carrierCategory.id,
    publicReadOnlyOverwrites(guild, client.user.id),
    "Verified Carrier service rankings and performance.",
  );
  const carrierLeaderboard = remember(resources, "channel", leaderboardResult.value, leaderboardResult.created);

  config = saveGuildConfig(guild.id, {
    request_channel_id: requestChannel.id,
    carrier_desk_channel_id: carrierDesk.id,
    carrier_leaderboard_channel_id: carrierLeaderboard.id,
  });

  const attempt = async (name, task) => {
    try {
      const result = await task();
      ui.push({ name, ok: true });
      return result;
    } catch (error) {
      ui.push({ name, ok: false, error: error.message });
      warnings.push(`${name}: ${error.message}`);
      return null;
    }
  };

  await attempt("Dedicated Request Carry panel", () => publishRequestPanel(requestChannel));
  await attempt("Carrier Desk panel", () => publishCarrierDesk(carrierDesk));
  await attempt("Carrier Leaderboard panel", () => publishLeaderboardInfo(carrierLeaderboard));

  const finalized = await finalizeGuildSetup({ guild, client, config });
  config = finalized.config;
  for (const item of finalized.ui) {
    if (!ui.some((current) => current.name === item.name)) ui.push(item);
  }

  await repairPrivateCategoryAccess(guild, fullRoles.staffAccessRoleIds);

  const security = await attempt("Anti-Raid + Anti-Nuke Security", () =>
    installSecurity(guild, client, fullRoles.trustedSecurityRoleIds));
  if (security?.category) {
    remember(resources, "category", security.category, false);
    for (const channelId of security.runtime.engine.channels.values()) {
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (channel) remember(resources, "security", channel, false);
    }
    config = saveGuildConfig(guild.id, { security_category_id: security.category.id });
  }

  const home = await resolveFromConfig(guild, config.home_channel_id, ChannelType.GuildText);
  if (home) await attempt("Simplified Member Hub", () => publishOperationsHub(home, { guild, config }));
  await attempt("Scalable Live Queue", () => ensureLiveCarryBoard(client, guild));

  return {
    config,
    resources,
    ui,
    warnings,
    identity: finalized.identity,
    roleMap: fullRoles.roles,
    createdCount: resources.filter((item) => item.created).length,
    reusedCount: resources.filter((item) => !item.created).length,
  };
}

module.exports = {
  BRAND,
  NAMES,
  fullPermissionCheck,
  installFullGuild,
  overwritePermissionMap,
  publishCarrierDesk,
  publishRequestPanel,
};
