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

export class FinalPurgeGateway extends PurgeSentientGateway {
  async fetch(request) {
    const url = new URL(request.url);

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
        return json({ ok: true, departed: true, purgeState });
      }

      // The final cleanup no longer depends on Discord MESSAGE_CREATE at all.
      // As soon as the new Worker deployment reaches this fresh object, begin
      // the authorized cleanup using Discord REST + Durable Object alarms.
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

      // Keep this replacement object silent. It does not need a Discord gateway
      // connection to scan/delete messages, send the farewell, or leave the guild.
      this.enabled = false;
      this.ownerSilenced = true;
      await this.ctx.storage.put("enabled", false);
      await this.ctx.storage.put("ownerSilenced", true);

      return json({ ok: true, autoPurgeStarted: true, purgeState });
    }

    return super.fetch(request);
  }

  async handleOwnerControl(message, content) {
    // Retain the commands as a status/manual fallback if this object is ever
    // connected later, but deployment itself now starts the cleanup.
    if (!isFinalPurgeCommand(content)) return false;
    return super.handleOwnerControl(message, content);
  }
}

export default worker;
