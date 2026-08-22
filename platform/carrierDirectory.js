const { getSupabase } = require("../marketplace/supabase");

const DEFAULT_CARRIER_TEAM_ROLE_ID = "1538643501737058404";

function firstEnvironment(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return null;
}

function carrierTeamRoleId() {
  return firstEnvironment(
    "CARRIER_TEAM_ROLE_ID",
    "CARRIER_ROLE_TEAM",
    "CARRIER_ROLE_TEAM_ID",
    "VITE_CARRIER_TEAM_ROLE_ID",
  ) || DEFAULT_CARRIER_TEAM_ROLE_ID;
}

function configuredCarrierRankRoles() {
  return [
    ["Master of the Tap", firstEnvironment(
      "CARRIER_ROLE_MASTER_OF_TAP",
      "CARRIER_ROLE_MASTER_OF_TAP_ID",
      "VITE_CARRIER_ROLE_MASTER_OF_TAP",
      "VITE_CARRIER_ROLE_MASTER_OF_TAP_ID",
    )],
    ["Brewmaster", firstEnvironment(
      "CARRIER_ROLE_BREWMASTER",
      "CARRIER_ROLE_BREWMASTER_ID",
      "VITE_CARRIER_ROLE_BREWMASTER",
      "VITE_CARRIER_ROLE_BREWMASTER_ID",
    )],
    ["Tapmaster", firstEnvironment(
      "CARRIER_ROLE_TAPMASTER",
      "CARRIER_ROLE_TAPMASTER_ID",
      "VITE_CARRIER_ROLE_TAPMASTER",
      "VITE_CARRIER_ROLE_TAPMASTER_ID",
    )],
    ["Caskkeeper", firstEnvironment(
      "CARRIER_ROLE_CASKKEEPER",
      "CARRIER_ROLE_CASKKEEPER_ID",
      "VITE_CARRIER_ROLE_CASKKEEPER",
      "VITE_CARRIER_ROLE_CASKKEEPER_ID",
    )],
    ["Bartender", firstEnvironment(
      "CARRIER_ROLE_BARTENDER",
      "CARRIER_ROLE_BARTENDER_ID",
      "VITE_CARRIER_ROLE_BARTENDER",
      "VITE_CARRIER_ROLE_BARTENDER_ID",
    )],
    ["Barback", firstEnvironment(
      "CARRIER_ROLE_BARBACK",
      "CARRIER_ROLE_BARBACK_ID",
      "CARRIER_ROLE",
      "VITE_CARRIER_ROLE_BARBACK",
      "VITE_CARRIER_ROLE_BARBACK_ID",
    )],
  ];
}

async function resolvedCarrierRoles(guild) {
  await guild.roles.fetch();

  const teamId = carrierTeamRoleId();
  const roles = [];

  const teamRole = guild.roles.cache.get(teamId) || null;
  if (teamRole) {
    roles.push({ name: "Carrier Team", id: String(teamRole.id), rank: false });
  } else {
    console.warn(`[CARRIER DIRECTORY] Carrier Team role ${teamId} does not exist in ${guild.name}. Rank roles will still grant website Carrier access.`);
  }

  for (const [rankName, configuredId] of configuredCarrierRankRoles()) {
    let role = configuredId ? guild.roles.cache.get(String(configuredId)) : null;

    // IDs from env are authoritative. The exact-name fallback keeps access working
    // on older deployments where a rank ID has not yet been copied into env.
    if (!role && !configuredId) {
      role = guild.roles.cache.find((candidate) => candidate.name.toLowerCase() === rankName.toLowerCase()) || null;
    }

    if (configuredId && !role) {
      console.warn(`[CARRIER DIRECTORY] ${rankName} role ${configuredId} does not exist in ${guild.name}.`);
      continue;
    }

    if (role && !roles.some((entry) => entry.id === String(role.id))) {
      roles.push({ name: rankName, id: String(role.id), rank: true });
    }
  }

  return roles;
}

function rankForMember(member, carrierRoles) {
  const rankRole = carrierRoles.find((role) => role.rank && member.roles.cache.has(role.id));
  return rankRole?.name || "Carrier Team";
}

function carrierRoleDetails(member, carrierRoles) {
  return carrierRoles
    .filter((role) => member.roles.cache.has(role.id))
    .map((role) => ({ name: role.name, id: role.id }));
}

async function syncCarrierDirectory(client) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) return;

  const guild = await client.guilds.fetch(guildId);
  await guild.members.fetch();

  const carrierRoles = await resolvedCarrierRoles(guild);
  if (!carrierRoles.length) {
    console.warn(`[CARRIER DIRECTORY] No configured Carrier roles could be resolved in ${guild.name}.`);
    return;
  }

  const carrierRoleIds = new Set(carrierRoles.map((role) => role.id));
  const members = [...guild.members.cache.values()].filter(
    (member) =>
      !member.user.bot &&
      member.roles.cache.some((role) => carrierRoleIds.has(String(role.id))),
  );

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
    console.log(`[CARRIER DIRECTORY] No members currently have any configured Carrier role.`);
    return;
  }

  const payload = members.map((member) => {
    const matchedRoles = carrierRoleDetails(member, carrierRoles);
    return {
      discord_id: String(member.id),
      username: member.user.username,
      display_name: member.displayName || member.user.globalName || member.user.username,
      avatar_url: member.displayAvatarURL({ extension: "png", size: 256 }),
      carrier_rank: rankForMember(member, carrierRoles),
      role_ids: matchedRoles.map((role) => role.id),
      role_names: matchedRoles.map((role) => role.name),
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

  console.log(
    `[CARRIER DIRECTORY] Synced ${payload.length} member(s) with any Carrier role: ${carrierRoles.map((role) => `@${role.name}`).join(", ")}.`,
  );
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
