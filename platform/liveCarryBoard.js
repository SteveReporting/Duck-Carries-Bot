const { ChannelType } = require("discord.js");

const db = require("../database/database");
const { loadPlatformQueue } = require("./carryQueue");
const { buildPremiumQueuePayload } = require("./premiumQueueUi");

const LIVE_FOOTER = "The Carry Tavern • Live Carry Board";
const REFRESH_MS = 60_000;
let refreshTimer = null;
let refreshInFlight = false;

async function configuredQueueChannel(guild) {
  const configuredId = process.env.CARRY_QUEUE_CHANNEL_ID || process.env.QUEUE_CHANNEL_ID;
  if (configuredId) {
    const configured = await guild.channels.fetch(configuredId).catch(() => null);
    if (configured?.type === ChannelType.GuildText) return configured;
  }

  const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild = ?").get(guild.id);
  if (!settings?.queueChannel) return null;
  const channel = await guild.channels.fetch(settings.queueChannel).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function isLiveBoard(message, botId) {
  return Boolean(
    message?.author?.id === botId &&
    (message.embeds || []).some((embed) => String(embed.footer?.text || "") === LIVE_FOOTER),
  );
}

async function buildBoardPayload(guildId) {
  const rows = await loadPlatformQueue();
  const payload = buildPremiumQueuePayload(guildId, rows);
  const embed = payload.embeds?.[0];
  if (embed) {
    embed
      .setTitle("⚔️ Live Carry Board")
      .setFooter({ text: LIVE_FOOTER });
  }
  return payload;
}

async function ensureLiveCarryBoard(client) {
  if (refreshInFlight || !process.env.GUILD_ID) return null;
  refreshInFlight = true;

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
    if (!guild) return null;

    const channel = await configuredQueueChannel(guild);
    if (!channel) {
      console.warn("[LIVE CARRY BOARD] No configured queue text channel was found.");
      return null;
    }

    const payload = await buildBoardPayload(guild.id);
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const existing = messages?.find((message) => isLiveBoard(message, client.user.id)) || null;

    if (existing) {
      await existing.edit(payload);
      if (!existing.pinned) await existing.pin("Permanent Carry Tavern live queue").catch(() => {});
      return existing;
    }

    const board = await channel.send(payload);
    await board.pin("Permanent Carry Tavern live queue").catch(() => {});
    return board;
  } catch (error) {
    console.warn("[LIVE CARRY BOARD] Refresh failed:", error.message);
    return null;
  } finally {
    refreshInFlight = false;
  }
}

function startLiveCarryBoard(client) {
  void ensureLiveCarryBoard(client);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    void ensureLiveCarryBoard(client);
  }, REFRESH_MS);
  refreshTimer.unref?.();
}

module.exports = {
  LIVE_FOOTER,
  ensureLiveCarryBoard,
  startLiveCarryBoard,
};
