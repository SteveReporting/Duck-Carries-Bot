const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { requireLinkedProfile } = require("../platform/helpers");
const { parseRuns } = require("../platform/dungeons");
const {
  maybeSendAbuseAlert,
  notifyMatchingCarriers,
  recordAbuseEvent,
} = require("../platform/communitySystems");

const START_ID = "carry_request_start_v4";
const MODAL_ID = "carry_request_modal_v4";
const MAX_ACTIVE_REQUESTS = 2;
const GOLD = 0xf2b705;

const DUNGEONS = [
  "Desert Temple",
  "Winter Outpost",
  "Pirate Island",
  "King's Castle",
  "Underworld",
  "Samurai Palace",
  "Canals",
  "Ghastly Harbor",
  "Steampunk Sewers",
  "Boss Raids",
  "Orbital Outpost",
  "Volcanic Chambers",
  "Aquatic Temple",
  "Enchanted Forest",
];

const STANDARD_DIFFICULTIES = ["Insane", "Nightmare"];
const EARLY_DIFFICULTIES = ["Easy", "Medium", "Hard", "Insane", "Nightmare"];
const EARLY_DUNGEONS = new Set(["Desert Temple", "Winter Outpost"]);

function difficultiesForDungeon(dungeon) {
  return EARLY_DUNGEONS.has(dungeon) ? EARLY_DIFFICULTIES : STANDARD_DIFFICULTIES;
}

async function loadActiveRequests(profileId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,dungeon,difficulty,status,created_at")
    .eq("requester_id", profileId)
    .in("status", ["queued", "claimed", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(MAX_ACTIVE_REQUESTS);

  if (error) throw new Error(error.message);
  return data || [];
}

function buildCarryModal() {
  const dungeonSelect = new StringSelectMenuBuilder()
    .setCustomId("dungeon")
    .setPlaceholder("Choose your dungeon")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      DUNGEONS.map((dungeon) => ({
        label: dungeon,
        value: dungeon,
      })),
    );

  const difficultySelect = new StringSelectMenuBuilder()
    .setCustomId("difficulty")
    .setPlaceholder("Choose difficulty")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: "Easy", value: "Easy", description: "Desert Temple / Winter Outpost" },
      { label: "Medium", value: "Medium", description: "Desert Temple / Winter Outpost" },
      { label: "Hard", value: "Hard", description: "Desert Temple / Winter Outpost" },
      { label: "Insane", value: "Insane", description: "Available on every listed dungeon" },
      { label: "Nightmare", value: "Nightmare", description: "Available on every listed dungeon" },
    );

  const runsInput = new TextInputBuilder()
    .setCustomId("runs")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(2)
    .setPlaceholder("Example: 5");

  const availabilityInput = new TextInputBuilder()
    .setCustomId("availability")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(240)
    .setPlaceholder("Example: available now for 2 hours");

  const notesInput = new TextInputBuilder()
    .setCustomId("notes")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Optional notes for the Carrier");

  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("⚔️ Request a Carry")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Dungeon")
        .setDescription("Pick the dungeon you want carried.")
        .setStringSelectMenuComponent(dungeonSelect),
      new LabelBuilder()
        .setLabel("Difficulty")
        .setDescription("Early dungeons also support Easy / Medium / Hard.")
        .setStringSelectMenuComponent(difficultySelect),
      new LabelBuilder()
        .setLabel("Runs")
        .setDescription("1-15 runs. Progress is preserved if a session only completes part of them.")
        .setTextInputComponent(runsInput),
      new LabelBuilder()
        .setLabel("Availability")
        .setDescription("Tell the Carrier when you can join.")
        .setTextInputComponent(availabilityInput),
      new LabelBuilder()
        .setLabel("Notes (optional)")
        .setDescription("Anything useful the Carrier should know.")
        .setTextInputComponent(notesInput),
    );
}

async function startRequest(interaction) {
  return interaction.showModal(buildCarryModal());
}

