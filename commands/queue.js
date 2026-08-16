const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { loadLiveLegacyQueue } = require("../platform/legacyQueue");
const {
  claimCarryGroup,
  groupWaitingRequests,
  loadPlatformQueue,
  requireCarrierProfile,
} = require("../platform/carryQueue");
const {
  DUNGEONS,
  canonicalizeDungeon,
  canonicalizeDifficulty,
  groupKey,
} = require("../platform/dungeons");
const {
  countAvailableCarriers,
  estimateQueueMinutes,
  maybeSendAbuseAlert,
  notifyMatchingCarriers,
  priorityForAge,
  recordAbuseEvent,
} = require("../platform/communitySystems");
const {
  displayName,
  requireLinkedProfile,
  hasAnyPlatformRole,
  marketplaceBaseUrl,
} = require("../platform/helpers");

const DIFFICULTIES = ["Easy", "Medium", "Hard", "Insane", "Insane Hardcore", "Nightmare", "Nightmare Hardcore"];

function shortId(id) {
  return String(id).slice(0, 8);
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

function ageText(dateValue) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 1000));
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function groupLegacyQueue(rows) {
  const map = new Map();
  for (const row of rows) {
    const dungeon = canonicalizeDungeon(row.dungeon);
    const difficulty = canonicalizeDifficulty(row.difficulty);
    const key = groupKey(dungeon, difficulty);
    const group = map.get(key) || { dungeon, difficulty, requests: [], tiers: new Set() };
    group.requests.push(row);
    const runs = Number.parseInt(row.runs, 10);
    if (Number.isFinite(runs)) group.tiers.add(runs);
    map.set(key, group);
  }
  return [...map.values()].map((g) => ({ ...g, tiers: [...g.tiers].sort((a, b) => a - b) }));
}

