import worker, {
  SentientGateway as PurgeSentientGateway,
  SentientWorkflow,
} from "./purgeMain.js";

export { SentientWorkflow };

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

export class SentientGateway extends PurgeSentientGateway {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/purge-ready" && request.method === "POST") {
      if (!this.env.SENTIENT_BARTENDER_TOKEN) {
        return json({ ok: false, error: "SENTIENT_BARTENDER_TOKEN is missing." }, 500);
      }
      if (!this.targetGuild()) {
        return json({ ok: false, error: "SENTIENT_GUILD_ID is missing." }, 500);
      }

      const purgeState = await this.getPurgeState();
      if (purgeState?.status === "departed") {
        this.enabled = false;
        this.ownerSilenced = true;
        await this.ctx.storage.put("enabled", false);
        await this.ctx.storage.put("ownerSilenced", true);
        return json({ ok: true, departed: true, ...this.status() });
      }

      // This fresh gateway exists only to receive the final purge command.
      // Keep all ordinary Bartender AI replies silenced while it is present.
      this.enabled = true;
      this.ownerSilenced = true;
      await this.ctx.storage.put("enabled", true);
      await this.ctx.storage.put("ownerSilenced", true);
      await this.ensureConnected();

      return json({ ok: true, purgeReady: true, ...this.status() });
    }

    return super.fetch(request);
  }

  async handleOwnerControl(message, content) {
    // On this replacement gateway, only expose the final cleanup controls.
    // Standard /status, /on and /off remain handled by the old gateway until it departs.
    if (!isFinalPurgeCommand(content)) return false;
    return super.handleOwnerControl(message, content);
  }
}

export default worker;
