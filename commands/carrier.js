const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { requireCarrierProfile } = require("../platform/carryQueue");
const { DUNGEONS, canonicalizeDungeon, canonicalizeDifficulty } = require("../platform/dungeons");
const { getLinkedProfile } = require("../platform/helpers");
const {
  carrierCanHandle,
  carrierReputation,
  getCarrierStatus,
  listCarrierPermissions,
  noShowSummary,
  setCarrierAvailability,
  startCarrierSession,
  stopCarrierSession,
} = require("../platform/communitySystems");

const DIFFICULTIES = ["Easy", "Medium", "Hard", "Insane", "Insane Hardcore", "Nightmare", "Nightmare Hardcore"];
const GOLD = 0xf2b705;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const PURPLE = 0x9b59b6;
const FOOTER = "The Carry Tavern • Carrier Desk";

function statusText(status) {
  if (!status?.available) return "🔴 Unavailable";
  if (status.session_dungeon) {
    return `🟣 Focused Session • ${status.session_dungeon} • ${status.session_difficulty || "Any difficulty"}`;
  }
  return "🟢 Available for smart matching";
}

function carrierActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("premium_queue_open")
      .setLabel("Live Queue")
      .setEmoji("⚔️")
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
      .setStyle(ButtonStyle.Secondary),
  );
}

function stateEmbed({ title, description, color = GOLD }) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER DESK" })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

async function availableCommand(interaction, available) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  setCarrierAvailability(interaction.guildId, interaction.user.id, available);

  const embed = available
    ? stateEmbed({
        title: "🟢 You’re Available",
        color: GREEN,
        description: [
          "Smart matching is now active for your Carrier profile.",
          "",
          "Compatible carry requests can be sent to you automatically, or you can open the live queue and claim a group immediately.",
        ].join("\n"),
      })
    : stateEmbed({
        title: "🔴 You’re Unavailable",
        color: RED,
        description: "Smart-match notifications are paused and any focused Carrier session has been ended.",
      });

  return interaction.editReply({ embeds: [embed], components: [carrierActions()] });
}

async function sessionStart(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const dungeon = canonicalizeDungeon(interaction.options.getString("dungeon", true));
  const difficulty = canonicalizeDifficulty(interaction.options.getString("difficulty") || "Nightmare");
  if (!carrierCanHandle(interaction.guildId, interaction.user.id, dungeon, difficulty)) {
    return interaction.editReply(`❌ Your Carrier permissions do not allow **${dungeon} • ${difficulty}**.`);
  }

  const state = startCarrierSession(interaction.guildId, interaction.user.id, dungeon, difficulty);
  const embed = stateEmbed({
    title: "🟣 Focused Session Started",
    color: PURPLE,
    description: [
      `### ${state.session_dungeon} • ${state.session_difficulty}`,
      "You are now automatically **available** and matching requests for this session are prioritised to you.",
      "",
      "Open the live queue below whenever you’re ready to claim the next compatible group.",
    ].join("\n"),
  });

  return interaction.editReply({ embeds: [embed], components: [carrierActions()] });
}

async function sessionEnd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const keep = interaction.options.getBoolean("stay_available") ?? false;
  stopCarrierSession(interaction.guildId, interaction.user.id, keep);

  const embed = stateEmbed({
    title: "✅ Focused Session Ended",
    color: keep ? GREEN : GOLD,
    description: keep
      ? "The dungeon-specific session is closed, but you are still **available** for other compatible carries."
      : "The dungeon-specific session is closed and you are now **unavailable** for new matches.",
  });

  return interaction.editReply({ embeds: [embed], components: [carrierActions()] });
}

