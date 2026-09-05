import worker, {
  SentientGateway as LiveSentientGateway,
  SentientWorkflow,
} from "./main.js";
import { sendMessage } from "./discord.js";

export { SentientWorkflow };

const DISCORD_API = "https://discord.com/api/v10";
const OWNER_DISCORD_USER_ID = "1178367418955989053";
const DUCK_CARRIES_BOT_ID = "1532853858626306230";
const PURGE_STORAGE_KEY = "duckCarriesMessagePurgeV1";
const PURGE_COMMAND = "bartender /purgeduck";
const PURGE_STATUS_COMMAND = "bartender /purgeduck status";
const MAX_DELETES_PER_ALARM = 20;

function normalizeCommand(value) {
  return String(value || "").split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim().toLowerCase();
}

function isPurgeCommand(value) {
  const command = normalizeCommand(value);
  return command === PURGE_COMMAND || command === PURGE_STATUS_COMMAND;
}

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
      if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = Math.ceil(seconds * 1000) + 150;
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

function uniqueIds(values) {
  return [...new Set(values.map(String).filter(Boolean))];
}

async function discoverMessageChannels(env, guildId) {
  const response = await discordRequest(env, `/guilds/${guildId}/channels`);
  if (!response?.ok) {
    throw new Error(`Could not list guild channels (HTTP ${response?.status || "unknown"}).`);
  }

  const channels = await jsonOrNull(response);
  const base = Array.isArray(channels)
    ? channels
        .filter((channel) => [0, 2, 5, 13].includes(Number(channel?.type)))
        .map((channel) => channel?.id)
        .filter(Boolean)
    : [];

  // Include every currently active public/private/announcement thread the bot can see.
  const activeResponse = await discordRequest(env, `/guilds/${guildId}/threads/active`);
  if (activeResponse?.ok) {
    const payload = await jsonOrNull(activeResponse);
    const threads = Array.isArray(payload?.threads)
      ? payload.threads.map((thread) => thread?.id).filter(Boolean)
      : [];
    base.push(...threads);
  }

  return uniqueIds(base);
}

function freshState(channelIds) {
  return {
    status: "running",
    targetBotId: DUCK_CARRIES_BOT_ID,
    channelIds,
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
    lastError: null,
  };
}

export class SentientGateway extends LiveSentientGateway {
  async getPurgeState() {
    return (await this.ctx.storage.get(PURGE_STORAGE_KEY)) || null;
  }

  async putPurgeState(state) {
    await this.ctx.storage.put(PURGE_STORAGE_KEY, state);
  }

  async schedulePurge(delayMs = 250) {
    if (typeof this.ctx.storage.setAlarm === "function") {
      await this.ctx.storage.setAlarm(Date.now() + Math.max(100, delayMs));
    }
  }

  async startDuckPurge() {
    if (!this.env.SENTIENT_BARTENDER_TOKEN) {
      throw new Error("SENTIENT_BARTENDER_TOKEN is missing.");
    }
    const guildId = this.targetGuild();
    if (!guildId) throw new Error("SENTIENT_GUILD_ID is missing.");

    const channelIds = await discoverMessageChannels(this.env, guildId);
    const state = freshState(channelIds);
    await this.putPurgeState(state);
    await this.schedulePurge(100);
    return state;
  }

  async processPurgeChunk() {
    const state = await this.getPurgeState();
    if (!state || state.status !== "running") return state;

    if (!this.env.SENTIENT_BARTENDER_TOKEN) {
      state.status = "failed";
      state.lastError = "SENTIENT_BARTENDER_TOKEN is missing.";
      await this.putPurgeState(state);
      return state;
    }

    // Drain queued deletions first so a single alarm never creates too many Discord subrequests.
    if (state.pendingDeleteIds.length) {
      const batch = state.pendingDeleteIds.splice(0, MAX_DELETES_PER_ALARM);
      for (const entry of batch) {
        const response = await discordRequest(
          this.env,
          `/channels/${entry.channelId}/messages/${entry.messageId}`,
          { method: "DELETE" },
        );
        if (response?.ok || response?.status === 404) state.deleted += 1;
        else state.deleteFailures += 1;
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
      state.status = "complete";
      state.completedAt = new Date().toISOString();
      await this.putPurgeState(state);
      return state;
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
        state.inaccessibleChannels += 1;
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

    state.scanned += messages.length;
    state.pendingDeleteIds = messages
      .filter((message) => String(message?.author?.id || "") === DUCK_CARRIES_BOT_ID)
      .map((message) => ({ channelId, messageId: String(message.id) }));

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

  async alarm() {
    try {
      const state = await this.processPurgeChunk();
      if (state?.status === "running") await this.schedulePurge(500);
    } catch (error) {
      const state = (await this.getPurgeState()) || freshState([]);
      state.status = "failed";
      state.lastError = error?.message || String(error);
      await this.putPurgeState(state).catch(() => {});
    }
  }

  async handleOwnerControl(message, content) {
    if (!isPurgeCommand(content)) {
      return super.handleOwnerControl(message, content);
    }

    // Swallow attempted purge controls from everybody except the owner.
    if (String(message?.author?.id || "") !== OWNER_DISCORD_USER_ID) return true;
    if (message.guild_id !== this.targetGuild()) return true;

    const command = normalizeCommand(content);
    if (command === PURGE_STATUS_COMMAND) {
      const state = await this.getPurgeState();
      const text = state
        ? `DUCK CLEANUP // **${String(state.status).toUpperCase()}**\nDeleted: **${state.deleted}** | Scanned: **${state.scanned}** | Channels: **${Math.min(state.channelIndex + 1, state.channelIds.length)}/${state.channelIds.length}** | Delete failures: **${state.deleteFailures}**${state.lastError ? `\nLast error: ${state.lastError}` : ""}`
        : `DUCK CLEANUP // No cleanup has been started. Run \`${PURGE_COMMAND}\`.`;
      await sendMessage(this.env, message.channel_id, {
        content: text.slice(0, 1900),
        allowed_mentions: { parse: [] },
      });
      return true;
    }

    try {
      const state = await this.startDuckPurge();
      await sendMessage(this.env, message.channel_id, {
        content: `DUCK CLEANUP // started. I will delete only messages authored by the old Duck Carries bot (${DUCK_CARRIES_BOT_ID}) across **${state.channelIds.length} accessible guild channels/active threads**. Use \`${PURGE_STATUS_COMMAND}\` for progress.`,
        allowed_mentions: { parse: [] },
      });
    } catch (error) {
      await sendMessage(this.env, message.channel_id, {
        content: `DUCK CLEANUP // failed to start: ${error?.message || String(error)}`.slice(0, 1900),
        allowed_mentions: { parse: [] },
      }).catch(() => {});
    }
    return true;
  }
}

export default worker;
