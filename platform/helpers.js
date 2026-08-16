const { MessageFlags } = require("discord.js");
const { getSupabase } = require("../marketplace/supabase");

function marketplaceBaseUrl() {
  const value = (process.env.MARKETPLACE_URL || "").trim();
  return value ? value.replace(/\/+$/, "") : null;
}

async function getLinkedProfile(discordId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, discord_id, discord_username, discord_display_name, roblox_username, roblox_display_name, roblox_verified_at, dq_level, total_carries, total_service_minutes, completed_trades, trust_score, verified_trader")
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw new Error(`Could not load Tavern profile: ${error.message}`);
  return data;
}

async function requireLinkedProfile(interaction, { alreadyDeferred = false, requireRoblox = false } = {}) {
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    const base = marketplaceBaseUrl();
    const message = `❌ Your Discord account is not linked to a Tavern account.${base ? `\nSign in with Discord first: ${base}/auth` : ""}`;
    if (alreadyDeferred) await interaction.editReply(message);
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    return null;
  }
  if (requireRoblox && (!profile.roblox_verified_at || !profile.roblox_username)) {
    const message = "❌ Verify your Roblox account first with `/tavern link-roblox` and `/tavern verify-roblox`.";
    if (alreadyDeferred) await interaction.editReply(message);
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    return null;
  }
  return profile;
}

async function getPlatformRoles(profileId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", profileId);
  if (error) throw new Error(`Could not check Tavern roles: ${error.message}`);
  return (data || []).map((row) => row.role);
}

async function hasAnyPlatformRole(profileId, roles) {
  const current = await getPlatformRoles(profileId);
  return roles.some((role) => current.includes(role));
}

function displayName(profile) {
  return profile?.discord_display_name || profile?.discord_username || profile?.roblox_username || "Tavern member";
}

function formatServiceMinutes(total = 0) {
  const minutes = Number(total) || 0;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

module.exports = {
  displayName,
  formatServiceMinutes,
  getLinkedProfile,
  getPlatformRoles,
  hasAnyPlatformRole,
  marketplaceBaseUrl,
  requireLinkedProfile,
};
