const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const PUBLIC_SUPPORT_CATEGORY = "🛟・SUPPORT";
const PUBLIC_TICKET_CHANNEL = "🎫・tickets";
const PRIVATE_TICKET_CATEGORY = "🎟️・TAVERN SUPPORT TICKETS";
const DASHBOARD_CHANNEL = "📊・ticket-dashboard";
const OLD_PRIVATE_CATEGORY_NAMES = new Set(["supporttickets"]);
const OLD_TICKET_BOT_ID = "1325579039888511056";
const TOPIC_MARKER = "TAVERN_SUPPORT_TICKET";
const PANEL_FOOTER = "The Carry Tavern • Support Tickets";
const DASHBOARD_FOOTER = "The Carry Tavern • Support Ticket Dashboard";
const GOLD = 0xF2B705;
const BLUE = 0x3498DB;
const GREEN = 0x2ECC71;
const PURPLE = 0x9B59B6;
const RED = 0xE74C3C;

const creatingUsers = new Set();

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isTicketChannelName(value) {
  return /^ticket\d+$/.test(normalize(value));
}

function isStaffMember(member) {
  if (!member) return false;
  if (member.guild?.ownerId === member.id) return true;
  return member.permissions?.has(PermissionFlagsBits.Administrator)
    || member.permissions?.has(PermissionFlagsBits.ManageGuild)
    || member.permissions?.has(PermissionFlagsBits.ManageChannels)
    || member.roles?.cache?.has(process.env.PLATFORM_DISCORD_ROLE_MODERATOR)
    || member.roles?.cache?.has(process.env.PLATFORM_DISCORD_ROLE_ADMINISTRATOR)
    || member.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID);
}

function roleIdsForStaff(guild) {
  const explicit = [
    process.env.PLATFORM_DISCORD_ROLE_MODERATOR,
    process.env.PLATFORM_DISCORD_ROLE_ADMINISTRATOR,
    process.env.AI_MANAGER_ROLE_ID,
  ].filter(Boolean);

  const ids = new Set(explicit.filter((id) => guild.roles.cache.has(id)));

  for (const role of guild.roles.cache.values()) {
    if (role.managed || role.id === guild.roles.everyone.id) continue;
    if (
      role.permissions.has(PermissionFlagsBits.Administrator)
      || role.permissions.has(PermissionFlagsBits.ManageGuild)
      || role.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      ids.add(role.id);
    }
  }

  return [...ids];
}

function categoryOverwrites(guild, botId) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  for (const roleId of roleIdsForStaff(guild)) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }

  return overwrites;
}

function parseTicketTopic(channel) {
  const topic = String(channel?.topic || "");
  if (!topic.includes(TOPIC_MARKER)) return null;

  const requesterId = topic.match(/requester=(\d+)/)?.[1] || null;
  const status = topic.match(/status=([a-z]+)/i)?.[1]?.toLowerCase() || "open";
  const claimedBy = topic.match(/claimed=(\d+)/)?.[1] || null;
  const createdAt = topic.match(/created=(\d+)/)?.[1] || null;
  const legacy = topic.includes("legacy=1");
  return { requesterId, status, claimedBy, createdAt, legacy };
}

function buildTopic({ requesterId, status = "open", claimedBy = null, createdAt = Date.now(), legacy = false }) {
  return [
    TOPIC_MARKER,
    `requester=${requesterId || "unknown"}`,
    `status=${status}`,
    `claimed=${claimedBy || "none"}`,
    `created=${createdAt}`,
    legacy ? "legacy=1" : "legacy=0",
  ].join(" | ").slice(0, 1024);
}

