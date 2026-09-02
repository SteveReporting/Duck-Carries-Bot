const DISCORD_API = "https://discord.com/api/v10";

const DEFAULT_KEYWORD = "PURPLE COLLECT/T3";
const DEFAULT_RESULT_MESSAGES = 3;
const MAX_SCAN_PAGES = 10;

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
  if (authorName !== "giveawaybot") return false;
  if (!messageText(message).toLowerCase().includes(String(keyword).toLowerCase())) return false;
  return Array.isArray(message.mentions) && message.mentions.length > 0;
}

async function discordRequest(env, path, { method = "GET", body, reason } = {}) {
  if (!env.SENTIENT_BARTENDER_TOKEN) throw new Error("Bartender token is not configured in Cloudflare.");

  const headers = {
    Authorization: `Bot ${env.SENTIENT_BARTENDER_TOKEN}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason).slice(0, 512);

  const response = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.ok) {
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  const error = await response.json().catch(() => ({}));
  const detail = error?.message || `${response.status} ${response.statusText}`;
  const code = error?.code ? ` [${error.code}]` : "";
  throw new Error(`Discord API: ${detail}${code}`);
}

async function findGiveawayMessages(env, channelId, keyword, wanted) {
  const matches = [];
  let before = "";

  for (let page = 0; page < MAX_SCAN_PAGES && matches.length < wanted; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);

    const batch = await discordRequest(env, `/channels/${channelId}/messages?${query.toString()}`);
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const message of batch) {
      if (isGiveawayResult(message, keyword)) matches.push(message);
      if (matches.length >= wanted) break;
    }

    before = batch[batch.length - 1]?.id || "";
    if (!before || batch.length < 100) break;
  }

  return matches.slice(0, wanted);
}

async function memberExists(env, guildId, userId) {
  try {
    await discordRequest(env, `/guilds/${guildId}/members/${userId}`);
    return true;
  } catch (error) {
    if (/Unknown Member|\[10007\]/i.test(String(error?.message || ""))) return false;
    throw error;
  }
}

async function filterPresentMembers(env, guildId, userIds) {
  const present = [];
  const missing = [];
  const chunkSize = 8;

  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const checks = await Promise.all(chunk.map(async (id) => ({
      id,
      exists: await memberExists(env, guildId, id),
    })));
    for (const check of checks) {
      if (check.exists) present.push(check.id);
      else missing.push(check.id);
    }
  }

  return { present, missing };
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
  if (!sourceChannelId) throw new Error("Run the command in the channel containing the GiveawayBot results.");
  if (!botUserId) throw new Error("Bartender has not finished connecting to Discord yet.");

  const resultMessages = await findGiveawayMessages(env, sourceChannelId, keyword, resultCount);
  if (resultMessages.length < resultCount) {
    throw new Error(
      `Only found ${resultMessages.length}/${resultCount} GiveawayBot result messages containing ${keyword} in the last ${MAX_SCAN_PAGES * 100} messages. No ticket was created.`
    );
  }

  const winnerIds = [...new Set(
    resultMessages.flatMap((message) => (message.mentions || []).map((user) => String(user.id || "")).filter(Boolean))
  )];
  if (!winnerIds.length) throw new Error("The matching GiveawayBot messages contained no winner mentions.");

  const { present: presentWinnerIds, missing: missingWinnerIds } = await filterPresentMembers(env, guildId, winnerIds);
  if (!presentWinnerIds.length) throw new Error("None of the mentioned winners are currently in the server. No ticket was created.");

  const sourceChannel = await discordRequest(env, `/channels/${sourceChannelId}`);
  const permissionOverwrites = [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(PERMISSIONS.VIEW_CHANNEL),
    },
    ...presentWinnerIds.map((id) => ({
      id,
      type: 1,
      allow: WINNER_ALLOW,
      deny: "0",
    })),
  ];

  if (!presentWinnerIds.includes(botUserId)) {
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
      topic: `Private GiveawayBot winner ticket • ${keyword} • ${presentWinnerIds.length} winner(s)`,
      permission_overwrites: permissionOverwrites,
    },
  });

  const mentions = presentWinnerIds.map((id) => `<@${id}>`).join(" ");
  await discordRequest(env, `/channels/${ticket.id}/messages`, {
    method: "POST",
    body: {
      content: `🎉 **${keyword} winners**\n${mentions}\n\nThis channel is private to the winners listed above.`,
      allowed_mentions: { users: presentWinnerIds, parse: [] },
    },
  });

  return {
    channelId: ticket.id,
    channelName: ticket.name,
    winnerCount: presentWinnerIds.length,
    missingCount: missingWinnerIds.length,
    sourceMessageIds: resultMessages.map((message) => message.id),
  };
}
