// Final shutdown bootstrap. The old Bartender Durable Object can keep an old
// Discord WebSocket alive across Worker deployments, so explicitly stop that
// object first, then start a brand-new purge-only Durable Object class.
import worker, {
  SentientGateway,
  FinalPurgeGateway,
  SentientWorkflow,
} from "./finalPurgeMain.js";

export { SentientGateway, FinalPurgeGateway, SentientWorkflow };

function oldGatewayStub(env) {
  if (!env.SENTIENT_GATEWAY) throw new Error("SENTIENT_GATEWAY Durable Object binding is missing.");
  const id = env.SENTIENT_GATEWAY.idFromName("bartender-live");
  return env.SENTIENT_GATEWAY.get(id);
}

function finalGatewayStub(env) {
  if (!env.SENTIENT_FINAL_PURGE_GATEWAY) {
    throw new Error("SENTIENT_FINAL_PURGE_GATEWAY Durable Object binding is missing.");
  }
  const id = env.SENTIENT_FINAL_PURGE_GATEWAY.idFromName("bartender-final-purge-v2");
  return env.SENTIENT_FINAL_PURGE_GATEWAY.get(id);
}

async function stopOldGateway(env) {
  const response = await oldGatewayStub(env).fetch("https://sentient-gateway/stop", {
    method: "POST",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Old Bartender stop failed (${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
}

async function ensureFinalPurgeGateway(env) {
  const response = await finalGatewayStub(env).fetch("https://sentient-final-purge/purge-ready", {
    method: "POST",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Final Bartender purge gateway failed (${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
}

async function prepareFinalGateway(env) {
  await stopOldGateway(env).catch((error) => {
    console.error("[BARTENDER FINAL PURGE] Old gateway stop warning:", error);
  });
  await ensureFinalPurgeGateway(env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Read-only diagnostics. This does not restart, stop or otherwise mutate the purge.
    if (url.pathname === "/final-purge-status" && request.method === "GET") {
      return finalGatewayStub(env).fetch("https://sentient-final-purge/purge-status", {
        method: "GET",
      });
    }

    ctx.waitUntil(
      prepareFinalGateway(env).catch((error) => {
        console.error("[BARTENDER FINAL PURGE] Request startup failed:", error);
      }),
    );
    return worker.fetch(request, env, ctx);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      prepareFinalGateway(env).catch((error) => {
        console.error("[BARTENDER FINAL PURGE] Scheduled startup failed:", error);
      }),
    );
  },
};
