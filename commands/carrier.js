const {
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

function statusText(status) {
  if (!status?.available) return "🔴 Unavailable";
  if (status.session_dungeon) {
    return `🟣 Session: ${status.session_dungeon} • ${status.session_difficulty || "Any difficulty"}`;
  }
  return "🟢 Available for matching";
}

async function availableCommand(interaction, available) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;
  const state = setCarrierAvailability(interaction.guildId, interaction.user.id, available);
  return interaction.editReply(available
    ? "🟢 You are now **available**. Matching carry requests can be sent to your DMs."
    : "🔴 You are now **unavailable** and any active Carrier session was ended.");
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
  return interaction.editReply([
    `🟣 **Carrier session started: ${state.session_dungeon} • ${state.session_difficulty}**`,
    "You are automatically marked available.",
    "New matching requests will be prioritised to you through smart-match DMs.",
    "Use `/carrier session-end` when you finish carrying.",
  ].join("\n"));
}

async function sessionEnd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;
  const keep = interaction.options.getBoolean("stay_available") ?? false;
  stopCarrierSession(interaction.guildId, interaction.user.id, keep);
  return interaction.editReply(keep
    ? "✅ Carrier session ended. You are still marked **available** for other matching carries."
    : "✅ Carrier session ended and you are now **unavailable**.");
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
    const { data } = await supabase.from("carrier_profiles")
      .select("carrier_rank,completed_carries,service_minutes,active,quality_score")
      .eq("user_id", profile.id)
      .maybeSingle();
    carrier = data || null;
  }

  const rating = reputation.ratings
    ? `⭐ **${reputation.average}/5** from ${reputation.ratings} rating${reputation.ratings === 1 ? "" : "s"}`
    : "⭐ No ratings yet";
  const scope = permissions.length
    ? permissions.slice(0, 12).map((p) => `${p.allowed ? "✅" : "❌"} ${p.dungeon}${p.difficulty === "*" ? "" : ` • ${p.difficulty}`}`).join("\n")
    : "✅ Unrestricted (no staff scope configured)";

  const embed = new EmbedBuilder()
    .setTitle(`🍻 Carrier Profile • ${target.username}`)
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
    .setDescription([statusText(state), rating].join("\n"))
    .addFields(
      { name: "Carrier Rank", value: carrier?.carrier_rank || "Not registered", inline: true },
      { name: "Completed Runs", value: String(carrier?.completed_carries ?? 0), inline: true },
      { name: "Service Time", value: `${Math.floor(Number(carrier?.service_minutes || 0) / 60)}h ${Number(carrier?.service_minutes || 0) % 60}m`, inline: true },
      { name: "5-Star Ratings", value: String(reputation.fiveStar), inline: true },
      { name: "No-Shows (30d)", value: String(noShows.carrier), inline: true },
      { name: "Dungeon Permissions", value: scope.slice(0, 1024) },
    )
    .setFooter({ text: "Reputation is generated from completed Carry Tavern carry ratings." });

  if (reputation.recent.length) {
    embed.addFields({
      name: "Recent Feedback",
      value: reputation.recent.map((r) => `${"⭐".repeat(r.score)}${r.note ? ` • ${r.note}` : ""}`).join("\n").slice(0, 1024),
    });
  }
  return interaction.editReply({ embeds: [embed] });
}

async function statusCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;
  const state = getCarrierStatus(interaction.guildId, interaction.user.id);
  return interaction.editReply(`Your Carrier status: **${statusText(state)}**`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier")
    .setDescription("Carrier availability, sessions and reputation")
    .addSubcommand((s) => s.setName("available").setDescription("Mark yourself available for smart carry matching"))
    .addSubcommand((s) => s.setName("unavailable").setDescription("Stop receiving smart carry matches"))
    .addSubcommand((s) => s.setName("status").setDescription("Check your Carrier availability/session"))
    .addSubcommand((s) => s.setName("session-start").setDescription("Start carrying one dungeon and difficulty")
      .addStringOption((o) => o.setName("dungeon").setDescription("Dungeon").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("difficulty").setDescription("Difficulty").setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName("session-end").setDescription("End your current Carrier session")
      .addBooleanOption((o) => o.setName("stay_available").setDescription("Stay available for other dungeons after ending the session")))
    .addSubcommand((s) => s.setName("profile").setDescription("View Carrier reputation and permissions")
      .addUserOption((o) => o.setName("user").setDescription("Carrier to view"))),

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
      return interaction.respond(DIFFICULTIES.filter((d) => d.toLowerCase().includes(typed)).slice(0, 25).map((d) => ({ name: d, value: d })));
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "available") return availableCommand(interaction, true);
      if (sub === "unavailable") return availableCommand(interaction, false);
      if (sub === "session-start") return sessionStart(interaction);
      if (sub === "session-end") return sessionEnd(interaction);
      if (sub === "profile") return profileCommand(interaction);
      return statusCommand(interaction);
    } catch (error) {
      console.error("[CARRIER]", error);
      const text = `❌ ${error.message || "Carrier command failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(text);
      return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  },
};