function successPayload({ dungeon, difficulty, runs, availability, notes, profile, matched, requestId, activeCount }) {
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • REQUEST CREATED" })
    .setTitle("✅ You’re in the queue")
    .setDescription([
      "Your request is live and matching Carriers have been notified automatically.",
      "",
      "You do **not** need to copy an ID, ping a Carrier, or make a separate ticket. When a Carrier claims you, the private session and optional carry VC are created automatically.",
      "",
      "Want to hang out while you wait? **Waiting VC is optional.** If you are in it when your carry is claimed, the bot moves you into the session VC automatically. If you never join VC, you still get pinged when the carry starts.",
    ].join("\n"))
    .addFields(
      { name: "🏰 Dungeon", value: dungeon, inline: true },
      { name: "⚔️ Difficulty", value: difficulty, inline: true },
      { name: "🏃 Runs", value: String(runs), inline: true },
      { name: "🎮 Roblox", value: `@${profile.roblox_username}`, inline: true },
      { name: "🍻 Matching Carriers", value: `**${matched}** notified`, inline: true },
      { name: "📌 Active Slots", value: `**${activeCount}/${MAX_ACTIVE_REQUESTS}**`, inline: true },
      { name: "🕒 Availability", value: availability || "Not specified", inline: false },
      ...(notes ? [{ name: "📝 Notes", value: notes.slice(0, 1024), inline: false }] : []),
    )
    .setFooter({ text: `The Carry Tavern • Request ${String(requestId).slice(0, 8)}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("carry_waiting_vc")
          .setLabel("Waiting VC")
          .setEmoji("⏳")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("premium_queue_open")
          .setLabel("Live Queue")
          .setEmoji("📡")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("premium_my_carries")
          .setLabel("My Carries")
          .setEmoji("📋")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function submitRequest(interaction) {
  if (interaction.__carryFastAckPromise) {
    await interaction.__carryFastAckPromise;
  }

  if (!interaction.guild) {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply("❌ Carry requests must be created inside the server.");
    }
    return interaction.reply({ content: "❌ Carry requests must be created inside the server.", flags: MessageFlags.Ephemeral });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true, requireRoblox: true });
  if (!profile) return;

  const dungeon = interaction.fields.getStringSelectValues("dungeon")[0];
  const difficulty = interaction.fields.getStringSelectValues("difficulty")[0];

  if (!DUNGEONS.includes(dungeon)) {
    return interaction.editReply("❌ That dungeon selection is no longer valid. Open the request form again.");
  }

  if (!difficultiesForDungeon(dungeon).includes(difficulty)) {
    return interaction.editReply(
      `❌ **${difficulty}** is not available for **${dungeon}**. ${EARLY_DUNGEONS.has(dungeon) ? "Choose Easy, Medium, Hard, Insane or Nightmare." : "Choose Insane or Nightmare."}`,
    );
  }

  const runs = parseRuns(interaction.fields.getTextInputValue("runs").trim());
  if (!runs) {
    return interaction.editReply("❌ Runs must be a number from **1 to 15**.");
  }

  const availability = interaction.fields.getTextInputValue("availability").trim().slice(0, 240);
  const notes = interaction.fields.getTextInputValue("notes").trim() || null;

  const active = await loadActiveRequests(profile.id);
  if (active.length >= MAX_ACTIVE_REQUESTS) {
    return interaction.editReply({
      content: `❌ You already have **${MAX_ACTIVE_REQUESTS} active carry requests**. Finish or cancel one first.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("premium_my_carries")
            .setLabel("View My Carries")
            .setEmoji("📋")
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    });
  }

  const supabase = getSupabase();
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

  if (error) {
    return interaction.editReply(`❌ ${error.message}`);
  }

  recordAbuseEvent(interaction.guildId, interaction.user.id, "queue_request", 0, { requestId: data.id });
  const matched = await notifyMatchingCarriers(interaction.client, interaction.guildId, data).catch(() => 0);
  await maybeSendAbuseAlert(interaction.client, interaction.guildId, interaction.user.id, "carry request").catch(() => {});

  return interaction.editReply(successPayload({
    dungeon,
    difficulty,
    runs,
    availability,
    notes,
    profile,
    matched,
    requestId: data.id,
    activeCount: active.length + 1,
  }));
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isButton() && interaction.customId === START_ID) {
        return await startRequest(interaction);
      }

      if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
        return await submitRequest(interaction);
      }
    } catch (error) {
      console.error("[CARRY REQUEST PANEL V4]", error);
      const message = `❌ ${error.message || "Something went wrong while creating the carry request."}`;
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
