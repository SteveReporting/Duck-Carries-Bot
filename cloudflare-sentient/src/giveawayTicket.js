const DISCORD_API = "https://discord.com/api/v10";

const DEFAULT_KEYWORD = "PURPLE COLLECT/T3";
const DEFAULT_RESULT_MESSAGES = 3;
const TARGET_GIVEAWAY_TIME = "2026-09-01T19:51:00.000Z"; // 20:51 BST in the screenshots
const CURRENT_CHANNEL_SCAN_PAGES = 5;
const FALLBACK_CHANNEL_SCAN_PAGES = 2;
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

const OWNER_ALLOW = String(
  PERMISSIONS.VIEW_CHANNEL +
  PERMISSIONS.SEND_MESSAGES +
  PERMISSIONS.EMBED_LINKS +
  PERMISSIONS.ATTACH_FILES +
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

function discordSnowflakeFor(dateValue) {
  const discordEpoch = 1420070400000n;
  const milliseconds = BigInt(new Date(dateValue).getTime());
  return String((milliseconds - discordEpoch) << 22n);
}

async function readMessages(env, channelId, query) {
  try {
    const batch = await discordRequest(env, `/channels/${channelId}/messages?${query}`);
    return Array.isArray(batch) ? batch : [];
  } catch (error) {
    if (error?.status === 403 || error?.discordCode === 50001 || error?.discordCode === 50013) return [];
    throw error;
  }
}

async function scanAroundKnownGiveawayTime(env, channelId, keyword) {
  const around = discordSnowflakeFor(TARGET_GIVEAWAY_TIME);
  const batch = await readMessages(env, channelId, new URLSearchParams({ around, limit: "100" }).toString());
  return batch.filter((message) => isGiveawayResult(message, keyword));
}

async function scanRecentChannel(env, channelId, keyword, maxPages) {
  const matches = [];
  let before = "";

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const batch = await readMessages(env, channelId, query.toString());
    if (!batch.length) break;

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
  return /(giveaway|winner|event|prize|collect|reward|announcement)/i.test(String(channel?.name || ""));
}

async function findGiveawayMessages(env, guildChannels, currentChannelId, keyword, wanted) {
  const collected = [];

  collected.push(...await scanRecentChannel(env, currentChannelId, keyword, CURRENT_CHANNEL_SCAN_PAGES));
  let unique = uniqueMessages(collected);
  if (unique.length >= wanted) return unique.slice(0, wanted);

  const textChannels = guildChannels
    .filter((channel) => isTextChannel(channel))
    .sort((a, b) => {
      if (String(a.id) === String(currentChannelId)) return -1;
      if (String(b.id) === String(currentChannelId)) return 1;
      return Number(looksLikeGiveawayChannel(b)) - Number(looksLikeGiveawayChannel(a));
    });

  for (const channel of textChannels) {
    collected.push(...await scanAroundKnownGiveawayTime(env, channel.id, keyword));
    unique = uniqueMessages(collected);
    if (unique.length >= wanted) return unique.slice(0, wanted);
  }

  for (const channel of textChannels) {
    collected.push(...await scanRecentChannel(env, channel.id, keyword, FALLBACK_CHANNEL_SCAN_PAGES));
    unique = uniqueMessages(collected);
    if (unique.length >= wanted) return unique.slice(0, wanted);
  }

  return unique.slice(0, wanted);
}

async function ensureOwnerCanSeeTicket(env, channelId, ownerUserId) {
  if (!channelId || !ownerUserId) return;
  await discordRequest(env, `/channels/${channelId}/permissions/${ownerUserId}`, {
    method: "PUT",
    reason: "Ensure giveaway ticket creator can manage the private winner channel",
    body: {
      type: 1,
      allow: OWNER_ALLOW,
      deny: "0",
    },
  });
}

export async function createGiveawayWinnerTicket(env, {
  guildId,
  sourceChannelId,
  botUserId,
  ownerUserId,
  requestedBy,
  keyword = DEFAULT_KEYWORD,
  resultCount = DEFAULT_RESULT_MESSAGES,
  channelName = "purple-t3-winners",
} = {}) {
  if (!guildId) throw new Error("Guild ID is missing.");
  if (!sourceChannelId) throw new Error("Source channel is missing.");
  if (!botUserId) throw new Error("Bartender has not finished connecting to Discord yet.");

  const effectiveOwnerUserId = String(
    ownerUserId || String(requestedBy || "").match(/owner\s+(\d+)/i)?.[1] || ""
  );

  const guildChannelsRaw = await discordRequest(env, `/guilds/${guildId}/channels`);
  const guildChannels = Array.isArray(guildChannelsRaw) ? guildChannelsRaw : [];
  const wantedName = normaliseChannelName(channelName);

  const existingTicket = guildChannels.find((channel) =>
    channel?.type === 0 &&
    String(channel?.name || "") === wantedName &&
    String(channel?.topic || "").includes("Private GiveawayBot winner ticket") &&
    String(channel?.topic || "").includes(keyword)
  );

  if (existingTicket) {
    await ensureOwnerCanSeeTicket(env, existingTicket.id, effectiveOwnerUserId);
    return {
      channelId: existingTicket.id,
      channelName: existingTicket.name,
      winnerCount: Number(String(existingTicket.topic || "").match(/•\s*(\d+)\s+unique winner/)?.[1] || 0),
      missingCount: 0,
      existing: true,
      sourceChannelId: null,
      sourceMessageIds: [],
    };
  }

  const resultMessages = await findGiveawayMessages(env, guildChannels, sourceChannelId, keyword, resultCount);
  if (resultMessages.length < resultCount) {
    throw new Error(
      `Only found ${resultMessages.length}/${resultCount} GiveawayBot result messages containing ${keyword}. No ticket was created.`
    );
  }

  const winnerIds = [...new Set(
    resultMessages.flatMap((message) => (message.mentions || []).map((user) => String(user.id || "")).filter(Boolean))
  )];
  if (!winnerIds.length) throw new Error("The matching GiveawayBot messages contained no winner mentions.");

  const resultSourceChannelId = String(resultMessages[0]?.channel_id || sourceChannelId);
  const sourceChannel = guildChannels.find((channel) => String(channel.id) === resultSourceChannelId)
    || await discordRequest(env, `/channels/${resultSourceChannelId}`);

  const winnerOverwrites = winnerIds
    .filter((id) => String(id) !== effectiveOwnerUserId)
    .map((id) => ({
      id,
      type: 1,
      allow: WINNER_ALLOW,
      deny: "0",
    }));

  const permissionOverwrites = [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(PERMISSIONS.VIEW_CHANNEL),
    },
    ...winnerOverwrites,
  ];

  if (effectiveOwnerUserId) {
    permissionOverwrites.push({
      id: effectiveOwnerUserId,
      type: 1,
      allow: OWNER_ALLOW,
      deny: "0",
    });
  }

  if (!winnerIds.includes(botUserId) && String(botUserId) !== effectiveOwnerUserId) {
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
      name: wantedName,
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
    existing: false,
    sourceChannelId: resultSourceChannelId,
    sourceMessageIds: resultMessages.map((message) => message.id),
  };
}
