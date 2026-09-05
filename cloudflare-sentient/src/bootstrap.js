// Final shutdown bootstrap: use a fresh Durable Object instance so an older
// long-lived Discord WebSocket cannot keep serving stale pre-purge code.
import worker, { SentientGateway, SentientWorkflow } from "./finalPurgeMain.js";

export { SentientGateway, SentientWorkflow };

function gatewayStub(env) {
  if (!env.SENTIENT_GATEWAY) throw new Error("SENTIENT_GATEWAY Durable Object binding is missing.");
  const id = env.SENTIENT_GATEWAY.idFromName("bartender-final-purge-v1");
  return env.SENTIENT_GATEWAY.get(id);
}

async function ensureFinalPurgeGateway(env) {
  const response = await gatewayStub(env).fetch("https://sentient-gateway/purge-ready", {
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Final Bartender purge gateway failed (${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
}

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      ensureFinalPurgeGateway(env).catch((error) => {
        console.error("[BARTENDER FINAL PURGE] Scheduled startup failed:", error);
      }),
    );
  },
};
