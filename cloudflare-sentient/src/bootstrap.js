import worker, { SentientGateway, SentientWorkflow } from "./purgeMain.js";

export { SentientGateway, SentientWorkflow };

function gatewayStub(env) {
  if (!env.SENTIENT_GATEWAY) throw new Error("SENTIENT_GATEWAY Durable Object binding is missing.");
  const id = env.SENTIENT_GATEWAY.idFromName("bartender-live");
  return env.SENTIENT_GATEWAY.get(id);
}

async function ensureGateway(env) {
  const response = await gatewayStub(env).fetch("https://sentient-gateway/ensure", {
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Bartender ensure failed (${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
}

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      ensureGateway(env).catch((error) => {
        console.error("[BARTENDER] Scheduled reconnect failed:", error);
      }),
    );
  },
};