function ticketButtons(status = "open") {
  const claimed = status === "claimed";
  const waiting = status === "waiting";
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("support_ticket_claim")
        .setLabel(claimed ? "Claimed" : "Claim Ticket")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("support_ticket_wait")
        .setLabel(waiting ? "Waiting on User" : "Wait on User")
        .setEmoji("⏳")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("support_ticket_close")
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function supportPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(GOLD)
        .setAuthor({ name: "THE CARRY TAVERN • SUPPORT" })
        .setTitle("🎫 Need help? Open a Support Ticket")
        .setDescription([
          "Use the button below to open a private ticket with the Tavern staff team.",
          "",
          "Please explain the issue clearly and include any useful screenshots or details once the ticket opens.",
          "",
          "**One active Support ticket per person.**",
        ].join("\n"))
        .setFooter({ text: PANEL_FOOTER })
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("support_ticket_open")
          .setLabel("Open a Ticket")
          .setEmoji("📩")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

function ticketPanelPayload(channel, meta, issue = null, details = null) {
  const statusLabels = {
    open: "🟢 Open",
    claimed: "🔵 In Progress",
    waiting: "🟣 Waiting on Requester",
    closed: "⚫ Closed",
  };
  const colour = meta.status === "waiting" ? PURPLE : meta.status === "claimed" ? BLUE : GREEN;

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colour)
        .setAuthor({ name: "THE CARRY TAVERN • SUPPORT CASE" })
        .setTitle(`🎫 ${channel.name.toUpperCase()}`)
        .setDescription("Private Support ticket. Use the controls below to manage this case.")
        .addFields(
          { name: "👤 Requester", value: meta.requesterId && meta.requesterId !== "unknown" ? `<@${meta.requesterId}>` : "Unknown / legacy ticket", inline: true },
          { name: "📌 Status", value: statusLabels[meta.status] || meta.status, inline: true },
          { name: "🙋 Assigned", value: meta.claimedBy && meta.claimedBy !== "none" ? `<@${meta.claimedBy}>` : "Unassigned", inline: true },
          ...(issue ? [{ name: "🗂️ Issue", value: String(issue).slice(0, 1024), inline: false }] : []),
          ...(details ? [{ name: "📝 Details", value: String(details).slice(0, 1024), inline: false }] : []),
        )
        .setFooter({ text: PANEL_FOOTER })
        .setTimestamp(),
    ],
    components: ticketButtons(meta.status),
  };
}

function findExistingPublicPanel(messages, botId) {
  return messages.find((message) =>
    message.author?.id === botId
    && message.embeds?.some((embed) => String(embed.footer?.text || "").includes(PANEL_FOOTER)),
  );
}

function ticketChannels(category) {
  return category.guild.channels.cache.filter((channel) =>
    channel.parentId === category.id
    && channel.type === ChannelType.GuildText
    && channel.name !== DASHBOARD_CHANNEL,
  );
}

function dashboardPayload(category) {
  const channels = [...ticketChannels(category).values()];
  const records = channels.map((channel) => ({ channel, meta: parseTicketTopic(channel) }));
  const active = records.filter(({ meta }) => meta?.status !== "closed");
  const claimed = active.filter(({ meta }) => meta?.status === "claimed");
  const waiting = active.filter(({ meta }) => meta?.status === "waiting");
  const unassigned = active.filter(({ meta }) => !meta?.claimedBy || meta.claimedBy === "none");

  const recent = active
    .sort((a, b) => Number(b.meta?.createdAt || 0) - Number(a.meta?.createdAt || 0))
    .slice(0, 12)
    .map(({ channel, meta }) => {
      const status = meta?.status === "waiting" ? "🟣" : meta?.status === "claimed" ? "🔵" : "🟢";
      const owner = meta?.requesterId && meta.requesterId !== "unknown" ? `<@${meta.requesterId}>` : "legacy";
      const claim = meta?.claimedBy && meta.claimedBy !== "none" ? ` • <@${meta.claimedBy}>` : "";
      return `${status} <#${channel.id}> • ${owner}${claim}`;
    });

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(GOLD)
        .setAuthor({ name: "THE CARRY TAVERN • STAFF OPERATIONS" })
        .setTitle("📊 SUPPORT TICKET DASHBOARD")
        .setDescription("Live workload for the Tavern's built-in Support ticket system.")
        .addFields(
          { name: "📥 Active", value: `**${active.length}**`, inline: true },
          { name: "🙋 Claimed", value: `**${claimed.length}**`, inline: true },
          { name: "👤 Unassigned", value: `**${unassigned.length}**`, inline: true },
          { name: "🟣 Waiting User", value: `**${waiting.length}**`, inline: true },
          { name: "🎟️ Ticket Category", value: `<#${category.id}>`, inline: true },
          { name: "⚙️ System", value: "**ONLINE**", inline: true },
          { name: "Recent active tickets", value: recent.length ? recent.join("\n") : "No active Support tickets.", inline: false },
        )
        .setFooter({ text: DASHBOARD_FOOTER })
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("support_ticket_dashboard_refresh")
          .setLabel("Refresh Dashboard")
          .setEmoji("🔄")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function ensureCategory(guild, botId) {
  let category = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && channel.name === PRIVATE_TICKET_CATEGORY,
  );

  if (!category) {
    category = await guild.channels.create({
      name: PRIVATE_TICKET_CATEGORY,
      type: ChannelType.GuildCategory,
      permissionOverwrites: categoryOverwrites(guild, botId),
      reason: "The Carry Tavern built-in Support ticket system",
    });
  } else {
    // Keep the category private while ensuring current staff roles and this bot retain access.
    for (const overwrite of categoryOverwrites(guild, botId)) {
      await category.permissionOverwrites.edit(overwrite.id, {
        ViewChannel: overwrite.deny ? false : true,
        ...(overwrite.deny ? {} : {
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true,
        }),
      }, { reason: "Refresh Tavern Support ticket permissions" }).catch(() => {});
    }
  }

  return category;
}

