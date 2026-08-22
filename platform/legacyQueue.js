const db = require("../database/database");

const LEGACY_RETENTION_MS = 24 * 60 * 60 * 1000;

function queueChannelId(guildId) {
  if (!guildId) return null;
  const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild = ?").get(guildId);
  return settings?.queueChannel || null;
}

/**
 * Load only live legacy carry rows. Anything older than 24 hours is ignored here
 * immediately, even before the cleanup worker physically deletes it.
 */
async function loadLiveLegacyQueue(_client, guildId) {
  if (!guildId) return [];

  const cutoff = Date.now() - LEGACY_RETENTION_MS;
  return db.prepare(`
    SELECT
      id,
      guild,
      user,
      roblox,
      dungeon,
      difficulty,
      runs,
      availability,
      carrier,
      status,
      created_at
    FROM queue
    WHERE guild = ?
      AND status IN ('waiting', 'claimed')
      AND created_at IS NOT NULL
      AND created_at >= ?
    ORDER BY id ASC
  `).all(guildId, cutoff);
}

module.exports = { loadLiveLegacyQueue, queueChannelId };
