import worker, {
  SentientGateway as LiveSentientGateway,
  SentientWorkflow,
} from "./main.js";

export { SentientWorkflow, LiveSentientGateway as SentientGateway };

const DISCORD_API = "https://discord.com/api/v10";
const LEAVE_STATE_KEY = "bartenderLeaveOnlyV1";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function summarize(state) {
  if (!state) return { status: "not_started" };
  return {
    status: state.status,
    attempts: Number(state.attempts || 0),
    startedAt: state.startedAt || null,
    departedAt: state.departedAt || null,
    lastHttpStatus: state.lastHttpStatus ?? null,
    lastError: state.lastError || null,
  };
}

export class FinalPurgeGateway extends LiveSentientGateway {
  async getLeaveState() {
    return (await this.ctx.storage.get(LEAVE_STATE_KEY)) || null;
  }

  async putLeaveState(state) {
    await this.ctx.storage.put(LEAVE_STATE_KEY, state);
  }

  async shutdownGateway() {
    this.enabled = false;
    this.ownerSilenced = true;
    await this.ctx.storage.put("enabled", false);
    await this.ctx.storage.put("ownerSilenced", true);
    this.clearTimers();
    try { this.ws?.close(1000, "Bartender leaving The Carry Tavern"); } catch {}
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.connecting = false;
  }

  async leaveGuildNow() {
    if (!this.env.SENTIENT_BARTENDER_TOKEN) {
      return { ok: false, error: "SENTIENT_BARTENDER_TOKEN is missing." };
    }

    const guildId = this.targetGuild();
    if (!guildId) return { ok: false, error: "SENTIENT_GUILD_ID is missing." };

    let state = await this.getLeaveState();
    if (state?.status === "departed") {
      await this.shutdownGateway();
      return { ok: true, leftGuild: true, leave: summarize(state) };
    }

    state ||= {
      status: "leaving",
      attempts: 0,
      startedAt: new Date().toISOString(),
      departedAt: null,
      lastHttpStatus: null,
      lastError: null,
    };

    state.status = "leaving";
    state.attempts = Number(state.attempts || 0) + 1;
    state.lastError = null;
    await this.putLeaveState(state);

    // Nothing else should run now. The goodbye has already been delivered.
    await this.shutdownGateway();

    let response;
    try {
      response = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bot ${this.env.SENTIENT_BARTENDER_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      state.status = "retrying";
      state.lastError = error?.message || String(error);
      await this.putLeaveState(state);
      console.error("[BARTENDER LEAVE ONLY] request failed", state.lastError);
      return { ok: false, leftGuild: false, leave: summarize(state) };
    }

    state.lastHttpStatus = response.status;

    // Discord normally returns 204. A 404 means it is already no longer in the guild.
    if (response.ok || response.status === 404) {
      state.status = "departed";
      state.departedAt = new Date().toISOString();
      state.lastError = null;
      await this.putLeaveState(state);
      console.log("[BARTENDER LEAVE ONLY] departed", JSON.stringify(summarize(state)));
      return { ok: true, leftGuild: true, leave: summarize(state) };
    }

    let body = "";
    try { body = await response.text(); } catch {}
    state.status = "retrying";
    state.lastError = `Discord leave returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`;
    await this.putLeaveState(state);
    console.error("[BARTENDER LEAVE ONLY] Discord rejected leave", state.lastError);
    return { ok: false, leftGuild: false, leave: summarize(state) };
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Keep the existing internal route names so bootstrap.js can remain unchanged.
    if (url.pathname === "/purge-status" && request.method === "GET") {
      return json({ ok: true, leave: summarize(await this.getLeaveState()) });
    }

    if (url.pathname === "/purge-ready" && request.method === "POST") {
      const result = await this.leaveGuildNow();
      return json(result, result.ok ? 200 : 500);
    }

    return super.fetch(request);
  }

  async alarm() {
    const result = await this.leaveGuildNow();
    console.log("[BARTENDER LEAVE ONLY] alarm", JSON.stringify(result));
  }
}

export default worker;