async function viewQueue(interaction) {
  const [platformQueue, legacyQueue] = await Promise.all([
    loadPlatformQueue(),
    loadLiveLegacyQueue(interaction.client, interaction.guildId, { maxMessages: 500 }),
  ]);

  const waitingGroups = groupWaitingRequests(platformQueue);
  const claimed = platformQueue.filter((r) => r.status === "claimed" || r.status === "in_progress");
  const legacyGroups = groupLegacyQueue(legacyQueue);

  if (!waitingGroups.length && !claimed.length && !legacyGroups.length) {
    return interaction.reply("🍺 The Tavern carry queue is empty!");
  }

  const sections = [];

  if (waitingGroups.length) {
    const lines = waitingGroups.slice(0, 18).map((group, index) => {
      const tiers = group.runTiers.join(" / ");
      const priority = priorityForAge(group.oldestAt);
      const available = countAvailableCarriers(interaction.guildId, group.dungeon, group.difficulty);
      const eta = estimateQueueMinutes(index + 1, available);
      const etaText = eta == null ? "no matching Carrier marked available" : `~${eta}m estimated`;
      return [
        `**${index + 1}. ${group.dungeon} • ${group.difficulty}**`,
        `${priority.icon} ${priority.label} • 👥 ${group.requests.length} request${group.requests.length === 1 ? "" : "s"} • 🏃 ${tiers} run tier${group.runTiers.length === 1 ? "" : "s"}`,
        `⏱️ oldest ${ageText(group.oldestAt)} • 🍻 ${available} available • 🕒 ${etaText}`,
      ].join("\n");
    });
    if (waitingGroups.length > 18) lines.push(`…and **${waitingGroups.length - 18}** more grouped queues.`);
    sections.push(`**🟡 Waiting Groups • oldest requests have priority**\n${lines.join("\n\n")}`);
  }

  if (claimed.length) {
    const lines = claimed.slice(0, 10).map((request) => {
      const carrier = request.carrier ? displayName(request.carrier) : "Carrier";
      return `**${canonicalizeDungeon(request.dungeon)} • ${canonicalizeDifficulty(request.difficulty)}** • ${request.runs_requested} runs\n🍻 ${carrier} • 📌 ${request.status}`;
    });
    if (claimed.length > 10) lines.push(`…and **${claimed.length - 10}** more claimed/in-progress request(s).`);
    sections.push(`**🟢 Claimed / In Progress**\n${lines.join("\n\n")}`);
  }

  if (legacyGroups.length) {
    const lines = legacyGroups.slice(0, 8).map((group) => {
      const tiers = group.tiers.length ? group.tiers.join(" / ") : "mixed";
      return `**${group.dungeon} • ${group.difficulty}** • ${group.requests.length} legacy request${group.requests.length === 1 ? "" : "s"} • ${tiers} runs`;
    });
    sections.push(`**🕰️ Existing Legacy Requests**\n${lines.join("\n")}`);
  }

  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setTitle("⚔️ The Carry Tavern Queue")
    .setDescription(sections.join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n").slice(0, 4000))
    .setFooter({ text: "ETA is an estimate based on queue position and Carriers currently marked available. New requests are grouped by exact dungeon + difficulty." });
  if (base) embed.setURL(`${base}/carry-queue`);

  const components = [];
  if (waitingGroups.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("queue_group_select")
      .setPlaceholder("Carrier: choose a dungeon + difficulty")
      .addOptions(waitingGroups.slice(0, 25).map((group) => {
        const priority = priorityForAge(group.oldestAt);
        return {
          label: `${priority.icon} ${group.dungeon} • ${group.difficulty}`.slice(0, 100),
          description: `${group.requests.length} request(s) • runs ${group.runTiers.join("/")} • ${priority.label}`.slice(0, 100),
          value: encodeToken([group.dungeon, group.difficulty]),
        };
      }));
    components.push(new ActionRowBuilder().addComponents(select));
  }

  return interaction.reply({ embeds: [embed], components });
}

async function handleGroupSelection(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const carrier = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!carrier) return true;

  const decoded = decodeToken(interaction.values?.[0]);
  if (!Array.isArray(decoded) || decoded.length < 2) {
    await interaction.editReply("❌ That queue selection expired. Run `/queue view` again.");
    return true;
  }
  const [dungeon, difficulty] = decoded;
  const queue = await loadPlatformQueue({ statuses: ["queued"] });
  const matches = queue.filter((row) =>
    canonicalizeDungeon(row.dungeon) === canonicalizeDungeon(dungeon) &&
    canonicalizeDifficulty(row.difficulty) === canonicalizeDifficulty(difficulty));
  if (!matches.length) {
    await interaction.editReply("❌ That group is no longer waiting in the queue.");
    return true;
  }

  const tiers = [...new Set(matches.map((r) => Number(r.runs_requested)))].sort((a, b) => a - b);
  const select = new StringSelectMenuBuilder()
    .setCustomId("queue_run_select")
    .setPlaceholder("Choose the maximum run amount you will carry")
    .addOptions(tiers.map((tier) => {
      const included = matches.filter((r) => Number(r.runs_requested) <= tier).length;
      return {
        label: `Up to ${tier} run${tier === 1 ? "" : "s"}`,
        description: `Claims ${included} requester${included === 1 ? "" : "s"} in this group`,
        value: encodeToken([canonicalizeDungeon(dungeon), canonicalizeDifficulty(difficulty), tier]),
      };
    }));

  await interaction.editReply({
    content: `🍺 **${canonicalizeDungeon(dungeon)} • ${canonicalizeDifficulty(difficulty)}**\nChoose a run tier. Selecting **15**, for example, also includes waiting requests for 5 runs in the same dungeon and difficulty.`,
    components: [new ActionRowBuilder().addComponents(select)],
  });
  return true;
}

