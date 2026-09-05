import worker, {
  SentientGateway as PurgeSentientGateway,
  SentientWorkflow,
} from "./purgeMain.js";

export { SentientWorkflow, PurgeSentientGateway as SentientGateway };

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeCommand(value) {
  return String(value || "")
    .split(/\r?\n/, 1)[0]
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isFinalPurgeCommand(value) {
  const command = normalizeCommand(value);
  return command === "bartender /purgeduck" || command === "bartender /purgeduck status";
}

function summarizePurgeState(state) {
  if (!state) return { status: "not_started" };
  return {
    status: state.status,
    targetBotId: state.targetBotId,
    scanned: Number(state.scanned || 0),
    deleted: Number(state.deleted || 0),
    deleteFailures: Number(state.deleteFailures || 0),
    inaccessibleChannels: Number(state.inaccessibleChannels || 0),
    channelIndex: Number(state.channelIndex || 0),
    channelCount: Array.isArray(state.channelIds) ? state.channelIds.length : 0,
    pendingDeletes: Array.isArray(state.pendingDeleteIds) ? state.pendingDeleteIds.length : 0,
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    farewellSentAt: state.farewellSentAt || null,
    departedAt: state.departedAt || null,
    lastError: state.lastError || null,
  };
}

export class FinalPurgeGateway extends PurgeSentientGateway {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/purge-status" && request.method === "GET") {
      const purgeState = await this.getPurgeState();
      return json({ ok: true, purge: summarizePurgeState(purgeState) });
    }

    if (url.pathname === "/purge-ready" && request.method === "POST") {
      if (!this.env.SENTIENT_BARTENDER_TOKEN) {
        return json({ ok: false, error: "SENTIENT_BARTENDER_TOKEN is missing." }, 500);
      }
      if (!this.targetGuild()) {
        return json({ ok: false, error: "SENTIENT_GUILD_ID is missing." }, 500);
      }

      let purgeState = await this.getPurgeState();
      if (purgeState?.status === "departed") {
        this.enabled = false;
        this.ownerSilenced = true;
        await this.ctx.storage.put("enabled", false);
        await this.ctx.storage.put("ownerSilenced", true);
        return json({ ok: true, departed: true, purge: summarizePurgeState(purgeState) });
      }

      if (!purgeState) {
        const farewellChannelId =
          this.env.SENTIENT_TAVERN_CHAT_CHANNEL_ID ||
          this.allowedChannels()[0] ||
          null;

        if (!farewellChannelId) {
          return json({
            ok: false,
            error: "No Tavern/AI channel is configured for the final farewell.",
          }, 500);
        }

        purgeState = await this.startDuckPurge(farewellChannelId);
      } else if (purgeState.status === "running" || purgeState.status === "departing") {
        await this.schedulePurge(100);
      }

      this.enabled = false;
      this.ownerSilenced = true;
      await this.ctx.storage.put("enabled", false);
      await this.ctx.storage.put("ownerSilenced", true);

      const summary = summarizePurgeState(purgeState);
      console.log("[BARTENDER FINAL PURGE] ready", JSON.stringify(summary));
      return json({ ok: true, autoPurgeStarted: true, purge: summary });
    }

    return super.fetch(request);
  }

  async alarm() {
    await super.alarm();
    const state = await this.getPurgeState();
    console.log("[BARTENDER FINAL PURGE] progress", JSON.stringify(summarizePurgeState(state)));
  }

  async handleOwnerControl(message, content) {
    if (!isFinalPurgeCommand(content)) return false;
    return super.handleOwnerControl(message, content);
  }
}

export default worker;