async function profileCommand(interaction) {
  await interaction.deferReply();
  const target = interaction.options.getUser("user") || interaction.user;
  const profile = await getLinkedProfile(target.id).catch(() => null);
  const state = getCarrierStatus(interaction.guildId, target.id);
  const reputation = carrierReputation(target.id, interaction.guildId);
  const noShows = noShowSummary(interaction.guildId, target.id);
  const permissions = listCarrierPermissions(interaction.guildId, target.id);

  let carrier = null;
  if (profile) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("carrier_profiles")
      .select("carrier_rank,completed_carries,service_minutes,active,quality_score")
      .eq("user_id", profile.id)
      .maybeSingle();
    carrier = data || null;
  }

  const rating = reputation.ratings
    ? `⭐ **${reputation.average}/5** • ${reputation.ratings} rating${reputation.ratings === 1 ? "" : "s"}`
    : "⭐ **New Carrier** • no ratings yet";

  const scope = permissions.length
    ? permissions
        .slice(0, 12)
        .map((permission) => `${permission.allowed ? "✅" : "❌"} ${permission.dungeon}${permission.difficulty === "*" ? "" : ` • ${permission.difficulty}`}`)
        .join("\n")
    : "✅ All compatible dungeons • no custom restriction";

  const serviceMinutes = Number(carrier?.service_minutes || 0);
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER PROFILE" })
    .setTitle(`🍻 ${target.globalName || target.username}`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setDescription([statusText(state), rating].join("\n"))
    .addFields(
      { name: "🏅 Rank", value: carrier?.carrier_rank || "Not registered", inline: true },
      { name: "⚔️ Completed", value: `**${carrier?.completed_carries ?? 0}** runs`, inline: true },
      { name: "⏱️ Service", value: `**${Math.floor(serviceMinutes / 60)}h ${serviceMinutes % 60}m**`, inline: true },
      { name: "⭐ 5-Star", value: `**${reputation.fiveStar}** ratings`, inline: true },
      { name: "🚫 No-Shows • 30d", value: `**${noShows.carrier}**`, inline: true },
      { name: "📈 Quality", value: carrier?.quality_score == null ? "—" : `**${carrier.quality_score}**`, inline: true },
      { name: "🗺️ Carry Permissions", value: scope.slice(0, 1024), inline: false },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (reputation.recent.length) {
    embed.addFields({
      name: "💬 Recent Feedback",
      value: reputation.recent
        .map((entry) => `${"⭐".repeat(entry.score)}${entry.note ? ` • ${entry.note}` : ""}`)
        .join("\n")
        .slice(0, 1024),
      inline: false,
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function statusCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const state = getCarrierStatus(interaction.guildId, interaction.user.id);
  const embed = stateEmbed({
    title: "🍻 Carrier Status",
    color: state?.available ? GREEN : RED,
    description: [
      `### ${statusText(state)}`,
      state?.available
        ? "You can receive compatible smart-match requests right now."
        : "You will not receive new smart-match requests until you mark yourself available.",
    ].join("\n"),
  });

  return interaction.editReply({ embeds: [embed], components: [carrierActions()] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier")
    .setDescription("Carrier Desk • availability, sessions and reputation")
    .addSubcommand((subcommand) => subcommand.setName("available").setDescription("Go available for smart carry matching"))
    .addSubcommand((subcommand) => subcommand.setName("unavailable").setDescription("Pause smart matching and focused sessions"))
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Open your Carrier status card"))
    .addSubcommand((subcommand) => subcommand
      .setName("session-start")
      .setDescription("Focus smart matching on one dungeon and difficulty")
      .addStringOption((option) => option.setName("dungeon").setDescription("Dungeon").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("difficulty").setDescription("Difficulty").setRequired(true).setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("session-end")
      .setDescription("End your focused Carrier session")
      .addBooleanOption((option) => option.setName("stay_available").setDescription("Remain available for other carries")))
    .addSubcommand((subcommand) => subcommand
      .setName("profile")
      .setDescription("View a Carrier’s reputation and permissions")
      .addUserOption((option) => option.setName("user").setDescription("Carrier to view"))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value || "").toLowerCase();

    if (focused.name === "dungeon") {
      const choices = DUNGEONS
        .filter((dungeon) => dungeon.name.toLowerCase().includes(typed) || dungeon.aliases.some((alias) => alias.includes(typed)))
        .slice(0, 25)
        .map((dungeon) => ({ name: dungeon.name, value: dungeon.name }));
      return interaction.respond(choices);
    }

    if (focused.name === "difficulty") {
      return interaction.respond(
        DIFFICULTIES
          .filter((difficulty) => difficulty.toLowerCase().includes(typed))
          .slice(0, 25)
          .map((difficulty) => ({ name: difficulty, value: difficulty })),
      );
    }

    return interaction.respond([]);
  },

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "available") return availableCommand(interaction, true);
      if (subcommand === "unavailable") return availableCommand(interaction, false);
      if (subcommand === "session-start") return sessionStart(interaction);
      if (subcommand === "session-end") return sessionEnd(interaction);
      if (subcommand === "profile") return profileCommand(interaction);
      return statusCommand(interaction);
    } catch (error) {
      console.error("[CARRIER]", error);
      const text = `❌ ${error.message || "Carrier command failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply({ content: text, embeds: [], components: [] });
      return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  },
};
