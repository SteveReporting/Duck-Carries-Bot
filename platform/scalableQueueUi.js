const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} = require("discord.js");

const {
  groupWaitingRequests,
  loadPlatformQueue,
} = require("./carryQueue");
const {
  countAvailableCarriers,
  estimateQueueMinutes,
  priorityForAge,
} = require("./communitySystems");

const PAGE_SIZE = 8;
const GOLD = 0xf2b705;
const GREEN = 0x2ecc71;
const BLUE = 0x5865f2;
const OVERVIEW_FOOTER = "The Carry Tavern • Queue Overview";
const BROWSER_FOOTER = "The Carry Tavern • Queue Browser";

function remainingRuns(request) {
  return Math.max(0, Number(request.runs_requested || 0) - Number(request.runs_completed || 0));
}

function encodeToken(parts) {
  return Buffer.from(JSON.stringify(parts)).toString("base64url");
}

function relative(value) {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function compactRuns(requests) {
  const values = [...new Set(requests.map(remainingRuns).filter((value) => value > 0))]
    .sort((a, b) => a - b);
  return values.length ? values.join(" / ") : "—";
}

function activeSessionCount(rows) {
  return new Set(
    rows
      .filter((request) => ["claimed", "in_progress"].includes(request.status))
      .map((request) => request.ticket_channel_id || request.id)
      .filter(Boolean),
  ).size;
}

function queueStats(rows) {
  const waiting = rows.filter((request) => request.status === "queued" && remainingRuns(request) > 0);
  const groups = groupWaitingRequests(rows);
  const activeRequests = rows.filter((request) => ["claimed", "in_progress"].includes(request.status));
  return {
    waiting,
    groups,
    activeRequests,
    activeSessions: activeSessionCount(rows),
    oldest: waiting[0]?.created_at || null,
  };
}

function groupLine(guildId, group, index) {
  const priority = priorityForAge(group.oldestAt);
  const available = countAvailableCarriers(guildId, group.dungeon, group.difficulty);
  const eta = estimateQueueMinutes(index + 1, available);
  return [
    `${priority.icon} **${group.dungeon} • ${group.difficulty}**`,
    `👥 ${group.requests.length} waiting • 🏃 ${compactRuns(group.requests)} runs • 🍻 ${available} available`,
    `⏱️ Oldest ${relative(group.oldestAt)}${eta == null ? " • no matching Carrier online" : ` • ~${eta}m estimate`}`,
  ].join("\n");
}

function buildQueueOverviewPayload(guildId, rows, guild = null) {
  const stats = queueStats(rows);
  const embed = new EmbedBuilder()
    .setColor(stats.waiting.length ? GOLD : GREEN)
    .setAuthor({
      name: `${guild?.name || "SERVER"} • CARRY OPERATIONS`.toUpperCase(),
      ...(guild?.iconURL?.() ? { iconURL: guild.iconURL({ size: 128 }) } : {}),
    })
    .setTitle("📡 Live Carry Queue")
    .setDescription([
      stats.waiting.length
        ? "The board stays compact even during huge queues. Use **Browse Queue** for the paginated Carrier view."
        : "The carry queue is currently clear.",
      "",
      "**Requesting is handled separately in the Request Carry channel.** This board is only for queue visibility and Carrier claiming.",
    ].join("\n"))
    .addFields(
      { name: "🟡 Waiting", value: `**${stats.waiting.length.toLocaleString("en-GB")}**`, inline: true },
      { name: "🧩 Match Groups", value: `**${stats.groups.length.toLocaleString("en-GB")}**`, inline: true },
      { name: "🟢 Live Sessions", value: `**${stats.activeSessions.toLocaleString("en-GB")}**`, inline: true },
      { name: "📦 Active Requests", value: `**${stats.activeRequests.length.toLocaleString("en-GB")}**`, inline: true },
      { name: "⏱️ Oldest Wait", value: stats.oldest ? relative(stats.oldest) : "—", inline: true },
      { name: "⚙️ Display", value: "**Paginated**", inline: true },
    )
    .setFooter({ text: OVERVIEW_FOOTER })
    .setTimestamp();

  if (stats.groups.length) {
    embed.addFields({
      name: "🔥 Oldest / highest-priority groups",
      value: stats.groups.slice(0, 5)
        .map((group, index) => groupLine(guildId, group, index))
        .join("\n\n")
        .slice(0, 4000),
      inline: false,
    });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("premium_queue_open")
          .setLabel("Browse Queue")
          .setEmoji("📡")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("premium_my_carries")
          .setLabel("My Carries")
          .setEmoji("📋")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("premium_carrier_desk")
          .setLabel("Carrier Desk")
          .setEmoji("🍻")
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

function buildQueueBrowserPayload(guildId, rows, requestedPage = 0) {
  const stats = queueStats(rows);
  const pageCount = Math.max(1, Math.ceil(stats.groups.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(pageCount - 1, Number(requestedPage) || 0));
  const start = page * PAGE_SIZE;
  const pageGroups = stats.groups.slice(start, start + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(stats.waiting.length ? GOLD : GREEN)
    .setAuthor({ name: "CARRIER QUEUE BROWSER" })
    .setTitle(`⚔️ Queue Groups • Page ${page + 1}/${pageCount}`)
    .setDescription([
      `**${stats.waiting.length.toLocaleString("en-GB")} waiting requests** are condensed into **${stats.groups.length.toLocaleString("en-GB")} compatible groups**.`,
      "",
      "Only one page is rendered at a time, so this remains readable with hundreds or thousands of requests.",
    ].join("\n"))
    .addFields(
      { name: "🟡 Waiting", value: `**${stats.waiting.length.toLocaleString("en-GB")}**`, inline: true },
      { name: "🟢 Sessions", value: `**${stats.activeSessions.toLocaleString("en-GB")}**`, inline: true },
      { name: "⏱️ Oldest", value: stats.oldest ? relative(stats.oldest) : "—", inline: true },
    )
    .setFooter({ text: `${BROWSER_FOOTER} • ${PAGE_SIZE} groups per page` })
    .setTimestamp();

  if (pageGroups.length) {
    embed.addFields(pageGroups.map((group, index) => {
      const absoluteIndex = start + index;
      const priority = priorityForAge(group.oldestAt);
      const available = countAvailableCarriers(guildId, group.dungeon, group.difficulty);
      const eta = estimateQueueMinutes(absoluteIndex + 1, available);
      return {
        name: `${absoluteIndex + 1}. ${priority.icon} ${group.dungeon} • ${group.difficulty}`.slice(0, 256),
        value: [
          `👥 **${group.requests.length}** waiting • 🏃 **${compactRuns(group.requests)}** runs remaining`,
          `🍻 **${available}** available • ⏱️ oldest ${relative(group.oldestAt)}`,
          eta == null ? "🕒 No matching Carrier currently marked available" : `🕒 Approx **${eta} min** queue position estimate`,
        ].join("\n").slice(0, 1024),
        inline: false,
      };
    }));
  } else {
    embed.addFields({ name: "Queue clear", value: "There are no waiting groups to claim.", inline: false });
  }

  const components = [];
  if (pageGroups.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("queue_group_select")
          .setPlaceholder(`Claim a group from page ${page + 1}`)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(pageGroups.map((group) => {
            const priority = priorityForAge(group.oldestAt);
            return {
              label: `${group.dungeon} • ${group.difficulty}`.slice(0, 100),
              description: `${priority.label} • ${group.requests.length} waiting • ${compactRuns(group.requests)} runs`.slice(0, 100),
              value: encodeToken([group.dungeon, group.difficulty]),
              emoji: priority.icon,
            };
          })),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`premium_queue_page:${Math.max(0, page - 1)}`)
        .setLabel("Previous")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId("premium_queue_page_label")
        .setLabel(`${page + 1} / ${pageCount}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`premium_queue_page:${Math.min(pageCount - 1, page + 1)}`)
        .setLabel("Next")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1),
      new ButtonBuilder()
        .setCustomId(`premium_queue_refresh:${page}`)
        .setLabel("Refresh")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Primary),
    ),
  );

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("premium_my_carries")
        .setLabel("My Carries")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("premium_carrier_desk")
        .setLabel("Carrier Desk")
        .setEmoji("🍻")
        .setStyle(ButtonStyle.Success),
    ),
  );

  return { embeds: [embed], components };
}

async function renderScalableQueue(interaction, { page = 0, update = false } = {}) {
  const rows = await loadPlatformQueue();
  const payload = buildQueueBrowserPayload(interaction.guildId, rows, page);
  if (update) return interaction.update(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function handleScalableQueueInteraction(interaction) {
  if (!interaction.isButton()) return false;

  if (interaction.customId === "premium_queue_open") {
    await renderScalableQueue(interaction, { page: 0 });
    return true;
  }

  if (interaction.customId === "premium_queue_refresh" || interaction.customId === "premium_queue_back") {
    await renderScalableQueue(interaction, { page: 0, update: true });
    return true;
  }

  if (interaction.customId.startsWith("premium_queue_refresh:")) {
    const page = Number(interaction.customId.split(":")[1] || 0);
    await renderScalableQueue(interaction, { page, update: true });
    return true;
  }

  if (interaction.customId.startsWith("premium_queue_page:")) {
    const page = Number(interaction.customId.split(":")[1] || 0);
    await renderScalableQueue(interaction, { page, update: true });
    return true;
  }

  if (interaction.customId === "premium_queue_page_label") return true;
  return false;
}

module.exports = {
  PAGE_SIZE,
  buildQueueBrowserPayload,
  buildQueueOverviewPayload,
  handleScalableQueueInteraction,
  renderScalableQueue,
};
