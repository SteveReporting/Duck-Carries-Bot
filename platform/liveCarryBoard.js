const { ChannelType } = require("discord.js");

const db = require("../database/database");
const { getGuildConfig, listConfiguredGuilds } = require("./guildConfig");
const { loadPlatformQueue } = require("./carryQueue");
const { buildQueueOverviewPayload } = require("./scalableQueueUi");

const LIVE_FOOTER = "The Carry Tavern • Live Carry Board";
const REFRESH_MS = 60_000;
const refreshTimers = new Map();
const refreshInFlight = new Set();

async function configuredQueueChannel(guild) {
  const config = getGuildConfig(guild.id);
  const configuredId = config?.queue_channel_id
    || (String(process.env.GUILD_ID || "") === String(guild.id)
      ? process.env.CARRY_QUEUE_CHANNEL_ID || process.env.QUEUE_CHANNEL_ID
      : null);

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
    message?.author?.id === botId
    && (message.embeds || []).some((embed) => String(embed.footer?.text || "") === LIVE_FOOTER),
  );
}

async function buildBoardPayload(guild) {
  const rows = await loadPlatformQueue();
  const payload = buildQueueOverviewPayload(guild.id, rows, guild);
  const embed = payload.embeds?.[0];
  if (embed) embed.setFooter({ text: LIVE_FOOTER });
  return payload;
}

async function resolveGuild(client, guildOverride = null) {
  if (guildOverride?.id) return guildOverride;
  const guildId = String(process.env.GUILD_ID || "").trim();
  if (!guildId) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function ensureLiveCarryBoard(client, guildOverride = null) {
  const guild = await resolveGuild(client, guildOverride);
  if (!guild || refreshInFlight.has(guild.id)) return null;
  refreshInFlight.add(guild.id);

  try {
    const channel = await configuredQueueChannel(guild);
    if (!channel) {
      console.warn(`[LIVE CARRY BOARD] No configured queue text channel was found in ${guild.name}.`);
      return null;
    }

    const payload = await buildBoardPayload(guild);
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const existing = messages?.find((message) => isLiveBoard(message, client.user.id)) || null;

    if (existing) {
      await existing.edit(payload);
      if (!existing.pinned) await existing.pin("Permanent compact live carry board").catch(() => {});
      return existing;
    }

    const board = await channel.send(payload);
    await board.pin("Permanent compact live carry board").catch(() => {});
    return board;
  } catch (error) {
    console.warn(`[LIVE CARRY BOARD] ${guild.name}:`, error.message);
    return null;
  } finally {
    refreshInFlight.delete(guild.id);
  }
}

function startGuildBoardTimer(client, guild) {
  if (!guild?.id || refreshTimers.has(guild.id)) return;
  void ensureLiveCarryBoard(client, guild);
  const timer = setInterval(() => {
    void ensureLiveCarryBoard(client, guild);
  }, REFRESH_MS);
  timer.unref?.();
  refreshTimers.set(guild.id, timer);
}

function startLiveCarryBoard(client) {
  const configured = listConfiguredGuilds();
  let started = 0;
  for (const config of configured) {
    const guild = client.guilds.cache.get(String(config.guild));
    if (!guild) continue;
    startGuildBoardTimer(client, guild);
    started += 1;
  }

  if (!started && process.env.GUILD_ID) {
    const guild = client.guilds.cache.get(String(process.env.GUILD_ID));
    if (guild) startGuildBoardTimer(client, guild);
  }
}

module.exports = {
  LIVE_FOOTER,
  buildBoardPayload,
  configuredQueueChannel,
  ensureLiveCarryBoard,
  startGuildBoardTimer,
  startLiveCarryBoard,
};
