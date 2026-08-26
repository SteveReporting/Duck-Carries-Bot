const {
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
    .setPlaceholder("Select a dungeon")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      DUNGEONS.map((dungeon, index) => ({
        label: dungeon,
        value: dungeon,
        description: `${index + 1}. ${dungeon}`,
      })),
    );

  const difficultySelect = new StringSelectMenuBuilder()
    .setCustomId("difficulty")
    .setPlaceholder("Select a difficulty")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: "Easy", value: "Easy", description: "Desert Temple / Winter Outpost only" },
      { label: "Medium", value: "Medium", description: "Desert Temple / Winter Outpost only" },
      { label: "Hard", value: "Hard", description: "Desert Temple / Winter Outpost only" },
      { label: "Insane", value: "Insane", description: "Available for every listed dungeon" },
      { label: "Nightmare", value: "Nightmare", description: "Available for every listed dungeon" },
    );

  const runsInput = new TextInputBuilder()
    .setCustomId("runs")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(2)
    .setPlaceholder("1-15");

  const availabilityInput = new TextInputBuilder()
    .setCustomId("availability")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(240)
    .setPlaceholder("Available now / next 2 hours");

  const notesInput = new TextInputBuilder()
    .setCustomId("notes")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Anything the Carrier should know");

  const dungeonLabel = new LabelBuilder()
    .setLabel("Dungeon")
    .setDescription("Select a dungeon, including Boss Raids.")
    .setStringSelectMenuComponent(dungeonSelect);

  const difficultyLabel = new LabelBuilder()
    .setLabel("Difficulty")
    .setDescription("Easy/Medium/Hard are only valid for Desert Temple and Winter Outpost.")
    .setStringSelectMenuComponent(difficultySelect);

  const runsLabel = new LabelBuilder()
    .setLabel("Number of Runs (1-15)")
    .setTextInputComponent(runsInput);

  const availabilityLabel = new LabelBuilder()
    .setLabel("Availability")
    .setTextInputComponent(availabilityInput);

  const notesLabel = new LabelBuilder()
    .setLabel("Extra Notes (optional)")
    .setTextInputComponent(notesInput);

  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("Request Carry")
    .addLabelComponents(
      dungeonLabel,
      difficultyLabel,
      runsLabel,
      availabilityLabel,
      notesLabel,
    );
}

async function startRequest(interaction) {
  // Opening a modal itself must happen inside Discord's short interaction window.
  // Do all account/profile validation after the modal is submitted instead of
  // spending that window on Supabase/Bloxlink lookups.
  return interaction.showModal(buildCarryModal());
}

async function submitRequest(interaction) {
  // index.js pre-acknowledges this modal before the modular event handlers run.
  // Wait for that acknowledgement so this handler never races it with another
  // deferReply(). The fallback keeps this module safe when used independently.
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

  // No Carry Tavern Roblox verification is required anymore. Bloxlink is the
  // source of truth for the Discord -> Roblox identity and the profile is synced
  // from Bloxlink immediately before the queue request is created.
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true, requireRoblox: true });
  if (!profile) return;

  const dungeon = interaction.fields.getStringSelectValues("dungeon")[0];
  const difficulty = interaction.fields.getStringSelectValues("difficulty")[0];

  if (!DUNGEONS.includes(dungeon)) {
    return interaction.editReply("❌ Invalid dungeon selection. Please open the carry form again.");
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
    return interaction.editReply(
      `❌ You now have **${MAX_ACTIVE_REQUESTS} active carry requests**. Finish or cancel one before submitting another.`,
    );
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

  const base = require("../platform/helpers").marketplaceBaseUrl();
  return interaction.editReply(
    [
      "✅ **Your carry is in the shared Tavern queue.**",
      `🏰 **${dungeon}**`,
      `⚔️ **${difficulty}**`,
      `👥 **${runs}** run${runs === 1 ? "" : "s"}`,
      `🕒 **${availability}**`,
      `🎮 Roblox via Bloxlink: **${profile.roblox_username}**`,
      `🍻 Smart match: **${matched}** available matching Carrier${matched === 1 ? "" : "s"} notified.`,
      `🆔 Request ID: \`${data.id}\``,
      "",
      `${active.length + 1}/${MAX_ACTIVE_REQUESTS} active request slots now in use.`,
      base ? `${base}/queue` : null,
    ].filter(Boolean).join("\n"),
  );
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
        return interaction.editReply(message).catch(() => {});
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
