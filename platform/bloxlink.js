const { getRobloxAccount } = require("./robloxAccounts");

function bloxlinkApiKey() {
  return String(process.env.BLOXLINK_API_KEY || "").trim();
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getBloxlinkRobloxAccount(guildId, discordId) {
  const key = bloxlinkApiKey();
  if (!key) {
    throw new Error("Bloxlink is not configured yet. Add BLOXLINK_API_KEY to the bot's .env and restart it.");
  }
  if (!guildId) throw new Error("Bloxlink lookup must be used inside The Carry Tavern server.");

  const url = `https://api.blox.link/v4/public/guilds/${encodeURIComponent(String(guildId))}/discord-to-roblox/${encodeURIComponent(String(discordId))}`;
  const response = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 404) return null;

  const body = await readJsonSafe(response);
  if (!response.ok) {
    const detail = body?.error || body?.message || `HTTP ${response.status}`;
    throw new Error(`Bloxlink lookup failed: ${detail}`);
  }

  const robloxId = String(body?.robloxID || "").trim();
  if (!/^\d+$/.test(robloxId)) {
    throw new Error("Bloxlink returned an invalid Roblox account ID.");
  }

  const account = await getRobloxAccount(robloxId);
  if (!account?.id || !account?.name) {
    throw new Error("Roblox could not load the account returned by Bloxlink.");
  }

  return {
    id: String(account.id),
    username: account.name,
    displayName: account.displayName || account.name,
    createdAt: account.created || null,
  };
}

module.exports = {
  getBloxlinkRobloxAccount,
};
