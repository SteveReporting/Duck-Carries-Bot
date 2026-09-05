export { WestyGateway } from "./gateway.js";

import { localAiConfigured, localAiModel } from "./aiClient.js";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function gatewayStub(env) {
  if (!env.WESTY_GATEWAY) throw new Error("WESTY_GATEWAY Durable Object binding is missing.");
  const id = env.WESTY_GATEWAY.idFromName("westy-live");
  return env.WESTY_GATEWAY.get(id);
}

async function gatewayAction(env, action) {
  const stub = gatewayStub(env);
  const response = await stub.fetch(`https://westy-gateway/${action}`, {
    method: action === "status" ? "GET" : "POST",
  });
  const data = await response.json().catch(() => ({ error: "Invalid gateway response" }));
  return { response, data };
}

function liveAiHealth(env) {
  const checks = {
    applicationId: env.WESTY_APPLICATION_ID || null,
    botToken: Boolean(env.WESTY_BOT_TOKEN),
    gatewayBinding: Boolean(env.WESTY_GATEWAY),
    ai: localAiConfigured(env),
    aiModel: localAiModel(env),
    guildId: Boolean(env.WESTY_GUILD_ID),
    channels: Boolean(String(env.WESTY_AI_CHANNEL_IDS || "").trim()),
  };

  const missing = [];
  if (!checks.botToken) missing.push("WESTY_BOT_TOKEN");
  if (!checks.gatewayBinding) missing.push("WESTY_GATEWAY binding");
  if (!checks.ai) missing.push("Workers AI binding or LOCAL_AI_BASE_URL");
  if (!checks.guildId) missing.push("WESTY_GUILD_ID");
  if (!checks.channels) missing.push("WESTY_AI_CHANNEL_IDS");

  return { configured: missing.length === 0, missing, checks };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      const liveAi = liveAiHealth(env);
      let gateway = null;

      if (liveAi.configured) {
        try {
          const ensured = await gatewayAction(env, "ensure");
          gateway = ensured.data;
        } catch (error) {
          gateway = { ok: false, error: error?.message || String(error) };
        }
      }

      if (url.pathname === "/") {
        return new Response("Westy is running.", {
          status: liveAi.configured ? 200 : 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }

      return json({
        ok: liveAi.configured && gateway?.ok !== false,
        service: "westy",
        applicationId: env.WESTY_APPLICATION_ID || null,
        liveAi,
        gateway,
        romanticOwnerOverride: false,
      }, liveAi.configured ? 200 : 503);
    }

    if (url.pathname === "/diagnostics" && request.method === "GET") {
      try {
        const liveAi = liveAiHealth(env);
        await gatewayAction(env, "ensure");
        const { response, data } = await gatewayAction(env, "status");
        return json({
          ok: response.ok,
          service: "westy",
          aiModel: localAiModel(env),
          liveAi,
          gateway: data,
        }, response.status);
      } catch (error) {
        return json({ ok: false, service: "westy", error: error?.message || String(error) }, 500);
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(gatewayAction(env, "ensure").catch((error) => {
      console.error("[WESTY] Scheduled reconnect failed:", error);
    }));
  },
};
