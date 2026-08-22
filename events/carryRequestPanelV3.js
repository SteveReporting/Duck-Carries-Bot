const {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, marketplaceBaseUrl } = require("../platform/helpers");
const { parseRuns } = require("../platform/dungeons");
const {
  maybeSendAbuseAlert,
  notifyMatchingCarriers,
  recordAbuseEvent,
} = require("../platform/communitySystems");

const START_ID = "carry_request_start_v3";
const DUNGEON_SELECT_ID = "carry_request_dungeon_v3";
const DIFFICULTY_SELECT_PREFIX = "carry_request_difficulty_v3:";
const MODAL_PREFIX = "carry_request_modal_v3:";
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
  "Orbital Outpost",
  "Volcanic Chambers",
  "Aquatic Temple",
  "Enchanted Forest",
];

const STANDARD_DIFFICULTIES = ["Insane", "Nightmare"];
const EARLY_DIFFICULTIES = ["Easy", "Medium", "Hard", "Insane", "Nightmare"];
const EARLY_DUNGEONS = new Set(["Desert Temple", "Winter Outpost"]);

const DIFFICULTY_CODES = {
  Easy: "easy",
  Medium: "medium",
  Hard: "hard",
  Insane: "insane",
  Nightmare: "nightmare",
};

const CODE_TO_DIFFICULTY = Object.fromEntries(
  Object.entries(DIFFICULTY_CODES).map(([name, code]) => [code, name]),
);

function difficultiesForDungeon(dungeon) {
  return EARLY_DUNGEONS.has(dungeon) ? EARLY_DIFFICULTIES : STANDARD_DIFFICULTIES;
}

async function requireRequestProfile(interaction) {
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    const base = marketplaceBaseUrl();
    await interaction.reply({
      content: `❌ Before requesting a carry, link your Tavern account.${base ? `\nSign in with Discord: ${base}/auth` : ""}`,
      ephemeral: true,
    });
    return null;
  }

  if (!profile.roblox_verified_at || !profile.roblox_username) {
    await interaction.reply({
      content: "❌ Before requesting a carry, verify your Roblox account with `/roblox link` and `/roblox verify`.",
      ephemeral: true,
    });
    return null;
  }

  return profile;
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

function dungeonSelectRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(DUNGEON_SELECT_ID)
    .setPlaceholder("Select a dungeon")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      DUNGEONS.map((dungeon, index) => ({
        label: dungeon,
        value: String(index),
        description: `${index + 1}. ${dungeon}`,
      })),
    );

  return new ActionRowBuilder().addComponents(select);
}

