export { WestyGateway } from "./gateway.js";

import { adminPage } from "./adminUi.js";
import { localAiConfigured, localAiModel } from "./aiClient.js";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function authorized(request, env) {
  if (!env.WESTY_ADMIN_SECRET) return false;
  return request.headers.get("Authorization") === `Bearer ${env.WESTY_ADMIN_SECRET}`;
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

    if (url.pathname === "/" || url.pathname === "/admin") {
      return adminPage();
    }

    if (url.pathname === "/health") {
      const liveAi = liveAiHealth(env);
      return json({
        ok: liveAi.configured,
        service: "westy-discord",
        applicationId: env.WESTY_APPLICATION_ID || null,
        liveAiConfigured: liveAi.configured,
        liveAi,
        romanticOwnerOverride: false,
      }, liveAi.configured ? 200 : 503);
    }

    if (url.pathname === "/diagnostics" && request.method === "GET") {
      try {
        const liveAi = liveAiHealth(env);
        const { response, data } = await gatewayAction(env, "status");
        return json({
          ok: response.ok,
          service: "westy-discord",
          aiModel: localAiModel(env),
          liveAi,
          gateway: data,
        }, response.status);
      } catch (error) {
        return json({ ok: false, service: "westy-discord", error: error?.message || String(error) }, 500);
      }
    }

    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    if (!authorized(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (url.pathname === "/api/auth-check" && request.method === "GET") {
      return json({ ok: true, authorized: true });
    }

    if (url.pathname === "/api/live-ai/status" && request.method === "GET") {
      const liveAi = liveAiHealth(env);
      if (!liveAi.configured) {
        return json({ ok: false, enabled: false, ready: false, error: `Westy is missing: ${liveAi.missing.join(", ")}`, liveAi }, 503);
      }
      const { response, data } = await gatewayAction(env, "status");
      return json({ ...data, liveAi }, response.status);
    }

    if (url.pathname === "/api/live-ai/start" && request.method === "POST") {
      const liveAi = liveAiHealth(env);
      if (!liveAi.configured) {
        return json({ ok: false, enabled: false, ready: false, error: `Cannot start Westy. Missing: ${liveAi.missing.join(", ")}`, liveAi }, 503);
      }
      const { response, data } = await gatewayAction(env, "start");
      return json({ ...data, liveAi }, response.status);
    }

    if (url.pathname === "/api/live-ai/stop" && request.method === "POST") {
      const { response, data } = await gatewayAction(env, "stop");
      return json(data, response.status);
    }

    return json({ error: "Unknown API route" }, 404);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(gatewayAction(env, "ensure").catch((error) => {
      console.error("[WESTY] Scheduled reconnect failed:", error);
    }));
  },
};
