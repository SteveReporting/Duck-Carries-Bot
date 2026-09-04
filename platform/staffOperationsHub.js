const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const STAFF_CATEGORY_NORMALIZED = "staff";
const HUB_CHANNEL_NAME = "📊・operations-hub";
const HUB_FOOTER = "The Carry Tavern • Staff Operations Hub";
const SUPPORT_CATEGORY_NAME = "🎟️・TAVERN SUPPORT TICKETS";
const SUPPORT_DASHBOARD_NAME = "📊・ticket-dashboard";
const GOLD = 0xf2b705;
const BLUE = 0x3498db;

let refreshTimer = null;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function channelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function linkButton(label, channel, emoji) {
  if (!channel) return null;
  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(label)
    .setURL(channelUrl(channel.guild.id, channel.id));
  if (emoji) button.setEmoji(emoji);
  return button;
}

function row(...items) {
  return new ActionRowBuilder().addComponents(...items.filter(Boolean));
}

function isStaff(member) {
  if (!member) return false;
  if (member.guild?.ownerId === member.id) return true;
  return member.permissions?.has(PermissionFlagsBits.Administrator)
    || member.permissions?.has(PermissionFlagsBits.ManageGuild)
    || member.permissions?.has(PermissionFlagsBits.ManageChannels)
    || Boolean(process.env.PLATFORM_DISCORD_ROLE_MODERATOR && member.roles?.cache?.has(process.env.PLATFORM_DISCORD_ROLE_MODERATOR))
    || Boolean(process.env.PLATFORM_DISCORD_ROLE_ADMINISTRATOR && member.roles?.cache?.has(process.env.PLATFORM_DISCORD_ROLE_ADMINISTRATOR))
    || Boolean(process.env.AI_MANAGER_ROLE_ID && member.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID));
}

function findExactCategory(guild, normalizedName) {
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalizedName,
  ) || null;
}

function findTextChannel(guild, predicate) {
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && predicate(channel),
  ) || null;
}

function supportStats(guild) {
  const category = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === SUPPORT_CATEGORY_NAME,
  );

  if (!category) {
    return { active: 0, claimed: 0, waiting: 0, unassigned: 0, category: null, dashboard: null };
  }

  const channels = [...guild.channels.cache.filter((channel) =>
    channel.type === ChannelType.GuildText
    && channel.parentId === category.id
    && channel.name !== SUPPORT_DASHBOARD_NAME,
  ).values()];

  let active = 0;
  let claimed = 0;
  let waiting = 0;
  let unassigned = 0;

  for (const channel of channels) {
    const topic = String(channel.topic || "");
    if (!topic.includes("TAVERN_SUPPORT_TICKET")) continue;
    const status = topic.match(/status=([a-z]+)/i)?.[1]?.toLowerCase() || "open";
    const assigned = topic.match(/claimed=(\d+|none)/i)?.[1] || "none";
    if (status === "closed") continue;
    active += 1;
    if (status === "claimed") claimed += 1;
    if (status === "waiting") waiting += 1;
    if (assigned === "none") unassigned += 1;
  }

  const dashboard = findTextChannel(guild, (channel) =>
    channel.parentId === category.id && channel.name === SUPPORT_DASHBOARD_NAME,
  );

  return { active, claimed, waiting, unassigned, category, dashboard };
}

function systemChannels(guild) {
  const carrierCategory = findExactCategory(guild, "carrierteam");
  const becomeCarrier = carrierCategory
    ? findTextChannel(guild, (channel) => channel.parentId === carrierCategory.id && normalize(channel.name) === "becomeacarrier")
    : null;
  const applicationReviews = carrierCategory
    ? findTextChannel(guild, (channel) => channel.parentId === carrierCategory.id && normalize(channel.name) === "applicationreviews")
    : null;

  const treasuryLogs = findTextChannel(guild, (channel) => normalize(channel.name) === "treasurylogs");
  const treasuryStock = process.env.TREASURY_STOCK_CHANNEL_ID
    ? guild.channels.cache.get(process.env.TREASURY_STOCK_CHANNEL_ID) || null
    : findTextChannel(guild, (channel) => normalize(channel.name).includes("treasurystock"));

  const carryQueue = process.env.CARRY_QUEUE_CHANNEL_ID
    ? guild.channels.cache.get(process.env.CARRY_QUEUE_CHANNEL_ID) || null
    : findTextChannel(guild, (channel) => normalize(channel.name).includes("carryqueue"));

  const modLog = process.env.MOD_LOG_CHANNEL_ID
    ? guild.channels.cache.get(process.env.MOD_LOG_CHANNEL_ID) || null
    : findTextChannel(guild, (channel) => normalize(channel.name).includes("modlog"));

  return {
    carrierCategory,
    becomeCarrier,
    applicationReviews,
    treasuryLogs,
    treasuryStock,
    carryQueue,
    modLog,
  };
}

function workloadSignal(support) {
  if (support.unassigned >= 5) return "🔴 Needs Staff";
  if (support.unassigned > 0 || support.waiting > 0) return "🟠 Attention";
  return "🟢 Clear";
}

