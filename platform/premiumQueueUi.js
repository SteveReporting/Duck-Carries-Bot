const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const {
  claimCarryGroup,
  groupWaitingRequests,
  loadPlatformQueue,
  requireCarrierProfile,
} = require("./carryQueue");
const {
  countAvailableCarriers,
  estimateQueueMinutes,
  priorityForAge,
} = require("./communitySystems");
const {
  getLinkedProfile,
  hasAnyPlatformRole,
  marketplaceBaseUrl,
} = require("./helpers");
const {
  canonicalizeDungeon,
  canonicalizeDifficulty,
} = require("./dungeons");

const BRAND_GOLD = 0xf2b705;
const BRAND_BLUE = 0x5865f2;
const BRAND_GREEN = 0x2ecc71;
const FOOTER = "The Carry Tavern • Carry Operations";

function remainingRuns(request) {
  return Math.max(0, Number(request.runs_requested || 0) - Number(request.runs_completed || 0));
}

function encodeToken(parts) {
  return Buffer.from(JSON.stringify(parts)).toString("base64url");
}

function decodeToken(value) {
  try {
    return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function discordRelative(dateValue) {
  const ms = new Date(dateValue).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function compactRuns(values) {
  const unique = [...new Set(values.map(Number).filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
  return unique.length ? unique.join(" / ") : "—";
}

function activeSessionCount(rows) {
  const tickets = new Set(
    rows
      .filter((request) => ["claimed", "in_progress"].includes(request.status))
      .map((request) => request.ticket_channel_id || request.id)
      .filter(Boolean),
  );
  return tickets.size;
}

function buildPremiumQueuePayload(guildId, rows) {
  const waitingGroups = groupWaitingRequests(rows);
  const waitingRequests = rows.filter((request) => request.status === "queued" && remainingRuns(request) > 0);
  const active = rows.filter((request) => ["claimed", "in_progress"].includes(request.status));
  const oldest = waitingRequests[0]?.created_at || null;

  const embed = new EmbedBuilder()
    .setColor(waitingRequests.length ? BRAND_GOLD : BRAND_GREEN)
    .setAuthor({ name: "THE CARRY TAVERN • LIVE OPERATIONS" })
    .setTitle("⚔️ Carry Queue")
    .setDescription([
      waitingRequests.length
        ? "Requests are grouped automatically so Carriers can claim an entire compatible session in a few clicks. Oldest requests are prioritised first."
        : "The live queue is clear. New requests will appear here automatically.",
      "",
      "**No request IDs to copy. No command chains. Pick a group, choose the run batch, and the private carry ticket is created automatically.**",
    ].join("\n"))
    .addFields(
      { name: "🟡 Waiting", value: `**${waitingRequests.length}** requests`, inline: true },
      { name: "⚔️ Groups", value: `**${waitingGroups.length}** live groups`, inline: true },
      { name: "🟢 Active", value: `**${activeSessionCount(rows)}** sessions`, inline: true },
      { name: "⏱️ Oldest Wait", value: oldest ? discordRelative(oldest) : "—", inline: true },
      { name: "📦 Active Requests", value: `**${active.length}** claimed/in progress`, inline: true },
      { name: "⚙️ Queue Engine", value: "**ONLINE**", inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (waitingGroups.length) {
    const fields = waitingGroups.slice(0, 12).map((group, index) => {
      const priority = priorityForAge(group.oldestAt);
      const available = countAvailableCarriers(guildId, group.dungeon, group.difficulty);
      const eta = estimateQueueMinutes(index + 1, available);
      const runs = compactRuns(group.requests.map(remainingRuns));
      const etaText = eta == null ? "No matching Carrier marked available" : `~${eta} min estimate`;

      return {
        name: `${priority.icon} ${group.dungeon} • ${group.difficulty}`.slice(0, 256),
        value: [
          `👥 **${group.requests.length}** waiting • 🏃 **${runs}** runs remaining`,
          `⏱️ Oldest ${discordRelative(group.oldestAt)} • 🍻 **${available}** available`,
          `🕒 ${etaText} • **${priority.label}** priority`,
        ].join("\n").slice(0, 1024),
        inline: false,
      };
    });

    if (waitingGroups.length > 12) {
      fields.push({
        name: "More waiting groups",
        value: `**${waitingGroups.length - 12}** additional group${waitingGroups.length - 12 === 1 ? "" : "s"} are available in the selector below.`,
        inline: false,
      });
    }

    embed.addFields(fields);
  }

  const base = marketplaceBaseUrl();
  if (base) embed.setURL(`${base}/carry-queue`);

  const components = [];
  if (waitingGroups.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("queue_group_select")
          .setPlaceholder("Carrier • choose a queue group")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            waitingGroups.slice(0, 25).map((group) => {
              const priority = priorityForAge(group.oldestAt);
              return {
                label: `${group.dungeon} • ${group.difficulty}`.slice(0, 100),
                description: `${priority.label} • ${group.requests.length} waiting • ${compactRuns(group.requests.map(remainingRuns))} runs`.slice(0, 100),
                value: encodeToken([group.dungeon, group.difficulty]),
                emoji: priority.icon,
              };
            }),
          ),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("premium_queue_refresh")
        .setLabel("Refresh")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("premium_my_carries")
        .setLabel("My Carries")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("carry_request_start_v4")
        .setLabel("Request Carry")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return { embeds: [embed], components };
}

async function renderPremiumQueue(interaction, { ephemeral = false, update = false } = {}) {
  const rows = await loadPlatformQueue();
  const payload = buildPremiumQueuePayload(interaction.guildId, rows);

  if (update) return interaction.update(payload);
  return interaction.reply({
    ...payload,
    ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
  });
}

function requestStatus(request) {
  if (request.status === "queued") return "🟡 Waiting";
  if (request.status === "claimed") return "🔵 Claimed";
  if (request.status === "in_progress") return "🟢 In Progress";
  return request.status || "Unknown";
}

async function renderMyCarries(interaction) {
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    const base = marketplaceBaseUrl();
    return interaction.reply({
      content: `❌ Link your Tavern account first.${base ? `\n${base}/auth` : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const supabase = getSupabase();
  const [requestedResult, carriedResult] = await Promise.all([
    supabase
      .from("carry_requests")
      .select("id,dungeon,difficulty,runs_requested,runs_completed,status,created_at,ticket_channel_id")
      .eq("requester_id", profile.id)
      .in("status", ["queued", "claimed", "in_progress"])
      .order("created_at", { ascending: true })
      .limit(10),
    supabase
      .from("carry_requests")
      .select("id,dungeon,difficulty,runs_requested,runs_completed,status,created_at,ticket_channel_id")
      .eq("carrier_id", profile.id)
      .in("status", ["claimed", "in_progress"])
      .order("created_at", { ascending: true })
      .limit(10),
  ]);

  if (requestedResult.error) throw new Error(requestedResult.error.message);
  if (carriedResult.error) throw new Error(carriedResult.error.message);

  const requested = requestedResult.data || [];
  const carried = carriedResult.data || [];

  const embed = new EmbedBuilder()
    .setColor(BRAND_BLUE)
    .setAuthor({ name: "THE CARRY TAVERN • PERSONAL DASHBOARD" })
    .setTitle("📋 My Active Carries")
    .setDescription("One place for everything currently waiting, claimed or being carried.")
    .setFooter({ text: FOOTER })
    .setTimestamp();

  embed.addFields({
    name: `⚔️ My Requests • ${requested.length}`,
    value: requested.length
      ? requested.map((request) => {
          const left = remainingRuns(request);
          const ticket = request.ticket_channel_id ? ` • <#${request.ticket_channel_id}>` : "";
          return `${requestStatus(request)} • **${canonicalizeDungeon(request.dungeon)}** (${canonicalizeDifficulty(request.difficulty)}) • **${left}** run${left === 1 ? "" : "s"} left${ticket}`;
        }).join("\n").slice(0, 1024)
      : "No active carry requests.",
    inline: false,
  });

  if (carried.length) {
    embed.addFields({
      name: `🍻 My Carrier Sessions • ${carried.length}`,
      value: carried.map((request) => {
        const left = remainingRuns(request);
        const ticket = request.ticket_channel_id ? ` • <#${request.ticket_channel_id}>` : "";
        return `${requestStatus(request)} • **${canonicalizeDungeon(request.dungeon)}** (${canonicalizeDifficulty(request.difficulty)}) • **${left}** left${ticket}`;
      }).join("\n").slice(0, 1024),
      inline: false,
    });
  }

  return interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("premium_queue_open")
          .setLabel("Live Queue")
          .setEmoji("⚔️")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("carry_request_start_v4")
          .setLabel("New Request")
          .setEmoji("➕")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function renderCarrierDesk(interaction) {
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    return interaction.reply({ content: "❌ Link your Tavern account before using Carrier Desk.", flags: MessageFlags.Ephemeral });
  }

  const carrier = await hasAnyPlatformRole(profile.id, ["carrier", "moderator", "administrator", "owner"]);
  if (!carrier) {
    return interaction.reply({ content: "❌ Carrier Desk is available to Tavern Carriers and staff.", flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER DESK" })
    .setTitle("🍻 Carrier Control")
    .setDescription([
      "Your job should be three things: **go available, claim a compatible group, complete the session.**",
      "",
      "**Core controls**",
      "`/carrier available` — enter smart matching",
      "`/carrier unavailable` — stop new match notifications",
      "`/carrier profile` — ratings, service time and permissions",
      "",
      "Use **Open Live Queue** below to claim by dungeon + difficulty without copying request IDs.",
    ].join("\n"))
    .setFooter({ text: FOOTER })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("premium_queue_open")
          .setLabel("Open Live Queue")
          .setEmoji("⚔️")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("premium_my_carries")
          .setLabel("My Active Carries")
          .setEmoji("📋")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleGroupSelection(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const carrier = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!carrier) return true;

  const decoded = decodeToken(interaction.values?.[0]);
  if (!Array.isArray(decoded) || decoded.length < 2) {
    await interaction.editReply({ content: "❌ That queue view expired. Open the live queue again.", embeds: [], components: [] });
    return true;
  }

  const [dungeon, difficulty] = decoded;
  const canonicalDungeon = canonicalizeDungeon(dungeon);
  const canonicalDifficulty = canonicalizeDifficulty(difficulty);
  const rows = await loadPlatformQueue({ statuses: ["queued"] });
  const matches = rows.filter((request) =>
    remainingRuns(request) > 0 &&
    canonicalizeDungeon(request.dungeon) === canonicalDungeon &&
    canonicalizeDifficulty(request.difficulty) === canonicalDifficulty,
  );

  if (!matches.length) {
    await interaction.editReply({
      content: "❌ That group was just claimed or cleared. Refresh the live queue.",
      embeds: [],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("premium_queue_open")
            .setLabel("Open Live Queue")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return true;
  }

  const tiers = [...new Set(matches.map(remainingRuns).filter((runs) => runs > 0))].sort((a, b) => a - b);
  const oldest = matches
    .map((request) => request.created_at)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];

  const embed = new EmbedBuilder()
    .setColor(BRAND_GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • CLAIM BUILDER" })
    .setTitle(`⚔️ ${canonicalDungeon} • ${canonicalDifficulty}`)
    .setDescription([
      "Choose how many runs this session will complete. The system automatically includes compatible waiting requesters and preserves partial progress.",
      "",
      "**Example:** choosing a 5-run batch for people needing 5 and 10 runs finishes the first request and returns the second with 5 remaining.",
    ].join("\n"))
    .addFields(
      { name: "👥 Waiting", value: `**${matches.length}** requesters`, inline: true },
      { name: "🏃 Run Tiers", value: `**${compactRuns(matches.map(remainingRuns))}**`, inline: true },
      { name: "⏱️ Oldest", value: discordRelative(oldest), inline: true },
    )
    .setFooter({ text: "Select the batch size • private ticket creation is automatic" });

  const runSelect = new StringSelectMenuBuilder()
    .setCustomId("queue_run_select")
    .setPlaceholder("Choose this session's run batch")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      tiers.map((tier) => {
        const finishing = matches.filter((request) => remainingRuns(request) <= tier).length;
        const continuing = matches.length - finishing;
        return {
          label: `${tier}-run session`,
          description: `${finishing} finish • ${continuing} keep progress • ${matches.length} total`.slice(0, 100),
          value: encodeToken([canonicalDungeon, canonicalDifficulty, tier]),
          emoji: finishing === matches.length ? "✅" : "🏃",
        };
      }),
    );

  await interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(runSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("premium_queue_back")
          .setLabel("Back to Queue")
          .setEmoji("↩️")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  return true;
}

async function handleRunSelection(interaction) {
  const decoded = decodeToken(interaction.values?.[0]);
  if (!Array.isArray(decoded) || decoded.length < 3) {
    await interaction.reply({ content: "❌ That run selection expired. Open the live queue again.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const [dungeon, difficulty, maxRuns] = decoded;
  await claimCarryGroup(interaction, {
    dungeon: canonicalizeDungeon(dungeon),
    difficulty: canonicalizeDifficulty(difficulty),
    maxRuns: Number(maxRuns),
  });
  return true;
}

async function handlePremiumQueueComponent(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === "queue_group_select") {
    return handleGroupSelection(interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "queue_run_select") {
    return handleRunSelection(interaction);
  }

  if (!interaction.isButton()) return false;

  if (interaction.customId === "premium_queue_open") {
    await renderPremiumQueue(interaction, { ephemeral: true });
    return true;
  }

  if (interaction.customId === "premium_queue_refresh") {
    await renderPremiumQueue(interaction, { update: true });
    return true;
  }

  if (interaction.customId === "premium_queue_back") {
    await renderPremiumQueue(interaction, { update: true });
    return true;
  }

  if (interaction.customId === "premium_my_carries") {
    await renderMyCarries(interaction);
    return true;
  }

  if (interaction.customId === "premium_carrier_desk") {
    await renderCarrierDesk(interaction);
    return true;
  }

  return false;
}

module.exports = {
  buildPremiumQueuePayload,
  renderPremiumQueue,
  renderMyCarries,
  renderCarrierDesk,
  handlePremiumQueueComponent,
};
