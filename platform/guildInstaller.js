const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const { marketplaceBaseUrl } = require("./helpers");
const { saveGuildConfig } = require("./guildConfig");
const { activateAfterSetup } = require("./guildRuntime");
const { ensureLiveCarryBoard } = require("./liveCarryBoard");
const { ensureSupportTicketSystem } = require("./supportTicketSystem");
const { refreshStaffOperationsHub } = require("./staffOperationsHub");
const { ensureTreasuryStockPanel } = require("./treasuryStock");
const { publishOperationsHub } = require("../commands/panel");

const BRAND = Object.freeze({
  gold: 0xf2b705,
  blue: 0x5865f2,
  green: 0x2ecc71,
  muted: 0x2b2d31,
});

const NAMES = Object.freeze({
  publicCategory: "🍺・TAVERN",
  sessionCategory: "⚔️・CARRY SESSIONS",
  voiceCategory: "🔊・CARRY VOICE",
  staffCategory: "🛡️・STAFF",
  treasuryCategory: "💰・TREASURY",
  home: "🍺・tavern-hub",
  queue: "⚔️・carry-queue",
  completed: "✅・carry-completed",
  marketplace: "💰・marketplace",
  staffHub: "📊・operations-hub",
  logs: "🧾・tavern-logs",
  treasury: "🏦・treasury-stock",
  waiting: "⏳・waiting-for-carry",
  carrierRole: "🍺・Carrier",
  staffRole: "🛡️・Tavern Staff",
});

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function sameGuild(value, guild) {
  return Boolean(value && value.guild?.id === guild.id);
}

function findCategory(guild, name) {
  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(name),
  ) || null;
}

function findChannel(guild, type, name, parentId = null) {
  return guild.channels.cache.find((channel) =>
    channel.type === type
    && normalize(channel.name) === normalize(name)
    && (!parentId || channel.parentId === parentId),
  ) || null;
}

function findRole(guild, name) {
  return guild.roles.cache.find((role) => !role.managed && normalize(role.name) === normalize(name)) || null;
}

function remember(resources, kind, result) {
  resources.push({ kind, name: result.value.name, id: result.value.id, created: result.created });
  return result;
}

async function ensureRole(guild, provided, name, reason) {
  if (provided && sameGuild(provided, guild)) return { value: provided, created: false };
  const existing = findRole(guild, name);
  if (existing) return { value: existing, created: false };
  const role = await guild.roles.create({ name, reason });
  return { value: role, created: true };
}

async function ensureCategory(guild, name, permissionOverwrites = undefined) {
  const existing = findCategory(guild, name);
  if (existing) {
    if (permissionOverwrites) {
      for (const overwrite of permissionOverwrites) {
        await existing.permissionOverwrites.edit(overwrite.id, overwrite.permissions, {
          reason: "Repair Tavern setup permissions",
        }).catch(() => {});
      }
    }
    return { value: existing, created: false };
  }

  const category = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: permissionOverwrites?.map((item) => ({ id: item.id, ...item.raw })) || undefined,
    reason: "The Carry Tavern full server setup",
  });
  return { value: category, created: true };
}

function readOnlyPublicOverwrites(guild, botId) {
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

function staffOverwrites(guild, staffRoleId, botId) {
  const ownerId = guild.ownerId;
  const allowed = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
  ];

  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRoleId, allow: allowed },
    { id: ownerId, allow: [...allowed, PermissionFlagsBits.ManageMessages] },
    {
      id: botId,
      allow: [
        ...allowed,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
}

function categoryPermissionSpecs(overwrites) {
  return overwrites.map((overwrite) => ({
    id: overwrite.id,
    raw: {
      ...(overwrite.allow ? { allow: overwrite.allow } : {}),
      ...(overwrite.deny ? { deny: overwrite.deny } : {}),
    },
    permissions: {
      ...(overwrite.allow?.includes(PermissionFlagsBits.ViewChannel) ? { ViewChannel: true } : {}),
      ...(overwrite.deny?.includes(PermissionFlagsBits.ViewChannel) ? { ViewChannel: false } : {}),
      ...(overwrite.allow?.includes(PermissionFlagsBits.SendMessages) ? { SendMessages: true } : {}),
      ...(overwrite.allow?.includes(PermissionFlagsBits.ReadMessageHistory) ? { ReadMessageHistory: true } : {}),
      ...(overwrite.allow?.includes(PermissionFlagsBits.EmbedLinks) ? { EmbedLinks: true } : {}),
      ...(overwrite.allow?.includes(PermissionFlagsBits.AttachFiles) ? { AttachFiles: true } : {}),
      ...(overwrite.allow?.includes(PermissionFlagsBits.ManageMessages) ? { ManageMessages: true } : {}),
      ...(overwrite.allow?.includes(PermissionFlagsBits.ManageChannels) ? { ManageChannels: true } : {}),
    },
  }));
}

async function ensureTextChannel(guild, provided, name, parentId, overwrites = undefined, topic = undefined) {
  if (provided && sameGuild(provided, guild) && provided.type === ChannelType.GuildText) {
    return { value: provided, created: false };
  }

  const existing = findChannel(guild, ChannelType.GuildText, name, parentId);
  if (existing) {
    if (topic && existing.topic !== topic) await existing.setTopic(topic, "Repair Tavern setup topic").catch(() => {});
    return { value: existing, created: false };
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    topic,
    permissionOverwrites: overwrites,
    reason: "The Carry Tavern full server setup",
  });
  return { value: channel, created: true };
}

