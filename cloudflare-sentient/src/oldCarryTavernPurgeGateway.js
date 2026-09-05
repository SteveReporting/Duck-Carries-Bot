import { SentientGateway as BasePurgeGateway } from "./purgeMain.js";

const DISCORD_API = "https://discord.com/api/v10";
const OLD_BOT_ID = "1532853858626306230";
const STORAGE_KEY = "duckCarriesMessagePurgeV2";
const MAX_DELETES_PER_ALARM = 20;

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

  // The old bot's Carrier Department publisher created incoming webhooks named
  // "The Carry Tavern" and sent the branded embeds through those webhooks.
  // For those messages Discord exposes the webhook identity as the author, not
  // the bot user that created the webhook, so author.id will not equal OLD_BOT_ID.
  if (message?.webhook_id) {
    const username = normalizeName(message?.author?.username);
    if (username === "the carry tavern" || username === "duck carries bot") return true;
    if (hasCarryTavernFooter(message)) return true;
  }

  return false;
}

export class OldCarryTavernPurgeGateway extends BasePurgeGateway {
  async getPurgeState() {
    return (await this.ctx.storage.get(STORAGE_KEY)) || null;
  }

  async putPurgeState(state) {
    await this.ctx.storage.put(STORAGE_KEY, state);
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
