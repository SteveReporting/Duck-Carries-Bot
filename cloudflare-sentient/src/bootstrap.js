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
  // /stop exists in the original Bartender code, including the stale live
  // version, so this reliably closes the old WebSocket before replacement.
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
    // Continue to the replacement gateway even if the old object is already gone.
    console.error("[BARTENDER FINAL PURGE] Old gateway stop warning:", error);
  });
  await ensureFinalPurgeGateway(env);
}

export default {
  fetch(request, env, ctx) {
    // Any HTTP hit also repairs the final gateway immediately instead of waiting
    // for the next cron tick.
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
