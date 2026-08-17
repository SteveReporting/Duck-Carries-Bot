const { getSupabase } = require("../marketplace/supabase");

const DEFAULT_CARRIER_TEAM_ROLE_ID = "1538643501737058404";

function carrierTeamRoleId() {
  return process.env.CARRIER_TEAM_ROLE_ID || DEFAULT_CARRIER_TEAM_ROLE_ID;
}

function carrierRankRoles() {
  return [
    ["Master of the Tap", process.env.CARRIER_ROLE_MASTER_OF_TAP],
    ["Brewmaster", process.env.CARRIER_ROLE_BREWMASTER],
    ["Tapmaster", process.env.CARRIER_ROLE_TAPMASTER],
    ["Caskkeeper", process.env.CARRIER_ROLE_CASKKEEPER],
    ["Bartender", process.env.CARRIER_ROLE_BARTENDER],
    ["Barback", process.env.CARRIER_ROLE_BARBACK || process.env.CARRIER_ROLE],
  ].filter(([, id]) => Boolean(id));
}

function rankForMember(member) {
  return carrierRankRoles().find(([, roleId]) => member.roles.cache.has(roleId))?.[0] || "Carrier Team";
}

function carrierRoleDetails(member) {
  return carrierRankRoles()
    .filter(([, roleId]) => member.roles.cache.has(roleId))
    .map(([name, roleId]) => ({ name, id: String(roleId) }));
}

async function syncCarrierDirectory(client) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) return;

  const guild = await client.guilds.fetch(guildId);
  await guild.members.fetch();

  const teamRoleId = carrierTeamRoleId();
  const teamRole = guild.roles.cache.get(teamRoleId) || await guild.roles.fetch(teamRoleId).catch(() => null);
  if (!teamRole) {
    console.warn(`[CARRIER DIRECTORY] Carrier Team role ${teamRoleId} does not exist in ${guild.name}.`);
    return;
  }

  const members = [...guild.members.cache.values()]
    .filter((member) => !member.user.bot && member.roles.cache.has(teamRoleId));

  const supabase = getSupabase();
  const discordIds = members.map((member) => String(member.id));
  const profileByDiscord = new Map();

  if (discordIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id,discord_id")
      .in("discord_id", discordIds);
    if (profileError) throw profileError;
    for (const profile of profiles || []) {
      if (profile.discord_id) profileByDiscord.set(String(profile.discord_id), profile.id);
    }
  }

  const now = new Date().toISOString();

  const { error: deactivateError } = await supabase
    .from("discord_carrier_directory")
    .update({ active: false, synced_at: now })
    .eq("active", true);
  if (deactivateError) throw new Error(`Carrier directory deactivate failed: ${deactivateError.message}`);

  if (!members.length) {
    console.log(`[CARRIER DIRECTORY] No members currently have @${teamRole.name}.`);
    return;
  }

  const payload = members.map((member) => {
    const rankRoles = carrierRoleDetails(member);
    return {
      discord_id: String(member.id),
      username: member.user.username,
      display_name: member.displayName || member.user.globalName || member.user.username,
      avatar_url: member.displayAvatarURL({ extension: "png", size: 256 }),
      carrier_rank: rankForMember(member),
      role_ids: [teamRoleId, ...rankRoles.map((role) => role.id)],
      role_names: [teamRole.name, ...rankRoles.map((role) => role.name)],
      profile_id: profileByDiscord.get(String(member.id)) || null,
      joined_at: member.joinedAt ? member.joinedAt.toISOString() : null,
      active: true,
      synced_at: now,
    };
  });

  const { error: upsertError } = await supabase
    .from("discord_carrier_directory")
    .upsert(payload, { onConflict: "discord_id" });
  if (upsertError) throw new Error(`Carrier directory sync failed: ${upsertError.message}`);

  console.log(`[CARRIER DIRECTORY] Synced ${payload.length} member(s) from @${teamRole.name}.`);
}

let timer = null;

function startCarrierDirectorySync(client) {
  if (timer) return;

  const run = async () => {
    try {
      await syncCarrierDirectory(client);
    } catch (error) {
      console.error("[CARRIER DIRECTORY]", error);
    }
  };

  void run();
  timer = setInterval(() => void run(), 60_000);
  timer.unref?.();
}

module.exports = {
  carrierTeamRoleId,
  syncCarrierDirectory,
  startCarrierDirectorySync,
};
