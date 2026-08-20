const db = require("../database/database");

function queueChannelId(guildId) {
  if (!guildId) return null;
  const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild = ?").get(guildId);
  return settings?.queueChannel || null;
}

/**
 * Load the live carry queue directly from the bot's SQLite database.
 *
 * SQLite is the source of truth for the legacy Discord queue. Do not infer
 * active requests by scanning Discord messages: messages can be deleted,
 * pushed beyond fetch limits, or have their component layout changed while
 * the queue row is still valid.
 */
async function loadLiveLegacyQueue(_client, guildId) {
  if (!guildId) return [];

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
    ORDER BY id ASC
  `).all(guildId);
}

module.exports = { loadLiveLegacyQueue, queueChannelId };
