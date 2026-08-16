const db = require("../database/database");

function queueChannelId(guildId) {
  if (!guildId) return null;
  const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild = ?").get(guildId);
  return settings?.queueChannel || null;
}

function requestIdFromMessage(message) {
  for (const row of message.components || []) {
    for (const component of row.components || []) {
      const customId = component.customId || component.data?.custom_id || null;
      if (!customId) continue;
      const match = /^(?:claim|complete)_(\d+)$/.exec(customId);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

async function loadLiveLegacyQueue(client, guildId, { maxMessages = 500 } = {}) {
  if (!client || !guildId) return [];

  const channelId = queueChannelId(guildId);
  if (!channelId) return [];

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    throw new Error(`Configured queue channel ${channelId} is not a readable text channel.`);
  }

  const activeIds = new Set();
  let before;
  let scanned = 0;

  while (scanned < maxMessages) {
    const limit = Math.min(100, maxMessages - scanned);
    const options = before ? { limit, before } : { limit };
    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;

    for (const message of batch.values()) {
      const requestId = requestIdFromMessage(message);
      if (requestId != null) activeIds.add(requestId);
    }

    scanned += batch.size;
    const oldest = batch.last();
    before = oldest?.id;
    if (batch.size < limit || !before) break;
  }

  if (!activeIds.size) return [];

  const ids = [...activeIds];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`
    SELECT id, guild, user, roblox, dungeon, difficulty, runs, availability, carrier, status
    FROM queue
    WHERE guild = ?
      AND id IN (${placeholders})
      AND status IN ('waiting', 'claimed')
    ORDER BY id ASC
  `).all(guildId, ...ids);
}

module.exports = { loadLiveLegacyQueue, requestIdFromMessage };
