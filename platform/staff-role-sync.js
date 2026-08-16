const { getSupabase } = require("../marketplace/supabase");

let timer = null;

function configuredMappings() {
  return [
    ["treasury", process.env.PLATFORM_DISCORD_ROLE_TREASURY],
    ["moderator", process.env.PLATFORM_DISCORD_ROLE_MODERATOR],
    ["administrator", process.env.PLATFORM_DISCORD_ROLE_ADMINISTRATOR],
  ].filter(([, roleId]) => Boolean(roleId));
}

async function syncStaffRoles(client) {
  const mappings = configuredMappings();
  if (!mappings.length || !process.env.GUILD_ID) return;

  const supabase = getSupabase();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,discord_id")
    .not("discord_id", "is", null)
    .limit(5000);
  if (error) throw new Error(`Could not load Tavern members for Discord role sync: ${error.message}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  for (const profile of profiles || []) {
    let member;
    try {
      member = await guild.members.fetch(profile.discord_id);
    } catch {
      // User is not in the configured Tavern guild. Configured Discord-backed roles
      // must not remain active when the member leaves the server.
      for (const [platformRole] of mappings) {
        await supabase.from("user_roles").delete().eq("user_id", profile.id).eq("role", platformRole);
      }
      continue;
    }

    for (const [platformRole, discordRoleId] of mappings) {
      const shouldHave = member.roles.cache.has(discordRoleId);
      const { data: existing, error: readError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", profile.id)
        .eq("role", platformRole)
        .maybeSingle();
      if (readError) throw readError;

      if (shouldHave && !existing) {
        const { error: insertError } = await supabase.from("user_roles").insert({
          user_id: profile.id,
          role: platformRole,
          granted_by: null,
        });
        if (insertError) throw insertError;
      } else if (!shouldHave && existing) {
        const { error: deleteError } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", profile.id)
          .eq("role", platformRole);
        if (deleteError) throw deleteError;
      }
    }
  }
}

async function tick(client) {
  try {
    await syncStaffRoles(client);
  } catch (error) {
    console.error("[STAFF ROLE SYNC]", error);
  }
}

function startStaffRoleSync(client) {
  if (timer || !configuredMappings().length) return;
  void tick(client);
  timer = setInterval(() => void tick(client), 5 * 60_000);
  timer.unref?.();
}

module.exports = { startStaffRoleSync, syncStaffRoles };
