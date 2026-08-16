const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { loadLiveLegacyQueue } = require("../platform/legacyQueue");
const {
  displayName,
  requireLinkedProfile,
  hasAnyPlatformRole,
  marketplaceBaseUrl,
} = require("../platform/helpers");

function shortId(id) {
  return String(id).slice(0, 8);
}

async function loadPlatformQueue() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id, requester_id, carrier_id, dungeon, difficulty, runs_requested, runs_completed, notes, status, created_at")
    .in("status", ["queued", "claimed", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw new Error(`Could not load the website carry queue: ${error.message}`);
  if (!data?.length) return [];

  const ids = [...new Set(data.flatMap((row) => [row.requester_id, row.carrier_id]).filter(Boolean))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, discord_username, discord_display_name, roblox_username")
    .in("id", ids);
  if (profileError) throw new Error(`Could not load queue members: ${profileError.message}`);
  const map = new Map((profiles || []).map((p) => [p.id, p]));
  return data.map((row) => ({ ...row, requester: map.get(row.requester_id), carrier: map.get(row.carrier_id) }));
}

async function viewQueue(interaction) {
  const [platformQueue, legacyQueue] = await Promise.all([
    loadPlatformQueue(),
    loadLiveLegacyQueue(interaction.client, interaction.guildId, { maxMessages: 500 }),
  ]);

  if (!platformQueue.length && !legacyQueue.length) {
    return interaction.reply("🍺 The Tavern carry queue is empty!");
  }

  const sections = [];

  if (legacyQueue.length) {
    const shown = legacyQueue.slice(0, 20);
    const legacyLines = shown.map((r) => {
      const carrier = r.carrier ? `\n🍻 Carrier: <@${r.carrier}>` : "";
      return `**Carry Request #${r.id} · ${r.dungeon || "Unknown dungeon"}**\n👤 ${r.roblox || `<@${r.user}>`}\n⚔️ ${r.difficulty || "Not set"} · ${r.runs || "?"} run(s)\n🕒 ${r.availability || "Not set"}\n📌 ${r.status || "waiting"}${carrier}`;
    });
    const more = legacyQueue.length > shown.length ? `\n\n…plus **${legacyQueue.length - shown.length}** more live Discord request(s) on the website.` : "";
    sections.push(`**🍺 Live Discord Queue**\n${legacyLines.join("\n\n")}${more}`);
  }

  if (platformQueue.length) {
    const platformLines = platformQueue.map((r, i) => {
      const carrier = r.carrier ? `\n🍻 Carrier: ${displayName(r.carrier)}` : "";
      return `**#${i + 1} · ${r.dungeon}**\n👤 ${displayName(r.requester)}\n⚔️ ${r.difficulty} · ${r.runs_requested} run(s)\n📌 ${r.status}${carrier}\n\`${r.id}\``;
    });
    sections.push(`**🌐 Website / Supabase Queue**\n${platformLines.join("\n\n")}`);
  }

  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setTitle("⚔️ The Carry Tavern Queue")
    .setDescription(sections.join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n").slice(0, 4000))
    .setFooter({ text: "Discord entries are detected from live Claim/Complete buttons, so stale database rows are ignored." });
  if (base) embed.setURL(`${base}/carry-queue`);
  return interaction.reply({ embeds: [embed] });
}

async function createRequest(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
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
  if (active) return interaction.editReply(`❌ You already have an active request for **${active.dungeon}** (${active.status}).`);

  const dungeon = interaction.options.getString("dungeon", true).trim();
  const difficulty = interaction.options.getString("difficulty")?.trim() || "Nightmare";
  const runs = interaction.options.getInteger("runs") ?? 1;
  const notes = interaction.options.getString("notes")?.trim() || null;
  const { data, error } = await supabase.from("carry_requests").insert({
    requester_id: profile.id,
    dungeon,
    difficulty,
    runs_requested: runs,
    notes,
    status: "queued",
  }).select("id").single();
  if (error) throw new Error(`Could not join the queue: ${error.message}`);
  const base = marketplaceBaseUrl();
  return interaction.editReply(`✅ Added **${dungeon}** (${difficulty}, ${runs} run${runs === 1 ? "" : "s"}) to the Tavern queue.\nRequest ID: \`${data.id}\`${base ? `\n${base}/carry-queue` : ""}`);
}

async function queueAction(interaction, kind) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;
  const supabase = getSupabase();
  const requestId = interaction.options.getString("request", true).trim();
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
  const labels = { claim: "claimed", start: "started", complete: "completed", cancel: "cancelled" };
  return interaction.editReply(`✅ Carry **${request?.dungeon || shortId(requestId)}** ${labels[kind]}.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Use the Carry Tavern carry queue")
    .addSubcommand((s) => s.setName("view").setDescription("View the Discord and website carry queues"))
    .addSubcommand((s) => s.setName("request").setDescription("Request a carry through the website queue")
      .addStringOption((o) => o.setName("dungeon").setDescription("Dungeon name").setRequired(true).setMaxLength(120))
      .addStringOption((o) => o.setName("difficulty").setDescription("Difficulty").setMaxLength(60))
      .addIntegerOption((o) => o.setName("runs").setDescription("Number of runs").setMinValue(1).setMaxValue(100))
      .addStringOption((o) => o.setName("notes").setDescription("Notes for the Carrier").setMaxLength(1000)))
    .addSubcommand((s) => s.setName("claim").setDescription("Claim a website queue carry")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID from /queue view").setRequired(true).setMinLength(36).setMaxLength(36)))
    .addSubcommand((s) => s.setName("start").setDescription("Start your claimed website carry")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID").setRequired(true).setMinLength(36).setMaxLength(36)))
    .addSubcommand((s) => s.setName("complete").setDescription("Complete and log a website carry")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID").setRequired(true).setMinLength(36).setMaxLength(36))
      .addIntegerOption((o) => o.setName("runs").setDescription("Runs completed").setMinValue(1).setMaxValue(100))
      .addIntegerOption((o) => o.setName("minutes").setDescription("Service minutes").setMinValue(0).setMaxValue(1440)))
    .addSubcommand((s) => s.setName("cancel").setDescription("Cancel a website carry you requested or claimed")
      .addStringOption((o) => o.setName("request").setDescription("Request UUID").setRequired(true).setMinLength(36).setMaxLength(36))),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "view") return await viewQueue(interaction);
      if (sub === "request") return await createRequest(interaction);
      return await queueAction(interaction, sub);
    } catch (error) {
      console.error("[QUEUE]", error);
      if (interaction.deferred || interaction.replied) return interaction.editReply("❌ Queue request failed. Nothing was changed.");
      return interaction.reply({ content: "❌ Queue request failed. Nothing was changed.", flags: MessageFlags.Ephemeral });
    }
  },
};
