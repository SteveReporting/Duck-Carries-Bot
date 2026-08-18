const { getSupabase } = require("../marketplace/supabase");
const { syncVerifiedMember } = require("./robloxAccounts");

let timer = null;
let lastVerifiedAt = "1970-01-01T00:00:00.000Z";

async function syncNewRobloxVerifications(client) {
  if (!process.env.GUILD_ID) return;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,discord_id,roblox_username,roblox_verified_at")
    .not("discord_id", "is", null)
    .not("roblox_username", "is", null)
    .gt("roblox_verified_at", lastVerifiedAt)
    .order("roblox_verified_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  if (!data?.length) return;

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  let newest = lastVerifiedAt;
  let synced = 0;

  for (const profile of data) {
    if (profile.roblox_verified_at && profile.roblox_verified_at > newest) {
      newest = profile.roblox_verified_at;
    }
    if (!profile.discord_id) continue;

    try {
      const member = await guild.members.fetch(profile.discord_id);
      await syncVerifiedMember(member, profile);
      synced += 1;
    } catch (error) {
      console.warn(`[ROBLOX GAME SYNC] ${profile.discord_id}:`, error.message);
    }
  }

  lastVerifiedAt = newest;
  if (synced) {
    console.log(`[ROBLOX GAME SYNC] Synced ${synced} verified Roblox account(s) to Discord.`);
  }
}

function startRobloxVerificationSync(client) {
  if (timer) return;
  void syncNewRobloxVerifications(client).catch((error) => {
    console.warn("[ROBLOX GAME SYNC] Initial sync failed:", error.message);
  });
  timer = setInterval(() => {
    void syncNewRobloxVerifications(client).catch((error) => {
      console.warn("[ROBLOX GAME SYNC] Poll failed:", error.message);
    });
  }, 60_000);
  timer.unref?.();
}

module.exports = { startRobloxVerificationSync, syncNewRobloxVerifications };