async function ensureWaitingVoice(guild, parentId, botId) {
  const existing = findChannel(guild, ChannelType.GuildVoice, NAMES.waiting, parentId)
    || findChannel(guild, ChannelType.GuildVoice, NAMES.waiting);
  if (existing) return { value: existing, created: false };

  const channel = await guild.channels.create({
    name: NAMES.waiting,
    type: ChannelType.GuildVoice,
    parent: parentId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
      },
      {
        id: botId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ],
    reason: "The Carry Tavern optional waiting room",
  });
  return { value: channel, created: true };
}

async function publishOrRefresh(channel, footer, payload, pinReason) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find((message) =>
    message.author?.id === channel.client.user.id
    && message.embeds?.some((embed) => String(embed.footer?.text || "") === footer),
  ) || null;

  if (existing) {
    await existing.edit(payload);
    if (!existing.pinned) await existing.pin(pinReason).catch(() => {});
    return existing;
  }

  const message = await channel.send(payload);
  await message.pin(pinReason).catch(() => {});
  return message;
}

async function publishCompletedCard(channel) {
  const footer = "The Carry Tavern • Completed Carries";
  return publishOrRefresh(channel, footer, {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND.green)
        .setAuthor({ name: "THE CARRY TAVERN" })
        .setTitle("✅ Completed Carries")
        .setDescription("Finished sessions and completion records land here automatically. No manual logging needed.")
        .addFields(
          { name: "Progress", value: "Verified automatically", inline: true },
          { name: "Carrier time", value: "Tracked automatically", inline: true },
          { name: "Cleanup", value: "Handled automatically", inline: true },
        )
        .setFooter({ text: footer }),
    ],
  }, "Permanent completed-carries information card");
}

async function publishMarketplaceCard(channel) {
  const footer = "The Carry Tavern • Marketplace";
  const base = marketplaceBaseUrl();
  const components = [];
  if (base) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Open Marketplace")
        .setEmoji("🛒")
        .setURL(base),
    ));
  }

  return publishOrRefresh(channel, footer, {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND.blue)
        .setAuthor({ name: "THE CARRY TAVERN" })
        .setTitle("💰 Marketplace")
        .setDescription(base
          ? "Browse listings, manage trades and open the full Marketplace from one place."
          : "Use `/marketplace` to browse and manage Marketplace listings in Discord.")
        .setFooter({ text: footer }),
    ],
    components,
  }, "Permanent Tavern Marketplace card");
}

function permissionCheck(member) {
  const required = [
    [PermissionFlagsBits.ManageChannels, "Manage Channels"],
    [PermissionFlagsBits.ManageRoles, "Manage Roles"],
    [PermissionFlagsBits.ViewChannel, "View Channels"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.ManageMessages, "Manage Messages"],
    [PermissionFlagsBits.MoveMembers, "Move Members"],
  ];
  return required.filter(([permission]) => !member.permissions.has(permission)).map(([, name]) => name);
}