async function ensurePublicTicketChannel(guild, botId) {
  let publicCategory = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(PUBLIC_SUPPORT_CATEGORY),
  );
  if (!publicCategory) {
    publicCategory = guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildCategory && normalize(channel.name) === "support",
    );
  }
  if (!publicCategory) {
    publicCategory = await guild.channels.create({
      name: PUBLIC_SUPPORT_CATEGORY,
      type: ChannelType.GuildCategory,
      reason: "The Carry Tavern Support panel",
    });
  }

  let channel = guild.channels.cache.find((item) =>
    item.type === ChannelType.GuildText
    && item.parentId === publicCategory.id
    && normalize(item.name) === "tickets",
  );

  if (!channel) {
    channel = await guild.channels.create({
      name: PUBLIC_TICKET_CHANNEL,
      type: ChannelType.GuildText,
      parent: publicCategory.id,
      topic: "Open a private Support ticket with The Carry Tavern staff team.",
      reason: "The Carry Tavern built-in Support ticket panel",
    });
  }

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages) {
    // Remove the dead external Tickets v2 panel now that the Tavern bot owns Support tickets.
    for (const message of messages.values()) {
      const externalPanel = message.author?.id === OLD_TICKET_BOT_ID
        || message.embeds?.some((embed) => String(embed.footer?.text || "").toLowerCase().includes("tickets.bot"));
      if (externalPanel) await message.delete().catch(() => {});
    }

    const current = findExistingPublicPanel(messages, botId);
    if (current) {
      await current.edit(supportPanelPayload()).catch(() => {});
      await current.pin("Permanent Tavern Support ticket panel").catch(() => {});
      return channel;
    }
  }

  const panel = await channel.send(supportPanelPayload());
  await panel.pin("Permanent Tavern Support ticket panel").catch(() => {});
  return channel;
}

function inferLegacyRequester(channel, botId) {
  const candidates = channel.permissionOverwrites.cache.filter((overwrite) =>
    overwrite.type === 1
    && overwrite.id !== botId
    && overwrite.id !== channel.guild.ownerId,
  );
  return candidates.first()?.id || null;
}

async function migrateOldTicketCategory(guild, newCategory, botId) {
  const oldCategories = guild.channels.cache.filter((channel) =>
    channel.type === ChannelType.GuildCategory
    && OLD_PRIVATE_CATEGORY_NAMES.has(normalize(channel.name))
    && channel.id !== newCategory.id,
  );

  let moved = 0;
  let removedCategories = 0;

  for (const oldCategory of oldCategories.values()) {
    const children = [...guild.channels.cache.filter((channel) => channel.parentId === oldCategory.id).values()];
    for (const child of children) {
      if (child.type !== ChannelType.GuildText) continue;
      await child.setParent(newCategory.id, { lockPermissions: false, reason: "Migrate old Tickets v2 Support channel" }).catch(() => null);
      moved += 1;

      if (isTicketChannelName(child.name) && !parseTicketTopic(child)) {
        const requesterId = inferLegacyRequester(child, botId);
        const meta = {
          requesterId: requesterId || "unknown",
          status: "open",
          claimedBy: null,
          createdAt: child.createdTimestamp || Date.now(),
          legacy: true,
        };
        await child.setTopic(buildTopic(meta), "Adopt legacy Support ticket into Tavern ticket system").catch(() => {});
        await child.send(ticketPanelPayload(child, meta)).catch(() => {});
      }
    }

    const remaining = guild.channels.cache.filter((channel) => channel.parentId === oldCategory.id);
    if (!remaining.size) {
      await oldCategory.delete("Old Tickets v2 Support category replaced by Tavern Support tickets").catch(() => {});
      removedCategories += 1;
    }
  }

  return { moved, removedCategories };
}

