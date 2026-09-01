const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const {
  displayName,
  formatServiceMinutes,
  marketplaceBaseUrl,
  requireLinkedProfile,
} = require("../platform/helpers");
const roblox = require("./roblox");

async function profileCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const supabase = getSupabase();
  const [{ data: fullProfile }, { data: roles }, { data: carrier }, { data: achievements }] = await Promise.all([
    supabase.from("profiles")
      .select("roblox_username,roblox_display_name,roblox_verified_at,roblox_community_member,roblox_community_role")
      .eq("id", profile.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", profile.id),
    supabase.from("carrier_profiles")
      .select("carrier_rank,completed_carries,service_minutes")
      .eq("user_id", profile.id)
      .maybeSingle(),
    supabase.from("user_achievements")
      .select("achievement:achievements(name,icon)")
      .eq("user_id", profile.id)
      .limit(8),
  ]);

  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setTitle(`🍺 ${displayName(profile)}'s Tavern Profile`)
    .addFields(
      { name: "⚔️ Carries", value: String(profile.total_carries ?? 0), inline: true },
      { name: "⏱️ Service", value: formatServiceMinutes(profile.total_service_minutes ?? 0), inline: true },
      { name: "💰 Trades", value: String(profile.completed_trades ?? 0), inline: true },
      { name: "⭐ Trust", value: String(profile.trust_score ?? 100), inline: true },
      { name: "🎮 DQ Level", value: profile.dq_level == null ? "Not set" : String(profile.dq_level), inline: true },
      { name: "🛡️ Trader", value: profile.verified_trader ? "Verified" : "Standard", inline: true },
      { name: "Roles", value: roles?.length ? roles.map((r) => `\`${r.role}\``).join(" ") : "`member`" },
    );

  if (fullProfile?.roblox_username) {
    embed.addFields({
      name: "🟥 Roblox",
      value: `${fullProfile.roblox_display_name || fullProfile.roblox_username}${fullProfile.roblox_community_member ? ` · Tavern community${fullProfile.roblox_community_role ? ` (${fullProfile.roblox_community_role})` : ""}` : ""}`,
    });
  }
  if (carrier) {
    embed.addFields({
      name: "🍻 Carrier",
      value: `${carrier.carrier_rank} · ${carrier.completed_carries} carries · ${formatServiceMinutes(carrier.service_minutes)}`,
    });
  }
  if (achievements?.length) {
    embed.addFields({
      name: "🏅 Achievements",
      value: achievements.map((a) => `${a.achievement?.icon ?? "🏅"} ${a.achievement?.name ?? "Achievement"}`).join("\n"),
    });
  }
  if (base) embed.setURL(`${base}/profile/${profile.id}`);
  return interaction.editReply({ embeds: [embed] });
}

async function statusCommand(interaction) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("system_status")
    .select("service,status,message,last_heartbeat_at")
    .order("service");
  if (error) throw new Error(error.message);

  const now = Date.now();
  const lines = (data || []).map((row) => {
    let status = row.status;
    if (row.service === "discord_bot" && (!row.last_heartbeat_at || now - new Date(row.last_heartbeat_at).getTime() > 180_000)) status = "outage";
    const icon = status === "operational" ? "🟢" : status === "maintenance" ? "🟡" : status === "degraded" ? "🟠" : status === "outage" ? "🔴" : "⚪";
    return `${icon} **${row.service.replaceAll("_", " ")}** - ${status}`;
  });

  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setTitle("🍺 Carry Tavern Status")
    .setDescription(lines.length ? lines.join("\n") : "No platform status records are available.");
  if (base) embed.setURL(`${base}/status`);
  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tavern")
    .setDescription("Carry Tavern account and platform")
    .addSubcommand((s) => s.setName("profile").setDescription("View your linked Tavern profile"))
    .addSubcommand((s) => s.setName("status").setDescription("View platform status"))
    .addSubcommand((s) => s.setName("roblox-sync").setDescription("Sync your Roblox identity from Bloxlink"))
    .addSubcommand((s) => s
      .setName("roblox-profile")
      .setDescription("View a member's Roblox + Tavern profile")
      .addUserOption((o) => o.setName("user").setDescription("Member to view"))),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "profile") return await profileCommand(interaction);
      if (sub === "status") return await statusCommand(interaction);
      if (sub === "roblox-sync") return await roblox.syncCommand(interaction);
      return await roblox.profileCommand(interaction);
    } catch (error) {
      console.error("[TAVERN]", error);
      if (interaction.deferred || interaction.replied) return interaction.editReply(`❌ ${error.message || "Tavern request failed."}`);
      return interaction.reply({ content: "❌ Tavern request failed.", flags: MessageFlags.Ephemeral });
    }
  },
};
