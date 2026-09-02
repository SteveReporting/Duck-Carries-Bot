const DISCORD_API = "https://discord.com/api/v10";

const DEFAULT_KEYWORD = "PURPLE COLLECT/T3";
const DEFAULT_RESULT_MESSAGES = 3;
const CURRENT_CHANNEL_SCAN_PAGES = 50;
const LIKELY_CHANNEL_SCAN_PAGES = 20;
const FALLBACK_CHANNEL_SCAN_PAGES = 3;
const MAX_RATE_LIMIT_RETRIES = 8;

const PERMISSIONS = {
  VIEW_CHANNEL: 1024,
  SEND_MESSAGES: 2048,
  EMBED_LINKS: 16384,
  ATTACH_FILES: 32768,
  READ_MESSAGE_HISTORY: 65536,
  MANAGE_CHANNELS: 16,
};

const WINNER_ALLOW = String(
  PERMISSIONS.VIEW_CHANNEL +
  PERMISSIONS.SEND_MESSAGES +
  PERMISSIONS.EMBED_LINKS +
  PERMISSIONS.ATTACH_FILES +
  PERMISSIONS.READ_MESSAGE_HISTORY
);

const BOT_ALLOW = String(
  PERMISSIONS.VIEW_CHANNEL +
  PERMISSIONS.SEND_MESSAGES +
  PERMISSIONS.READ_MESSAGE_HISTORY +
  PERMISSIONS.MANAGE_CHANNELS
);

function normaliseChannelName(value) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
  return cleaned || "giveaway-winners";
}

function messageText(message) {
  const parts = [String(message?.content || "")];
  for (const embed of message?.embeds || []) {
    parts.push(String(embed?.title || ""));
    parts.push(String(embed?.description || ""));
    for (const field of embed?.fields || []) {
      parts.push(String(field?.name || ""));
      parts.push(String(field?.value || ""));
    }
  }
  return parts.join("\n");
}

function isGiveawayResult(message, keyword) {
  if (!message?.author?.bot) return false;

  const authorName = String(message.author.username || "").toLowerCase();
  // GiveawayBot can have cosmetic/display-name differences. Keep the check
  // specific enough to avoid grabbing unrelated bots, but do not require an
  // exact case-sensitive username.
  if (!authorName.includes("giveawaybot")) return false;

  if (!messageText(message).toLowerCase().includes(String(keyword).toLowerCase())) return false;
  return Array.isArray(message.mentions) && message.mentions.length > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response, payload) {
  const bodySeconds = Number(payload?.retry_after);
  if (Number.isFinite(bodySeconds) && bodySeconds >= 0) return Math.ceil(bodySeconds * 1000);

  const header = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(header) && header >= 0) return Math.ceil(header * 1000);
  return 1500;
}

