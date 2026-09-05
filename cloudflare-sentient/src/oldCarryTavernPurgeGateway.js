import { SentientGateway as BasePurgeGateway } from "./purgeMain.js";

const DISCORD_API = "https://discord.com/api/v10";
const OLD_BOT_ID = "1532853858626306230";
const STORAGE_KEY = "duckCarriesMessagePurgeV3";
const MAX_DELETES_PER_ALARM = 20;

const PRIORITY_CHANNELS = [
  "become-a-carrier",
  "bartender-chat",
  "carrier-news",
  "carrier-guide",
  "carrier-leaderboard",
  "carrier-training",
  "training-reports",
  "carrier-management",
  "application-reviews",
];

function authHeaders(env) {
  return {
    Authorization: `Bot ${env.SENTIENT_BARTENDER_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function discordRequest(env, path, init = {}) {
  let lastResponse = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      ...init,
      headers: {
        ...authHeaders(env),
        ...(init.headers || {}),
      },
    });
    lastResponse = response;

    if (response.status !== 429) return response;

    let retryAfterMs = 1200;
    try {
      const body = await response.clone().json();
      const seconds = Number(body?.retry_after);
      if (Number.isFinite(seconds) && seconds > 0) {
        retryAfterMs = Math.ceil(seconds * 1000) + 150;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, Math.min(15000, retryAfterMs)));
  }
  return lastResponse;
}

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function hasCarryTavernFooter(message) {
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  return embeds.some((embed) => {
    const footer = String(embed?.footer?.text || "");
    return footer.startsWith("The Carry Tavern • Carrier Department");
  });
}

function isOldCarryTavernMessage(message) {
  const authorId = String(message?.author?.id || "");
  if (authorId === OLD_BOT_ID) return true;

  if (String(message?.application_id || "") === OLD_BOT_ID) return true;
  if (String(message?.interaction_metadata?.application_id || "") === OLD_BOT_ID) return true;
  if (String(message?.interaction?.application_id || "") === OLD_BOT_ID) return true;

  if (message?.webhook_id) {
    const username = normalizeName(message?.author?.username);
    if (username === "the carry tavern" || username === "duck carries bot") return true;
    if (hasCarryTavernFooter(message)) return true;
  }

  return false;
}

function channelPriority(channel) {
  const name = normalizeName(channel?.name);
  const exact = PRIORITY_CHANNELS.indexOf(name);
  if (exact >= 0) return exact;

  if (name.includes("carrier")) return 20;
  if (name.includes("tavern")) return 21;
  if (name.includes("bartender")) return 22;
  if (name.includes("training")) return 23;
  if (name.includes("application")) return 24;
  if (name.includes("management")) return 25;
  if (name.includes("leaderboard")) return 26;
  if (name.includes("guide")) return 27;
  if (name.includes("news")) return 28;
  return 1000;
}

function orderedUniqueChannels(channels) {
  const seen = new Set();
  return [...channels]
    .filter((channel) => channel?.id)
    .sort((a, b) => {
      const priority = channelPriority(a) - channelPriority(b);
      if (priority !== 0) return priority;
      return Number(a?.position || 0) - Number(b?.position || 0);
    })
    .filter((channel) => {
      const id = String(channel.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

async function discoverOrderedMessageChannels(env, guildId) {
  const response = await discordRequest(env, `/guilds/${guildId}/channels`);
  if (!response?.ok) {
    throw new Error(`Could not list guild channels (HTTP ${response?.status || "unknown"}).`);
  }

  const channels = await jsonOrNull(response);
  const messageChannels = Array.isArray(channels)
    ? channels.filter((channel) => [0, 2, 5, 13].includes(Number(channel?.type)))
    : [];

  const activeResponse = await discordRequest(env, `/guilds/${guildId}/threads/active`);
  if (activeResponse?.ok) {
    const payload = await jsonOrNull(activeResponse);
    if (Array.isArray(payload?.threads)) messageChannels.push(...payload.threads);
  }

  return orderedUniqueChannels(messageChannels);
}

function freshState(channelIds, commandChannelId = null) {
  return {
    status: "running",
    targetBotId: OLD_BOT_ID,
    matcher: "bot-id+carry-tavern-webhooks-priority-v3",
    channelIds,
    commandChannelId: commandChannelId ? String(commandChannelId) : null,
    channelIndex: 0,
    before: null,
    pendingDeleteIds: [],
    nextBefore: null,
    scanned: 0,
    deleted: 0,
    deleteFailures: 0,
    inaccessibleChannels: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    farewellSentAt: null,
    departedAt: null,
    departureAttempts: 0,
    lastError: null,
  };
}

export class OldCarryTavernPurgeGateway extends BasePurgeGateway {
  async getPurgeState() {
    return (await this.ctx.storage.get(STORAGE_KEY)) || null;
  }

  async putPurgeState(state) {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }

  async startDuckPurge(commandChannelId) {
    if (!this.env.SENTIENT_BARTENDER_TOKEN) {
      throw new Error("SENTIENT_BARTENDER_TOKEN is missing.");
    }

    const guildId = this.targetGuild();
    if (!guildId) throw new Error("SENTIENT_GUILD_ID is missing.");

    const orderedChannels = await discoverOrderedMessageChannels(this.env, guildId);
    const state = freshState(
      orderedChannels.map((channel) => String(channel.id)),
      commandChannelId,
    );

    state.priorityChannels = orderedChannels
      .slice(0, 15)
      .map((channel) => ({ id: String(channel.id), name: String(channel.name || "") }));

    await this.putPurgeState(state);
    await this.schedulePurge(100);
    return state;
  }

  async processPurgeChunk() {
    const state = await this.getPurgeState();
    if (!state) return state;
    if (state.status === "departing") return this.finishAndDepart(state);
    if (state.status !== "running") return state;

    if (!this.env.SENTIENT_BARTENDER_TOKEN) {
      state.status = "failed";
      state.lastError = "SENTIENT_BARTENDER_TOKEN is missing.";
      await this.putPurgeState(state);
      return state;
    }

    if (!Array.isArray(state.pendingDeleteIds)) state.pendingDeleteIds = [];

    if (state.pendingDeleteIds.length) {
      const batch = state.pendingDeleteIds.splice(0, MAX_DELETES_PER_ALARM);
      for (const entry of batch) {
        const response = await discordRequest(
          this.env,
          `/channels/${entry.channelId}/messages/${entry.messageId}`,
          { method: "DELETE" },
        );

        if (response?.ok || response?.status === 404) {
          state.deleted = Number(state.deleted || 0) + 1;
        } else {
          state.deleteFailures = Number(state.deleteFailures || 0) + 1;
          state.lastError = `Delete ${entry.messageId} returned HTTP ${response?.status || "unknown"}.`;
        }
      }

      if (!state.pendingDeleteIds.length) {
        if (state.nextBefore) {
          state.before = state.nextBefore;
          state.nextBefore = null;
        } else {
          state.channelIndex += 1;
          state.before = null;
        }
      }

      await this.putPurgeState(state);
      if (state.status === "running") await this.schedulePurge(500);
      return state;
    }

    if (state.channelIndex >= state.channelIds.length) {
      if (Number(state.deleted || 0) === 0) {
        state.status = "failed";
        state.completedAt = new Date().toISOString();
        state.lastError = "Full scan completed with zero matching Carry Tavern/Duck Carries messages; refusing farewell/departure for safety.";
        await this.putPurgeState(state);
        return state;
      }

      state.status = "departing";
      state.completedAt = new Date().toISOString();
      await this.putPurgeState(state);
      return this.finishAndDepart(state);
    }

    const channelId = state.channelIds[state.channelIndex];
    const query = new URLSearchParams({ limit: "100" });
    if (state.before) query.set("before", state.before);

    const response = await discordRequest(
      this.env,
      `/channels/${channelId}/messages?${query.toString()}`,
    );

    if (!response?.ok) {
      if ([403, 404].includes(response?.status)) {
        state.inaccessibleChannels = Number(state.inaccessibleChannels || 0) + 1;
        state.channelIndex += 1;
        state.before = null;
        state.nextBefore = null;
        await this.putPurgeState(state);
        await this.schedulePurge(250);
        return state;
      }

      state.lastError = `Channel ${channelId} history returned HTTP ${response?.status || "unknown"}.`;
      await this.putPurgeState(state);
      await this.schedulePurge(1500);
      return state;
    }

    const messages = await jsonOrNull(response);
    if (!Array.isArray(messages) || messages.length === 0) {
      state.channelIndex += 1;
      state.before = null;
      state.nextBefore = null;
      await this.putPurgeState(state);
      await this.schedulePurge(250);
      return state;
    }

    state.scanned = Number(state.scanned || 0) + messages.length;
    state.pendingDeleteIds = messages
      .filter(isOldCarryTavernMessage)
      .map((message) => ({
        channelId,
        messageId: String(message.id),
      }));

    state.nextBefore = messages.length === 100
      ? String(messages[messages.length - 1].id)
      : null;

    if (!state.pendingDeleteIds.length) {
      if (state.nextBefore) {
        state.before = state.nextBefore;
        state.nextBefore = null;
      } else {
        state.channelIndex += 1;
        state.before = null;
      }
    }

    await this.putPurgeState(state);
    await this.schedulePurge(state.pendingDeleteIds.length ? 250 : 150);
    return state;
  }
}
