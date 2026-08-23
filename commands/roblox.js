const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, requireLinkedProfile } = require("../platform/helpers");
const { carrierReputation, tradeReputation } = require("../platform/communitySystems");

async function syncCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, {
    alreadyDeferred: true,
    requireRoblox: true,
  });
  if (!profile) return;

  return interaction.editReply([
    "✅ **Roblox account synced from Bloxlink.**",
    `🎮 Username: **@${profile.roblox_username}**`,
    profile.roblox_display_name ? `🪪 Display name: **${profile.roblox_display_name}**` : null,
    "The Carry Tavern no longer uses its own Roblox verification flow.",
  ].filter(Boolean).join("\n"));
}

async function profileCommand(interaction) {
  await interaction.deferReply();
  const target = interaction.options.getUser("user") || interaction.user;

  let linked;
  if (target.id === interaction.user.id) {
    linked = await requireLinkedProfile(interaction, {
      alreadyDeferred: true,
      requireRoblox: true,
    });
    if (!linked) return;
  } else {
    linked = await getLinkedProfile(target.id).catch(() => null);
    if (!linked) return interaction.editReply(`❌ ${target} does not have a linked Carry Tavern profile.`);
  }

  const supabase = getSupabase();
  const [{ data: profile, error }, { data: carrier }] = await Promise.all([
    supabase.from("profiles")
      .select("id,roblox_username,roblox_user_id,roblox_display_name,roblox_avatar_url,roblox_verified_at,roblox_account_created_at,roblox_community_member,roblox_community_role,dq_level,total_carries,total_service_minutes,trust_score,completed_trades,verified_trader")
      .eq("id", linked.id)
      .maybeSingle(),
    supabase.from("carrier_profiles")
      .select("carrier_rank,completed_carries,service_minutes,active")
      .eq("user_id", linked.id)
      .maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (!profile) return interaction.editReply("❌ Tavern profile details could not be loaded.");

  const carryRep = carrierReputation(target.id, interaction.guildId);
  const tradeRep = tradeReputation(interaction.guildId, target.id);
  const created = profile.roblox_account_created_at
    ? `<t:${Math.floor(new Date(profile.roblox_account_created_at).getTime() / 1000)}:D>`
    : "Unknown";

  const embed = new EmbedBuilder()
    .setTitle(`🟥 Roblox Profile • ${profile.roblox_display_name || profile.roblox_username || target.username}`)
    .setDescription(profile.roblox_username
      ? `**@${profile.roblox_username}** • 🔗 Bloxlink`
      : "No Bloxlink Roblox account has been synced yet.")
    .setThumbnail(profile.roblox_avatar_url || target.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Roblox User ID", value: profile.roblox_user_id || "Unknown", inline: true },
      { name: "Account Created", value: created, inline: true },
      { name: "DQ Level", value: profile.dq_level == null ? "Not set" : String(profile.dq_level), inline: true },
      { name: "Tavern Roblox Group", value: profile.roblox_community_member ? `✅ Member${profile.roblox_community_role ? ` • ${profile.roblox_community_role}` : ""}` : "Not synced", inline: false },
      { name: "Carrier", value: carrier?.active ? `${carrier.carrier_rank} • ${carrier.completed_carries} completed runs` : "Not an active Carrier", inline: true },
      { name: "Carry Rating", value: carryRep.ratings ? `⭐ ${carryRep.average}/5 (${carryRep.ratings})` : "No ratings", inline: true },
      { name: "Trade Rating", value: tradeRep.ratings ? `⭐ ${tradeRep.average}/5 (${tradeRep.ratings})` : "No ratings", inline: true },
      { name: "Trust", value: `${profile.trust_score ?? 100}${profile.verified_trader ? " • Verified Trader" : ""}`, inline: true },
      { name: "Service", value: `${profile.total_carries ?? 0} runs • ${Math.floor(Number(profile.total_service_minutes || 0) / 60)}h ${Number(profile.total_service_minutes || 0) % 60}m`, inline: true },
      { name: "Trades", value: String(profile.completed_trades ?? 0), inline: true },
    )
    .setFooter({ text: "Roblox identity is resolved through Bloxlink. Carry Tavern does not run a separate Roblox verification." });

  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("View or sync Roblox accounts through Bloxlink")
    .addSubcommand((sub) => sub
      .setName("sync")
      .setDescription("Sync your Roblox username from Bloxlink"))
    .addSubcommand((sub) => sub
      .setName("profile")
      .setDescription("View a member's Roblox + Tavern profile card")
      .addUserOption((option) => option.setName("user").setDescription("Member to view"))),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "sync") return await syncCommand(interaction);
      return await profileCommand(interaction);
    } catch (error) {
      console.error("[ROBLOX]", error);
      const message = `❌ ${error.message || "Roblox request failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(message);
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  },
};
