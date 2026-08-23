const { MessageFlags } = require("discord.js");
const { getSupabase } = require("../marketplace/supabase");
const { getBloxlinkRobloxAccount } = require("./bloxlink");

function marketplaceBaseUrl() {
  const value = (process.env.MARKETPLACE_URL || "").trim();
  return value ? value.replace(/\/+$/, "") : null;
}

async function getLinkedProfile(discordId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, discord_id, discord_username, discord_display_name, roblox_username, roblox_user_id, roblox_display_name, roblox_verified_at, roblox_account_created_at, dq_level, total_carries, total_service_minutes, completed_trades, trust_score, verified_trader")
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw new Error(`Could not load Tavern profile: ${error.message}`);
  return data;
}

async function sendProfileRequirement(interaction, alreadyDeferred, message) {
  if (alreadyDeferred) await interaction.editReply(message);
  else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

async function syncRobloxFromBloxlink(interaction, profile) {
  const account = await getBloxlinkRobloxAccount(interaction.guildId, interaction.user.id);
  if (!account) return null;

  const verifiedAt = new Date().toISOString();
  const supabase = getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({
      roblox_username: account.username,
      roblox_user_id: account.id,
      roblox_display_name: account.displayName,
      roblox_verified_at: verifiedAt,
      roblox_account_created_at: account.createdAt,
    })
    .eq("id", profile.id);

  if (error) {
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      throw new Error("That Bloxlink Roblox account is already attached to another Tavern profile.");
    }
    throw new Error(`Could not sync Bloxlink Roblox account: ${error.message}`);
  }

  return {
    ...profile,
    roblox_username: account.username,
    roblox_user_id: account.id,
    roblox_display_name: account.displayName,
    roblox_verified_at: verifiedAt,
    roblox_account_created_at: account.createdAt,
  };
}

async function requireLinkedProfile(interaction, { alreadyDeferred = false, requireRoblox = false } = {}) {
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    const base = marketplaceBaseUrl();
    const message = `❌ Your Discord account is not linked to a Tavern account.${base ? `\nSign in with Discord first: ${base}/auth` : ""}`;
    await sendProfileRequirement(interaction, alreadyDeferred, message);
    return null;
  }

  if (requireRoblox) {
    const synced = await syncRobloxFromBloxlink(interaction, profile);
    if (!synced) {
      await sendProfileRequirement(
        interaction,
        alreadyDeferred,
        "❌ Bloxlink could not find a Roblox account linked to your Discord account in this server. Use Bloxlink to link your Roblox account, then try again. The Carry Tavern no longer has a separate Roblox verification step.",
      );
      return null;
    }
    return synced;
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
  syncRobloxFromBloxlink,
};