async function handleRunSelection(interaction) {
  const decoded = decodeToken(interaction.values?.[0]);
  if (!Array.isArray(decoded) || decoded.length < 3) {
    await interaction.reply({ content: "❌ That run selection expired. Run `/queue view` again.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const [dungeon, difficulty, maxRuns] = decoded;
  await claimCarryGroup(interaction, { dungeon, difficulty, maxRuns: Number(maxRuns) });
  return true;
}

async function handleQueueComponent(interaction) {
  if (!interaction.isStringSelectMenu()) return false;
  if (interaction.customId === "queue_group_select") return handleGroupSelection(interaction);
  if (interaction.customId === "queue_run_select") return handleRunSelection(interaction);
  return false;
}

async function createRequest(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true, requireRoblox: true });
  if (!profile) return;
  const supabase = getSupabase();
  const { data: active, error: activeError } = await supabase
    .from("carry_requests")
    .select("id,dungeon,status")
    .eq("requester_id", profile.id)
    .in("status", ["queued", "claimed", "in_progress"])
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (active) {
    recordAbuseEvent(interaction.guildId, interaction.user.id, "duplicate_request", 1, { active: active.id });
    await maybeSendAbuseAlert(interaction.client, interaction.guildId, interaction.user.id, "duplicate carry request").catch(() => {});
    return interaction.editReply(`❌ You already have an active request for **${active.dungeon}** (${active.status}).`);
  }

  const dungeon = canonicalizeDungeon(interaction.options.getString("dungeon", true));
  const difficulty = canonicalizeDifficulty(interaction.options.getString("difficulty") || "Nightmare");
  const runs = interaction.options.getInteger("runs") ?? 1;
  const availability = interaction.options.getString("availability")?.trim() || null;
  const notes = interaction.options.getString("notes")?.trim() || null;
  const { data, error } = await supabase.from("carry_requests").insert({
    requester_id: profile.id,
    dungeon,
    difficulty,
    runs_requested: runs,
    availability,
    notes,
    status: "queued",
  }).select("id,requester_id,dungeon,difficulty,runs_requested,availability,created_at").single();
  if (error) throw new Error(`Could not join the queue: ${error.message}`);

  recordAbuseEvent(interaction.guildId, interaction.user.id, "queue_request", 0, { requestId: data.id });
  const [matched] = await Promise.all([
    notifyMatchingCarriers(interaction.client, interaction.guildId, data).catch(() => 0),
    maybeSendAbuseAlert(interaction.client, interaction.guildId, interaction.user.id, "carry request").catch(() => null),
  ]);

  const base = marketplaceBaseUrl();
  return interaction.editReply([
    `✅ Added **${dungeon}** (${difficulty}, ${runs} run${runs === 1 ? "" : "s"}) to the Tavern queue.`,
    `🎮 Roblox: **${profile.roblox_username}**`,
    `🍻 Smart match: **${matched}** available matching Carrier${matched === 1 ? "" : "s"} notified.`,
    `Request ID: \`${data.id}\``,
    base ? `${base}/carry-queue` : null,
  ].filter(Boolean).join("\n"));
}

async function releaseSingleClaim(profile, requestId) {
  const supabase = getSupabase();
  const { data: request, error: fetchError } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,status,dungeon")
    .eq("id", requestId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!request || !["claimed", "in_progress"].includes(request.status)) throw new Error("Carry is not currently claimed.");
  const staff = await hasAnyPlatformRole(profile.id, ["moderator", "administrator", "owner"]);
  if (request.carrier_id !== profile.id && !staff) throw new Error("Only the assigned Carrier can release this claim.");
  const { data, error } = await supabase
    .from("carry_requests")
    .update({
      carrier_id: null,
      status: "queued",
      claimed_at: null,
      started_at: null,
      carrier_confirmed_at: null,
      requester_confirmed_at: null,
      ticket_channel_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .select("id,dungeon")
    .single();
  if (error) throw error;
  return data;
}

async function queueAction(interaction, kind) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;
  const supabase = getSupabase();
  const requestId = interaction.options.getString("request", true).trim();

  if (kind === "unclaim") {
    const request = await releaseSingleClaim(profile, requestId);
    recordAbuseEvent(interaction.guildId, interaction.user.id, "claim_release", 1, { requestId });
    await maybeSendAbuseAlert(interaction.client, interaction.guildId, interaction.user.id, "released carry claim").catch(() => {});
    return interaction.editReply(`✅ Released **${request.dungeon}** back into the queue.`);
  }

  let rpc;
  let args = { _request_id: requestId, _actor_id: profile.id };
  if (kind === "claim") {
    const allowed = await hasAnyPlatformRole(profile.id, ["carrier", "moderator", "administrator", "owner"]);
    if (!allowed) return interaction.editReply("❌ You need the Tavern Carrier role to claim carry requests.");
    rpc = "bot_claim_carry";
  } else if (kind === "start") rpc = "bot_start_carry";
  else if (kind === "cancel") rpc = "bot_cancel_carry";
  else {
    rpc = "bot_complete_carry";
    args = {
      ...args,
      _runs: interaction.options.getInteger("runs"),
      _service_minutes: interaction.options.getInteger("minutes") ?? 0,
    };
  }
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) throw new Error(error.message);
  const request = Array.isArray(data) ? data[0] : data;
  const labels = {
    claim: "claimed",
    start: "started",
    complete: request?.status === "completed" ? "fully completed" : "completion confirmed (waiting for the other side)",
    cancel: "cancelled",
  };
  return interaction.editReply(`✅ Carry **${request?.dungeon || shortId(requestId)}** ${labels[kind]}.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Use the Carry Tavern carry queue")
    .addSubcommand((s) => s.setName("view").setDescription("View the grouped live carry queue with priority and ETA"))
    .addSubcommand((s) => s.setName("request").setDescription("Request a carry through the shared queue")
      .addStringOption((o) => o.setName("dungeon").setDescription("Choose a Dungeon Quest dungeon").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("difficulty").setDescription("Choose difficulty").setAutocomplete(true))
      .addIntegerOption((o) => o.setName("runs").setDescription("Number of runs").setMinValue(1).setMaxValue(15))
      .addStringOption((o) => o.setName("availability").setDescription("When you are available").setMaxLength(240))
      .addStringOption((o) => o.setName("notes").setDescription("Notes for the Carrier").setMaxLength(1000)))
    .addSubcommand((s) => s.setName("claim").setDescription("Claim one specific website queue carry")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID from the website").setRequired(true).setMinLength(36).setMaxLength(36)))
    .addSubcommand((s) => s.setName("start").setDescription("Start your claimed carry")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID").setRequired(true).setMinLength(36).setMaxLength(36)))
    .addSubcommand((s) => s.setName("complete").setDescription("Confirm your side of a carry as complete")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID").setRequired(true).setMinLength(36).setMaxLength(36))
      .addIntegerOption((o) => o.setName("runs").setDescription("Runs completed").setMinValue(1).setMaxValue(15))
      .addIntegerOption((o) => o.setName("minutes").setDescription("Service minutes").setMinValue(0).setMaxValue(1440)))
    .addSubcommand((s) => s.setName("unclaim").setDescription("Release a carry you claimed by mistake")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID").setRequired(true).setMinLength(36).setMaxLength(36)))
    .addSubcommand((s) => s.setName("cancel").setDescription("Cancel a carry you requested")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID").setRequired(true).setMinLength(36).setMaxLength(36))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value || "").toLowerCase();
    if (focused.name === "dungeon") {
      const choices = DUNGEONS
        .filter((d) => d.name.toLowerCase().includes(typed) || d.aliases.some((a) => a.includes(typed)))
        .slice(0, 25)
        .map((d) => ({ name: d.name, value: d.name }));
      return interaction.respond(choices);
    }
    if (focused.name === "difficulty") {
      return interaction.respond(DIFFICULTIES
        .filter((d) => d.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((d) => ({ name: d, value: d })));
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "view") return await viewQueue(interaction);
      if (sub === "request") return await createRequest(interaction);
      return await queueAction(interaction, sub);
    } catch (error) {
      console.error("[QUEUE]", error);
      const message = `❌ ${error.message || "Queue request failed. Nothing was changed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(message);
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  },

  handleQueueComponent,
};