async function ensureDashboard(category, botId) {
  let dashboard = category.guild.channels.cache.find((channel) =>
    channel.parentId === category.id
    && channel.type === ChannelType.GuildText
    && channel.name === DASHBOARD_CHANNEL,
  );

  if (!dashboard) {
    dashboard = await category.guild.channels.create({
      name: DASHBOARD_CHANNEL,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: "Staff-only live dashboard for Tavern Support tickets.",
      reason: "The Carry Tavern Support ticket dashboard",
    });
  }

  const messages = await dashboard.messages.fetch({ limit: 25 }).catch(() => null);
  const existing = messages?.find((message) =>
    message.author?.id === botId
    && message.embeds?.some((embed) => String(embed.footer?.text || "").includes(DASHBOARD_FOOTER)),
  );

  if (existing) {
    await existing.edit(dashboardPayload(category));
    await existing.pin("Permanent Support ticket dashboard").catch(() => {});
  } else {
    const message = await dashboard.send(dashboardPayload(category));
    await message.pin("Permanent Support ticket dashboard").catch(() => {});
  }

  return dashboard;
}

async function refreshDashboard(guild) {
  const category = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && channel.name === PRIVATE_TICKET_CATEGORY,
  );
  if (!category) return false;
  const dashboard = guild.channels.cache.find((channel) =>
    channel.parentId === category.id && channel.name === DASHBOARD_CHANNEL,
  );
  if (!dashboard) return false;

  const messages = await dashboard.messages.fetch({ limit: 25 }).catch(() => null);
  const current = messages?.find((message) =>
    message.author?.id === guild.client.user.id
    && message.embeds?.some((embed) => String(embed.footer?.text || "").includes(DASHBOARD_FOOTER)),
  );
  if (current) await current.edit(dashboardPayload(category)).catch(() => {});
  else await dashboard.send(dashboardPayload(category)).catch(() => {});
  return true;
}