function difficultySelectRow(dungeonIndex) {
  const dungeon = DUNGEONS[dungeonIndex];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${DIFFICULTY_SELECT_PREFIX}${dungeonIndex}`)
    .setPlaceholder("Select a difficulty")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      difficultiesForDungeon(dungeon).map((difficulty) => ({
        label: difficulty,
        value: DIFFICULTY_CODES[difficulty],
        description: `${dungeon} • ${difficulty}`,
      })),
    );

  return new ActionRowBuilder().addComponents(select);
}

async function startRequest(interaction) {
  const profile = await requireRequestProfile(interaction);
  if (!profile) return;

  const active = await loadActiveRequests(profile.id);
  if (active.length >= MAX_ACTIVE_REQUESTS) {
    const current = active
      .map((request) => `• **${request.dungeon}** • ${request.difficulty} • ${request.status.replace("_", " ")}`)
      .join("\n");

    return interaction.reply({
      content: [
        `❌ You already have **${MAX_ACTIVE_REQUESTS}/${MAX_ACTIVE_REQUESTS} active carry requests**.`,
        current,
        "",
        "Finish or cancel one before creating another.",
      ].join("\n"),
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: [
      "## 🍺 Request a Carry",
      `You currently have **${active.length}/${MAX_ACTIVE_REQUESTS}** active request slots in use.`,
      "",
      "**Step 1 of 3:** Select a dungeon below.",
      "Available dungeons run from **Desert Temple** through **Enchanted Forest**.",
    ].join("\n"),
    components: [dungeonSelectRow()],
    ephemeral: true,
  });
}

async function chooseDungeon(interaction) {
  const dungeonIndex = Number.parseInt(interaction.values[0], 10);
  const dungeon = DUNGEONS[dungeonIndex];

  if (!dungeon) {
    return interaction.update({
      content: "❌ That dungeon selection is no longer valid. Press Request a Carry again.",
      components: [],
    });
  }

  return interaction.update({
    content: [
      "## 🍺 Request a Carry",
      `🏰 **Dungeon:** ${dungeon}`,
      "",
      "**Step 2 of 3:** Select a difficulty below.",
      EARLY_DUNGEONS.has(dungeon)
        ? "Easy, Medium, Hard, Insane and Nightmare are available for this dungeon."
        : "Insane and Nightmare are available for this dungeon.",
    ].join("\n"),
    components: [difficultySelectRow(dungeonIndex)],
  });
}

async function chooseDifficulty(interaction) {
  const dungeonIndex = Number.parseInt(
    interaction.customId.slice(DIFFICULTY_SELECT_PREFIX.length),
    10,
  );
  const dungeon = DUNGEONS[dungeonIndex];
  const difficultyCode = interaction.values[0];
  const difficulty = CODE_TO_DIFFICULTY[difficultyCode];

  if (!dungeon || !difficulty || !difficultiesForDungeon(dungeon).includes(difficulty)) {
    return interaction.update({
      content: "❌ That selection is no longer valid. Press Request a Carry again.",
      components: [],
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${dungeonIndex}:${difficultyCode}`)
    .setTitle(`${dungeon} • ${difficulty}`.slice(0, 45));

  const runs = new TextInputBuilder()
    .setCustomId("runs")
    .setLabel("Number of Runs (1-15)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(2)
    .setPlaceholder("e.g. 5");

  const availability = new TextInputBuilder()
    .setCustomId("availability")
    .setLabel("Availability")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(240)
    .setPlaceholder("e.g. Available now / next 2 hours");

  const notes = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Extra Notes (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Anything the Carrier should know");

  modal.addComponents(
    new ActionRowBuilder().addComponents(runs),
    new ActionRowBuilder().addComponents(availability),
    new ActionRowBuilder().addComponents(notes),
  );

  return interaction.showModal(modal);
}

async function submitRequest(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ Carry requests must be created inside the server.",
      ephemeral: true,
    });
  }

  const [dungeonIndexRaw, difficultyCode] = interaction.customId
    .slice(MODAL_PREFIX.length)
    .split(":");
  const dungeonIndex = Number.parseInt(dungeonIndexRaw, 10);
  const dungeon = DUNGEONS[dungeonIndex];
  const difficulty = CODE_TO_DIFFICULTY[difficultyCode];

  if (!dungeon || !difficulty || !difficultiesForDungeon(dungeon).includes(difficulty)) {
    return interaction.reply({
      content: "❌ The selected dungeon or difficulty is invalid. Please start the request again.",
      ephemeral: true,
    });
  }

  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile || !profile.roblox_verified_at || !profile.roblox_username) {
    return interaction.reply({
      content: "❌ Verify your Roblox account before requesting a carry.",
      ephemeral: true,
    });
  }

  const runs = parseRuns(interaction.fields.getTextInputValue("runs").trim());
  if (!runs) {
    return interaction.reply({
      content: "❌ Runs must be a number from **1 to 15**.",
      ephemeral: true,
    });
  }

  const availability = interaction.fields
    .getTextInputValue("availability")
    .trim()
    .slice(0, 240);
  const notes = interaction.fields.getTextInputValue("notes").trim() || null;

  const active = await loadActiveRequests(profile.id);
  if (active.length >= MAX_ACTIVE_REQUESTS) {
    return interaction.reply({
      content: `❌ You now have **${MAX_ACTIVE_REQUESTS} active carry requests**. Finish or cancel one before submitting another.`,
      ephemeral: true,
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
    return interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
  }

  recordAbuseEvent(interaction.guildId, interaction.user.id, "queue_request", 0, {
    requestId: data.id,
  });

  const matched = await notifyMatchingCarriers(
    interaction.client,
    interaction.guildId,
    data,
  ).catch(() => 0);
  await maybeSendAbuseAlert(
    interaction.client,
    interaction.guildId,
    interaction.user.id,
    "carry request",
  ).catch(() => {});

  const base = marketplaceBaseUrl();
  return interaction.reply({
    content: [
      "✅ **Your carry is in the shared Tavern queue.**",
      `🏰 **${dungeon}**`,
      `⚔️ **${difficulty}**`,
      `👥 **${runs}** run${runs === 1 ? "" : "s"}`,
      `🕒 **${availability}**`,
      `🎮 Roblox: **${profile.roblox_username}**`,
      `🍻 Smart match: **${matched}** available matching Carrier${matched === 1 ? "" : "s"} notified.`,
      `🆔 Request ID: \`${data.id}\``,
      "",
      `${active.length + 1}/${MAX_ACTIVE_REQUESTS} active request slots now in use.`,
      base ? `${base}/queue` : null,
    ].filter(Boolean).join("\n"),
    ephemeral: true,
  });
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isButton() && interaction.customId === START_ID) {
        return await startRequest(interaction);
      }

      if (interaction.isStringSelectMenu() && interaction.customId === DUNGEON_SELECT_ID) {
        return await chooseDungeon(interaction);
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(DIFFICULTY_SELECT_PREFIX)
      ) {
        return await chooseDifficulty(interaction);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX)) {
        return await submitRequest(interaction);
      }
    } catch (error) {
      console.error("[CARRY REQUEST PANEL V3]", error);
      const message = `❌ ${error.message || "Something went wrong while creating the carry request."}`;
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      }
      return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  },
};