async function discordRequest(env, path, { method = "GET", body, reason } = {}) {
  if (!env.SENTIENT_BARTENDER_TOKEN) throw new Error("Bartender token is not configured in Cloudflare.");

  const headers = { Authorization: `Bot ${env.SENTIENT_BARTENDER_TOKEN}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason).slice(0, 512);

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.ok) {
      if (response.status === 204) return null;
      return response.json().catch(() => null);
    }

    const errorPayload = await response.json().catch(() => ({}));

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const waitMs = Math.min(60_000, Math.max(1000, retryAfterMs(response, errorPayload) + 250));
      console.warn(`[BARTENDER GIVEAWAY] Discord rate limit on ${method} ${path}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}).`);
      await sleep(waitMs);
      continue;
    }

    const detail = errorPayload?.message || `${response.status} ${response.statusText}`;
    const code = errorPayload?.code ? ` [${errorPayload.code}]` : "";
    const error = new Error(`Discord API: ${detail}${code}`);
    error.status = response.status;
    error.discordCode = errorPayload?.code;
    throw error;
  }

  throw new Error("Discord API request failed after rate-limit retries.");
}

async function scanChannel(env, channelId, keyword, maxPages) {
  const matches = [];
  let before = "";

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);

    let batch;
    try {
      batch = await discordRequest(env, `/channels/${channelId}/messages?${query.toString()}`);
    } catch (error) {
      // Skip channels Bartender cannot read instead of failing the entire guild search.
      if (error?.status === 403 || error?.discordCode === 50001 || error?.discordCode === 50013) return matches;
      throw error;
    }

    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const message of batch) {
      if (isGiveawayResult(message, keyword)) matches.push(message);
    }

    before = batch[batch.length - 1]?.id || "";
    if (!before || batch.length < 100) break;
  }

  return matches;
}

function newestFirst(messages) {
  return [...messages].sort((a, b) => {
    try {
      const left = BigInt(String(a?.id || "0"));
      const right = BigInt(String(b?.id || "0"));
      if (left === right) return 0;
      return left > right ? -1 : 1;
    } catch {
      return String(b?.timestamp || "").localeCompare(String(a?.timestamp || ""));
    }
  });
}

function uniqueMessages(messages) {
  const seen = new Set();
  const result = [];
  for (const message of newestFirst(messages)) {
    const id = String(message?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(message);
  }
  return result;
}

function isTextChannel(channel) {
  return channel?.type === 0 || channel?.type === 5;
}

function looksLikeGiveawayChannel(channel) {
  return /(giveaway|winner|event|prize|collect|reward)/i.test(String(channel?.name || ""));
}

async function findGiveawayMessages(env, guildId, currentChannelId, keyword, wanted) {
  const collected = [];

  // First search deeply in the channel where the command was used. This covers
  // busy channels where the Sep 1 results may now be thousands of messages old.
  collected.push(...await scanChannel(env, currentChannelId, keyword, CURRENT_CHANNEL_SCAN_PAGES));
  let unique = uniqueMessages(collected);
  if (unique.length >= wanted) return unique.slice(0, wanted);

  // If the owner ran the command somewhere else (for example general chat),
  // search the guild's other readable text channels automatically.
  const guildChannels = await discordRequest(env, `/guilds/${guildId}/channels`);
  const textChannels = (Array.isArray(guildChannels) ? guildChannels : [])
    .filter((channel) => isTextChannel(channel) && String(channel.id) !== String(currentChannelId))
    .sort((a, b) => Number(looksLikeGiveawayChannel(b)) - Number(looksLikeGiveawayChannel(a)));

  for (const channel of textChannels) {
    const maxPages = looksLikeGiveawayChannel(channel)
      ? LIKELY_CHANNEL_SCAN_PAGES
      : FALLBACK_CHANNEL_SCAN_PAGES;

    collected.push(...await scanChannel(env, channel.id, keyword, maxPages));
    unique = uniqueMessages(collected);
    if (unique.length >= wanted) return unique.slice(0, wanted);
  }

  return unique.slice(0, wanted);
}

export async function createGiveawayWinnerTicket(env, {
  guildId,
  sourceChannelId,
  botUserId,
  requestedBy,
  keyword = DEFAULT_KEYWORD,
  resultCount = DEFAULT_RESULT_MESSAGES,
  channelName = "purple-t3-winners",
} = {}) {
  if (!guildId) throw new Error("Guild ID is missing.");
  if (!sourceChannelId) throw new Error("Source channel is missing.");
  if (!botUserId) throw new Error("Bartender has not finished connecting to Discord yet.");

  const resultMessages = await findGiveawayMessages(env, guildId, sourceChannelId, keyword, resultCount);
  if (resultMessages.length < resultCount) {
    throw new Error(
      `Only found ${resultMessages.length}/${resultCount} GiveawayBot result messages containing ${keyword} after searching the current channel and other readable server channels. No ticket was created.`
    );
  }

  const winnerIds = [...new Set(
    resultMessages.flatMap((message) => (message.mentions || []).map((user) => String(user.id || "")).filter(Boolean))
  )];
  if (!winnerIds.length) throw new Error("The matching GiveawayBot messages contained no winner mentions.");

  // Build the ticket in the same category as the newest matching GiveawayBot
  // result, even if the owner ran the command from a different channel.
  const resultSourceChannelId = String(resultMessages[0]?.channel_id || sourceChannelId);
  const sourceChannel = await discordRequest(env, `/channels/${resultSourceChannelId}`);

  const permissionOverwrites = [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(PERMISSIONS.VIEW_CHANNEL),
    },
    ...winnerIds.map((id) => ({
      id,
      type: 1,
      allow: WINNER_ALLOW,
      deny: "0",
    })),
  ];

  if (!winnerIds.includes(botUserId)) {
    permissionOverwrites.push({
      id: botUserId,
      type: 1,
      allow: BOT_ALLOW,
      deny: "0",
    });
  }

  const ticket = await discordRequest(env, `/guilds/${guildId}/channels`, {
    method: "POST",
    reason: `Giveaway winner ticket created by ${requestedBy || "Bartender command"}`,
    body: {
      name: normaliseChannelName(channelName),
      type: 0,
      parent_id: sourceChannel?.parent_id || null,
      topic: `Private GiveawayBot winner ticket • ${keyword} • ${winnerIds.length} unique winner(s)`,
      permission_overwrites: permissionOverwrites,
    },
  });

  const mentions = winnerIds.map((id) => `<@${id}>`).join(" ");
  await discordRequest(env, `/channels/${ticket.id}/messages`, {
    method: "POST",
    body: {
      content: `🎉 **${keyword} winners**\n${mentions}\n\nThis channel is private to the winners listed above.`,
      allowed_mentions: { users: winnerIds, parse: [] },
    },
  });

  return {
    channelId: ticket.id,
    channelName: ticket.name,
    winnerCount: winnerIds.length,
    missingCount: 0,
    sourceChannelId: resultSourceChannelId,
    sourceMessageIds: resultMessages.map((message) => message.id),
  };
}