function nextTicketNumber(guild) {
  let max = 0;
  for (const channel of guild.channels.cache.values()) {
    const match = normalize(channel.name).match(/^ticket(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return max + 1;
}

function activeTicketForUser(category, userId) {
  return [...ticketChannels(category).values()].find((channel) => {
    const meta = parseTicketTopic(channel);
    return meta?.requesterId === String(userId) && meta.status !== "closed";
  }) || null;
}

function createTicketModal() {
  return new ModalBuilder()
    .setCustomId("support_ticket_create_modal")
    .setTitle("Open a Support Ticket")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("issue")
          .setLabel("What do you need help with?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Explain the issue")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
}

async function createSupportTicket(interaction) {
  const guild = interaction.guild;
  const category = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && channel.name === PRIVATE_TICKET_CATEGORY,
  );
  if (!category) throw new Error("Support ticket category is not ready yet. Try again in a moment.");

  const existing = activeTicketForUser(category, interaction.user.id);
  if (existing) {
    return interaction.reply({
      content: `You already have an active Support ticket: <#${existing.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (creatingUsers.has(interaction.user.id)) {
    return interaction.reply({ content: "Your ticket is already being created.", flags: MessageFlags.Ephemeral });
  }
  creatingUsers.add(interaction.user.id);

  try {
    const issue = interaction.fields.getTextInputValue("issue").trim();
    const details = interaction.fields.getTextInputValue("details").trim();
    const number = nextTicketNumber(guild);
    const name = `ticket-${number}`;
    const meta = {
      requesterId: interaction.user.id,
      status: "open",
      claimedBy: null,
      createdAt: Date.now(),
      legacy: false,
    };

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: buildTopic(meta),
      reason: `Support ticket opened by ${interaction.user.tag}`,
    });

    await channel.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    }, { reason: "Support ticket requester access" });

    await channel.send({
      content: `<@${interaction.user.id}>`,
      ...ticketPanelPayload(channel, meta, issue, details),
      allowedMentions: { users: [interaction.user.id] },
    });

    await refreshDashboard(guild);
    return interaction.reply({ content: `✅ Your Support ticket is ready: <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  } finally {
    creatingUsers.delete(interaction.user.id);
  }
}

async function updateTicketState(channel, patch) {
  const current = parseTicketTopic(channel) || {
    requesterId: inferLegacyRequester(channel, channel.guild.client.user.id) || "unknown",
    status: "open",
    claimedBy: null,
    createdAt: channel.createdTimestamp || Date.now(),
    legacy: true,
  };
  const next = { ...current, ...patch };
  await channel.setTopic(buildTopic(next), "Update Tavern Support ticket state");
  return next;
}

async function handleTicketControl(interaction) {
  if (!interaction.inGuild() || !interaction.channel || !isTicketChannelName(interaction.channel.name)) return false;
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel);
  const staff = isStaffMember(interaction.member);
  const requester = meta?.requesterId === interaction.user.id;

  if (interaction.customId === "support_ticket_claim") {
    if (!staff) {
      await interaction.reply({ content: "Only staff can claim Support tickets.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const next = await updateTicketState(channel, { status: "claimed", claimedBy: interaction.user.id });
    await interaction.reply({ content: `🙋 Ticket claimed by <@${interaction.user.id}>.`, allowedMentions: { users: [interaction.user.id] } });
    await channel.send({ embeds: [new EmbedBuilder().setColor(BLUE).setDescription(`**Assigned:** <@${interaction.user.id}>`).setTimestamp()] }).catch(() => {});
    await refreshDashboard(interaction.guild);
    return true;
  }

  if (interaction.customId === "support_ticket_wait") {
    if (!staff) {
      await interaction.reply({ content: "Only staff can change ticket status.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await updateTicketState(channel, { status: "waiting", claimedBy: meta?.claimedBy && meta.claimedBy !== "none" ? meta.claimedBy : interaction.user.id });
    await interaction.reply("⏳ Ticket marked as **Waiting on Requester**.");
    await refreshDashboard(interaction.guild);
    return true;
  }

  if (interaction.customId === "support_ticket_close") {
    if (!staff && !requester) {
      await interaction.reply({ content: "Only the requester or staff can close this ticket.", flags: MessageFlags.Ephemeral });
      return true;
    }

    await updateTicketState(channel, { status: "closed" }).catch(() => {});
    await interaction.reply(`🔒 Ticket closed by <@${interaction.user.id}>. Deleting this channel in **5 seconds**.`);
    await refreshDashboard(interaction.guild);
    const timer = setTimeout(() => {
      channel.delete(`Support ticket closed by ${interaction.user.tag}`).catch((error) => {
        console.warn(`[SUPPORT TICKETS] Could not delete #${channel.name}: ${error.message}`);
      });
    }, 5_000);
    timer.unref?.();
    return true;
  }

  return false;
}

async function handleSupportTicketInteraction(interaction) {
  if (!interaction.inGuild()) return false;

  if (interaction.isButton?.() && interaction.customId === "support_ticket_open") {
    const category = interaction.guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildCategory && channel.name === PRIVATE_TICKET_CATEGORY,
    );
    const existing = category ? activeTicketForUser(category, interaction.user.id) : null;
    if (existing) {
      await interaction.reply({ content: `You already have an active Support ticket: <#${existing.id}>`, flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(createTicketModal());
    return true;
  }

  if (interaction.isModalSubmit?.() && interaction.customId === "support_ticket_create_modal") {
    await createSupportTicket(interaction);
    return true;
  }

  if (interaction.isButton?.() && interaction.customId === "support_ticket_dashboard_refresh") {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({ content: "Staff access required.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await refreshDashboard(interaction.guild);
    await interaction.reply({ content: "✅ Dashboard refreshed.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isButton?.() && ["support_ticket_claim", "support_ticket_wait", "support_ticket_close"].includes(interaction.customId)) {
    return handleTicketControl(interaction);
  }

  return false;
}

async function ensureSupportTicketSystem(client) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) throw new Error("GUILD_ID is not configured.");
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const botId = client.user.id;
  const category = await ensureCategory(guild, botId);
  const migration = await migrateOldTicketCategory(guild, category, botId);
  const publicChannel = await ensurePublicTicketChannel(guild, botId);
  const dashboard = await ensureDashboard(category, botId);
  await refreshDashboard(guild);

  console.log(
    `✅ [SUPPORT TICKETS] Built-in system ready: panel #${publicChannel.name}, category ${category.name}, dashboard #${dashboard.name}, migrated ${migration.moved} old channel(s), removed ${migration.removedCategories} old category(s).`,
  );

  return { category, publicChannel, dashboard, ...migration };
}

module.exports = {
  PRIVATE_TICKET_CATEGORY,
  ensureSupportTicketSystem,
  handleSupportTicketInteraction,
  refreshDashboard,
};
