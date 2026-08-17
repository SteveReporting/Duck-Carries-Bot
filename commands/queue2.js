const {
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const baseQueue = require("./queue");
const { getSupabase } = require("../marketplace/supabase");
const {
  DUNGEONS,
  canonicalizeDungeon,
} = require("../platform/dungeons");
const {
  maybeSendAbuseAlert,
  notifyMatchingCarriers,
  recordAbuseEvent,
} = require("../platform/communitySystems");
const {
  requireLinkedProfile,
  marketplaceBaseUrl,
} = require("../platform/helpers");

const STANDARD_DIFFICULTIES = ["Insane", "Nightmare"];
const EARLY_DUNGEON_DIFFICULTIES = ["Easy", "Medium", "Hard", "Insane", "Nightmare"];
const EARLY_DUNGEONS = new Set(["Desert Temple", "Winter Outpost"]);

function difficultiesForDungeon(dungeon) {
  return EARLY_DUNGEONS.has(canonicalizeDungeon(dungeon))
    ? EARLY_DUNGEON_DIFFICULTIES
    : STANDARD_DIFFICULTIES;
}

function exactDifficulty(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const exact = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
    insane: "Insane",
    nightmare: "Nightmare",
  };
  return exact[normalized] || null;
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
    await maybeSendAbuseAlert(
      interaction.client,
      interaction.guildId,
      interaction.user.id,
      "duplicate carry request",
    ).catch(() => {});
    return interaction.editReply(
      `❌ You already have an active request for **${active.dungeon}** (${active.status}).`,
    );
  }

  const dungeon = canonicalizeDungeon(interaction.options.getString("dungeon", true));
  const rawDifficulty = interaction.options.getString("difficulty", true);
  const difficulty = exactDifficulty(rawDifficulty);
  const allowedDifficulties = difficultiesForDungeon(dungeon);

  if (!difficulty || !allowedDifficulties.includes(difficulty)) {
    const allowedText = allowedDifficulties.map((value) => `**${value}**`).join(", ");
    return interaction.editReply(
      `❌ **${dungeon}** difficulty must be one of: ${allowedText}.`,
    );
  }

  const runs = interaction.options.getInteger("runs") ?? 1;
  const availability = interaction.options.getString("availability")?.trim() || null;
  const notes = interaction.options.getString("notes")?.trim() || null;

  const { data, error } = await supabase
    .from("carry_requests")
    .insert({
      requester_id: profile.id,
      dungeon,
      difficulty,
      runs_requested: runs,
      availability,
      notes,
      status: "queued",
    })
    .select("id,requester_id,dungeon,difficulty,runs_requested,availability,created_at")
    .single();

  if (error) throw new Error(`Could not join the queue: ${error.message}`);

  recordAbuseEvent(interaction.guildId, interaction.user.id, "queue_request", 0, {
    requestId: data.id,
  });

  const [matched] = await Promise.all([
    notifyMatchingCarriers(interaction.client, interaction.guildId, data).catch(() => 0),
    maybeSendAbuseAlert(
      interaction.client,
      interaction.guildId,
      interaction.user.id,
      "carry request",
    ).catch(() => null),
  ]);

  const base = marketplaceBaseUrl();
  return interaction.editReply(
    [
      `✅ Added **${dungeon}** (${difficulty}, ${runs} run${runs === 1 ? "" : "s"}) to the Tavern queue.`,
      `🎮 Roblox: **${profile.roblox_username}**`,
      `🍻 Smart match: **${matched}** available matching Carrier${matched === 1 ? "" : "s"} notified.`,
      `Request ID: \`${data.id}\``,
      base ? `${base}/carry-queue` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Use the Carry Tavern carry queue")
    .addSubcommand((s) =>
      s.setName("view").setDescription("View the grouped live carry queue with priority and ETA"),
    )
    .addSubcommand((s) =>
      s
        .setName("request")
        .setDescription("Request a carry through the shared queue")
        .addStringOption((o) =>
          o
            .setName("dungeon")
            .setDescription("Choose a Dungeon Quest dungeon")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName("difficulty")
            .setDescription("Choose a difficulty available for that dungeon")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addIntegerOption((o) =>
          o.setName("runs").setDescription("Number of runs").setMinValue(1).setMaxValue(15),
        )
        .addStringOption((o) =>
          o.setName("availability").setDescription("When you are available").setMaxLength(240),
        )
        .addStringOption((o) =>
          o.setName("notes").setDescription("Notes for the Carrier").setMaxLength(1000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("claim")
        .setDescription("Claim one specific website queue carry")
        .addStringOption((o) =>
          o
            .setName("request")
            .setDescription("Request UUID from the website")
            .setRequired(true)
            .setMinLength(36)
            .setMaxLength(36),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Start your claimed carry")
        .addStringOption((o) =>
          o
            .setName("request")
            .setDescription("Request UUID")
            .setRequired(true)
            .setMinLength(36)
            .setMaxLength(36),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("complete")
        .setDescription("Confirm your side of a carry as complete")
        .addStringOption((o) =>
          o
            .setName("request")
            .setDescription("Request UUID")
            .setRequired(true)
            .setMinLength(36)
            .setMaxLength(36),
        )
        .addIntegerOption((o) =>
          o.setName("runs").setDescription("Runs completed").setMinValue(1).setMaxValue(15),
        )
        .addIntegerOption((o) =>
          o
            .setName("minutes")
            .setDescription("Service minutes")
            .setMinValue(0)
            .setMaxValue(1440),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("unclaim")
        .setDescription("Release a carry you claimed by mistake")
        .addStringOption((o) =>
          o
            .setName("request")
            .setDescription("Request UUID")
            .setRequired(true)
            .setMinLength(36)
            .setMaxLength(36),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("cancel")
        .setDescription("Cancel a carry you requested")
        .addStringOption((o) =>
          o
            .setName("request")
            .setDescription("Request UUID")
            .setRequired(true)
            .setMinLength(36)
            .setMaxLength(36),
        ),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value || "").toLowerCase();

    if (focused.name === "dungeon") {
      const choices = DUNGEONS
        .filter(
          (dungeon) =>
            dungeon.name.toLowerCase().includes(typed) ||
            dungeon.aliases.some((alias) => alias.includes(typed)),
        )
        .slice(0, 25)
        .map((dungeon) => ({ name: dungeon.name, value: dungeon.name }));
      return interaction.respond(choices);
    }

    if (focused.name === "difficulty") {
      const dungeon = canonicalizeDungeon(interaction.options.getString("dungeon") || "");
      const choices = difficultiesForDungeon(dungeon)
        .filter((difficulty) => difficulty.toLowerCase().includes(typed))
        .map((difficulty) => ({ name: difficulty, value: difficulty }));
      return interaction.respond(choices);
    }

    return interaction.respond([]);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== "request") return baseQueue.execute(interaction);

    try {
      return await createRequest(interaction);
    } catch (error) {
      console.error("[QUEUE]", error);
      const message = `❌ ${error.message || "Queue request failed. Nothing was changed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(message);
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  },

  handleQueueComponent: baseQueue.handleQueueComponent,
};