async function installGuild({ guild, userId, client, provided = {} }) {
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error("I could not resolve my server permissions.");

  const missing = permissionCheck(me);
  if (missing.length) {
    throw new Error(`I need these permissions before setup can finish: ${missing.join(", ")}.`);
  }

  const resources = [];
  const carrierRole = remember(resources, "role", await ensureRole(
    guild,
    provided.carrierRole,
    NAMES.carrierRole,
    "The Carry Tavern Carrier role",
  ));
  const staffRole = remember(resources, "role", await ensureRole(
    guild,
    provided.staffRole,
    NAMES.staffRole,
    "The Carry Tavern staff role",
  ));

  const publicCategory = remember(resources, "category", await ensureCategory(guild, NAMES.publicCategory));
  const sessionCategory = remember(resources, "category", await ensureCategory(guild, NAMES.sessionCategory));
  const voiceCategory = remember(resources, "category", await ensureCategory(guild, NAMES.voiceCategory));
  const staffCategory = remember(resources, "category", await ensureCategory(
    guild,
    NAMES.staffCategory,
    categoryPermissionSpecs(staffOverwrites(guild, staffRole.value.id, client.user.id)),
  ));
  const treasuryCategory = remember(resources, "category", await ensureCategory(guild, NAMES.treasuryCategory));

  const publicOverwrites = readOnlyPublicOverwrites(guild, client.user.id);
  const staffPermissions = staffOverwrites(guild, staffRole.value.id, client.user.id);

  const home = remember(resources, "channel", await ensureTextChannel(
    guild,
    null,
    NAMES.home,
    publicCategory.value.id,
    publicOverwrites,
    "The main button-first Tavern command center.",
  ));
  const queue = remember(resources, "channel", await ensureTextChannel(
    guild,
    provided.queue,
    NAMES.queue,
    publicCategory.value.id,
    provided.queue ? undefined : publicOverwrites,
    "Live carry queue and Carrier claim board.",
  ));
  const completed = remember(resources, "channel", await ensureTextChannel(
    guild,
    provided.completed,
    NAMES.completed,
    publicCategory.value.id,
    provided.completed ? undefined : publicOverwrites,
    "Automatic completed carry records.",
  ));
  const marketplace = remember(resources, "channel", await ensureTextChannel(
    guild,
    null,
    NAMES.marketplace,
    publicCategory.value.id,
    publicOverwrites,
    "Marketplace access and trading tools.",
  ));
  const treasury = remember(resources, "channel", await ensureTextChannel(
    guild,
    null,
    NAMES.treasury,
    treasuryCategory.value.id,
    publicOverwrites,
    "Live Treasury stock browser.",
  ));
  const staffHub = remember(resources, "channel", await ensureTextChannel(
    guild,
    null,
    NAMES.staffHub,
    staffCategory.value.id,
    staffPermissions,
    "Private staff command center and live operations dashboard.",
  ));
  const logs = remember(resources, "channel", await ensureTextChannel(
    guild,
    null,
    NAMES.logs,
    staffCategory.value.id,
    staffPermissions,
    "Private Tavern moderation, automation and audit logs.",
  ));
  const waiting = remember(resources, "voice", await ensureWaitingVoice(guild, voiceCategory.value.id, client.user.id));

  let config = saveGuildConfig(guild.id, {
    guild_name: guild.name,
    setup_complete: 1,
    setup_by: userId,
    setup_at: Date.now(),
    enabled: 1,
    home_channel_id: home.value.id,
    queue_channel_id: queue.value.id,
    completed_channel_id: completed.value.id,
    ticket_category_id: sessionCategory.value.id,
    voice_category_id: voiceCategory.value.id,
    waiting_voice_id: waiting.value.id,
    carrier_role_id: carrierRole.value.id,
    staff_role_id: staffRole.value.id,
    mod_log_channel_id: logs.value.id,
    operations_channel_id: staffHub.value.id,
    treasury_channel_id: treasury.value.id,
    marketplace_channel_id: marketplace.value.id,
  });

  // First configured guild activates older background workers; every guild still
  // receives the complete persistent UI stack below directly.
  await activateAfterSetup(client, guild.id).catch((error) => {
    console.warn(`[SETUP] Background activation warning for ${guild.id}: ${error.message}`);
  });

  const ui = [];
  const attempt = async (name, task) => {
    try {
      const result = await task();
      ui.push({ name, ok: true });
      return result;
    } catch (error) {
      console.warn(`[SETUP UI] ${name}: ${error.message}`);
      ui.push({ name, ok: false, error: error.message });
      return null;
    }
  };

  await attempt("Tavern Hub", () => publishOperationsHub(home.value, { guild, config }));
  await attempt("Live Carry Board", () => ensureLiveCarryBoard(client, guild));
  await attempt("Completed Carries", () => publishCompletedCard(completed.value));
  await attempt("Marketplace", () => publishMarketplaceCard(marketplace.value));

  const support = await attempt("Support Desk + Dashboard", () => ensureSupportTicketSystem(client, guild));
  if (support) {
    config = saveGuildConfig(guild.id, {
      support_channel_id: support.publicChannel?.id,
      support_dashboard_channel_id: support.dashboard?.id,
    });
  }

  await attempt("Staff Operations Hub", () => refreshStaffOperationsHub(guild));
  await attempt("Treasury Stock", () => ensureTreasuryStockPanel(client, guild, treasury.value));

  return {
    config,
    resources,
    ui,
    createdCount: resources.filter((item) => item.created).length,
    reusedCount: resources.filter((item) => !item.created).length,
  };
}

module.exports = {
  BRAND,
  NAMES,
  installGuild,
  permissionCheck,
  publishCompletedCard,
  publishMarketplaceCard,
};