function hubPayload(guild) {
  const support = supportStats(guild);
  const systems = systemChannels(guild);

  const hero = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • STAFF COMMAND CENTER" })
    .setTitle("📊 Operations Hub")
    .setDescription([
      "One live command center for the people running the Tavern.",
      "",
      "**Support, Carrier operations, moderation, Treasury and the carry queue are surfaced here without turning staff work into a wall of channels or commands.**",
    ].join("\n"))
    .addFields(
      { name: "📥 Support", value: `**${support.active}** active`, inline: true },
      { name: "👤 Unassigned", value: `**${support.unassigned}**`, inline: true },
      { name: "🟣 Waiting User", value: `**${support.waiting}**`, inline: true },
      { name: "🙋 Claimed", value: `**${support.claimed}**`, inline: true },
      { name: "⚔️ Carrier Ops", value: systems.applicationReviews ? "🟢 Online" : "🟠 Check", inline: true },
      { name: "💰 Treasury", value: systems.treasuryLogs || systems.treasuryStock ? "🟢 Online" : "🟠 Check", inline: true },
      { name: "🛡️ Workload", value: workloadSignal(support), inline: true },
      { name: "⚙️ Automation", value: "🟢 Running", inline: true },
      { name: "🔄 Refresh", value: "Every 60 seconds", inline: true },
    )
    .setFooter({ text: HUB_FOOTER })
    .setTimestamp();

  const deck = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle("🧭 Staff Quick Reference")
    .setDescription([
      "### 🛟 Support",
      "Claim cases from the Support dashboard, mark them **Waiting on User**, then close when resolved.",
      "",
      "### ⚔️ Carrier Department",
      "Use `/carrier-admin` for scope, roles, hierarchy and no-show review. Carrier applications stay in the review console.",
      "",
      "### 🛡️ Moderation & Cases",
      "Use `/warn` for moderation records and `/report` for scam/trade cases. `/security` remains the dedicated anti-raid system.",
      "",
      "### 💰 Treasury",
      "Use `/treasury` for stock and tickets; staff controls stay nested under `/treasury admin`.",
    ].join("\n"));

  const components = [];
  const firstRow = row(
    linkButton("Support", support.dashboard, "🛟"),
    linkButton("Carrier Reviews", systems.applicationReviews, "⚔️"),
    linkButton("Carry Queue", systems.carryQueue, "🍺"),
    linkButton("Mod Log", systems.modLog, "🛡️"),
  );
  if (firstRow.components.length) components.push(firstRow);

  const secondRow = row(
    linkButton("Treasury Logs", systems.treasuryLogs, "💰"),
    linkButton("Treasury Stock", systems.treasuryStock, "📦"),
    new ButtonBuilder()
      .setCustomId("staff_operations_hub_refresh")
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),
  );
  components.push(secondRow);

  return { embeds: [hero, deck], components };
}

async function findOrCreateHubChannel(guild) {
  const staffCategory = findExactCategory(guild, STAFF_CATEGORY_NORMALIZED);
  if (!staffCategory) throw new Error("Could not find the main STAFF category.");

  let channel = findTextChannel(guild, (item) =>
    item.parentId === staffCategory.id && normalize(item.name) === "operationshub",
  );

  if (!channel) {
    channel = await guild.channels.create({
      name: HUB_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: staffCategory.id,
      topic: "Unified staff command center for Support, Carrier, moderation, Treasury and carry operations.",
      reason: "The Carry Tavern unified staff operations hub",
    });
  }

  return channel;
}

async function refreshStaffOperationsHub(guild) {
  const channel = await findOrCreateHubChannel(guild);
  const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const existing = recent?.find((message) =>
    message.author?.id === guild.client.user.id
    && message.embeds?.some((embed) => String(embed.footer?.text || "").includes(HUB_FOOTER)),
  );

  if (existing) {
    await existing.edit(hubPayload(guild));
    if (!existing.pinned) await existing.pin("Permanent Tavern staff operations hub").catch(() => {});
    return { channel, message: existing, created: false };
  }

  const message = await channel.send(hubPayload(guild));
  await message.pin("Permanent Tavern staff operations hub").catch(() => {});
  return { channel, message, created: true };
}

async function startStaffOperationsHub(client) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) throw new Error("GUILD_ID is not configured.");
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  await guild.channels.fetch();

  const result = await refreshStaffOperationsHub(guild);

  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      refreshStaffOperationsHub(guild).catch((error) => {
        console.warn(`[STAFF HUB] Automatic refresh failed: ${error.message}`);
      });
    }, 60_000);
    refreshTimer.unref?.();
  }

  console.log(`✅ [STAFF HUB] Operations hub ready in #${result.channel.name}.`);
  return result;
}

async function handleStaffOperationsHubInteraction(interaction) {
  if (!interaction.inGuild() || !interaction.isButton?.()) return false;
  if (interaction.customId !== "staff_operations_hub_refresh") return false;

  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: "Staff access required.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await refreshStaffOperationsHub(interaction.guild);
  await interaction.editReply("✅ Staff Operations Hub refreshed.");
  return true;
}

module.exports = {
  HUB_CHANNEL_NAME,
  startStaffOperationsHub,
  refreshStaffOperationsHub,
  handleStaffOperationsHubInteraction,
};
