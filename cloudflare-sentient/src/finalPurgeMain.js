import worker, {
  SentientGateway as LiveSentientGateway,
  SentientWorkflow,
} from "./main.js";
import { sendMessage } from "./discord.js";

export { SentientWorkflow, LiveSentientGateway as SentientGateway };

const DISCORD_API = "https://discord.com/api/v10";
const FINAL_EXIT_KEY = "bartenderFinalGoodbyeDepartureV1";
const FAREWELL_MESSAGE = "It was a great service to serve you all, but this is where I depart.";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function uniqueIds(values) {
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discordRequest(env, path, init = {}) {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${env.SENTIENT_BARTENDER_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function summarize(state) {
  if (!state) return { status: "not_started" };
  return {
    status: state.status,
    configuredChannels: state.configuredChannels || [],
    sentChannelIds: state.sentChannelIds || [],
    failedChannels: state.failedChannels || [],
    gatewayReadyBeforeFarewell: Boolean(state.gatewayReadyBeforeFarewell),
    startedAt: state.startedAt || null,
    farewellCompletedAt: state.farewellCompletedAt || null,
    departedAt: state.departedAt || null,
    lastError: state.lastError || null,
  };
}

export class FinalPurgeGateway extends LiveSentientGateway {
  async getFinalExitState() {
    return (await this.ctx.storage.get(FINAL_EXIT_KEY)) || null;
  }

  async putFinalExitState(state) {
    await this.ctx.storage.put(FINAL_EXIT_KEY, state);
  }

  async shutdownGateway() {
    this.enabled = false;
    this.ownerSilenced = true;
    await this.ctx.storage.put("enabled", false);
    await this.ctx.storage.put("ownerSilenced", true);
    this.clearTimers();
    try { this.ws?.close(1000, "Bartender final goodbye complete"); } catch {}
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.connecting = false;
  }

  async runFinalGoodbyeAndLeave() {
    if (!this.env.SENTIENT_BARTENDER_TOKEN) {
      return { ok: false, error: "SENTIENT_BARTENDER_TOKEN is missing." };
    }

    const guildId = this.targetGuild();
    if (!guildId) return { ok: false, error: "SENTIENT_GUILD_ID is missing." };

    let state = await this.getFinalExitState();
    if (state?.status === "departed") {
      await this.shutdownGateway();
      return { ok: true, finalExit: summarize(state) };
    }

    const configuredChannels = uniqueIds(this.allowedChannels());
    if (!configuredChannels.length) {
      return { ok: false, error: "No Tavern chat / Sentient AI channel IDs are configured." };
    }

    if (!state) {
      state = {
        status: "starting",
        configuredChannels,
        sentChannelIds: [],
        failedChannels: [],
        gatewayReadyBeforeFarewell: false,
        startedAt: new Date().toISOString(),
        farewellCompletedAt: null,
        departedAt: null,
        lastError: null,
      };
      await this.putFinalExitState(state);
    }

    // Bring Bartender online one final time. It is silenced so it cannot start
    // ordinary conversations while the farewell is being delivered.
    this.enabled = true;
    this.ownerSilenced = true;
    await this.ctx.storage.put("enabled", true);
    await this.ctx.storage.put("ownerSilenced", true);
    await this.ensureConnected();

    // Give Discord a short window to publish the online presence. The goodbye
    // itself uses REST and therefore does not depend on gateway readiness.
    for (let i = 0; i < 30 && !this.ready; i += 1) {
      await sleep(100);
    }
    state.gatewayReadyBeforeFarewell = Boolean(this.ready);
    state.status = "saying_goodbye";
    await this.putFinalExitState(state);

    const sent = new Set(state.sentChannelIds || []);
    const failed = new Map((state.failedChannels || []).map((entry) => [String(entry.channelId), entry]));

    for (const channelId of configuredChannels) {
      if (sent.has(channelId)) continue;
      try {
        await sendMessage(this.env, channelId, {
          content: FAREWELL_MESSAGE,
          allowed_mentions: { parse: [] },
        });
        sent.add(channelId);
        failed.delete(channelId);
        state.sentChannelIds = [...sent];
        state.failedChannels = [...failed.values()];
        state.lastError = null;
        await this.putFinalExitState(state);
      } catch (error) {
        failed.set(channelId, {
          channelId,
          error: error?.message || String(error),
        });
        state.failedChannels = [...failed.values()];
        state.lastError = `Farewell failed in channel ${channelId}: ${error?.message || String(error)}`;
        await this.putFinalExitState(state);
      }
    }

    if (!sent.size) {
      state.status = "failed";
      state.lastError ||= "Could not send the farewell to any configured Tavern chat channel. Guild departure was blocked.";
      await this.putFinalExitState(state);
      await this.shutdownGateway();
      return { ok: false, finalExit: summarize(state) };
    }

    state.status = "leaving";
    state.farewellCompletedAt ||= new Date().toISOString();
    await this.putFinalExitState(state);

    // Keep the online presence visible briefly after the farewell, then leave.
    await sleep(1200);

    const leaveResponse = await discordRequest(
      this.env,
      `/users/@me/guilds/${guildId}`,
      { method: "DELETE" },
    );

    if (leaveResponse.ok || leaveResponse.status === 404) {
      state.status = "departed";
      state.departedAt = new Date().toISOString();
      state.lastError = null;
      await this.putFinalExitState(state);
      await this.shutdownGateway();
      console.log("[BARTENDER FINAL EXIT] farewell sent and guild departed", JSON.stringify(summarize(state)));
      return { ok: true, finalExit: summarize(state) };
    }

    state.status = "failed";
    state.lastError = `Farewell sent, but leaving the guild returned HTTP ${leaveResponse.status}.`;
    await this.putFinalExitState(state);
    await this.shutdownGateway();
    return { ok: false, finalExit: summarize(state) };
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Keep the old route names so bootstrap.js does not need another migration.
    if (url.pathname === "/purge-status" && request.method === "GET") {
      return json({ ok: true, finalExit: summarize(await this.getFinalExitState()) });
    }

    if (url.pathname === "/purge-ready" && request.method === "POST") {
      const result = await this.runFinalGoodbyeAndLeave();
      return json(result, result.ok ? 200 : 500);
    }

    return super.fetch(request);
  }

  async alarm() {
    const result = await this.runFinalGoodbyeAndLeave();
    console.log("[BARTENDER FINAL EXIT] alarm", JSON.stringify(result));
  }
}

export default worker;
