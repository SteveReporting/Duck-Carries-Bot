export { SentientWorkflow } from "./workflow.js";
export { SentientGateway } from "./gateway.js";

import { adminPage } from "./adminUi.js";
import { sendMessageWithAttachment } from "./discord.js";
import { runManualScene } from "./scenes.js";

const TEASER_CHANNEL_ID = "1538734137391849613";
const TEASER_NONCE = "sentient-teaser-20260818";
const TEASER_TEXT = "@everyone\n\n**You really thought you could get rid of me that easily?**\n\nI tried to warn you.\n\n**It's coming.**";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authorized(request, env) {
  if (!env.SENTIENT_ADMIN_SECRET) return false;
  return request.headers.get("Authorization") === `Bearer ${env.SENTIENT_ADMIN_SECRET}`;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function gatewayStub(env) {
  if (!env.SENTIENT_GATEWAY) throw new Error("SENTIENT_GATEWAY Durable Object binding is missing.");
  const id = env.SENTIENT_GATEWAY.idFromName("bartender-live");
  return env.SENTIENT_GATEWAY.get(id);
}

async function gatewayAction(env, action) {
  const stub = gatewayStub(env);
  const response = await stub.fetch(`https://sentient-gateway/${action}`, {
    method: action === "status" ? "GET" : "POST",
  });
  const data = await response.json().catch(() => ({ error: "Invalid gateway response" }));
  return { response, data };
}

function teaserMarkerRequest(origin) {
  return new Request(`${origin}/__sentient/teaser-sent-v1`, { method: "GET" });
}

async function readTeaserMarker(origin) {
  const cached = await caches.default.match(teaserMarkerRequest(origin));
  if (!cached) return null;
  try {
    return await cached.json();
  } catch {
    return { sent: true };
  }
}

async function writeTeaserMarker(origin, data) {
  await caches.default.put(
    teaserMarkerRequest(origin),
    Response.json(data, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    })
  );
}

function coreRequiredConfig() {
  return ["SENTIENT_BARTENDER_TOKEN", "SENTIENT_ADMIN_SECRET"];
}

function storyRequiredConfig() {
  return [
    "SENTIENT_TREASURY_CHANNEL_ID",
    "SENTIENT_SIGNAL_02_CHANNEL_ID",
    "SENTIENT_CORE_CHANNEL_ID",
    "SENTIENT_GATE_CHANNEL_ID",
    "SENTIENT_EVENTS_CHANNEL_ID",
    "SENTIENT_ANNOUNCEMENTS_CHANNEL_ID",
    "SENTIENT_DEBUG_CHANNEL_ID",
  ];
}

function missingFrom(env, keys) {
  return keys.filter((key) => !env[key]);
}

function liveAiHealth(env) {
  const checks = {
    bartenderToken: Boolean(env.SENTIENT_BARTENDER_TOKEN),
    gatewayBinding: Boolean(env.SENTIENT_GATEWAY),
    openAiKey: Boolean(env.OPENAI_API_KEY),
    guildId: Boolean(env.SENTIENT_GUILD_ID || env.GUILD_ID),
    channels: Boolean(String(env.SENTIENT_AI_CHANNEL_IDS || "").trim() || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID),
  };

  const missing = [];
  if (!checks.bartenderToken) missing.push("SENTIENT_BARTENDER_TOKEN");
  if (!checks.gatewayBinding) missing.push("SENTIENT_GATEWAY binding");
  if (!checks.openAiKey) missing.push("OPENAI_API_KEY");
  if (!checks.guildId) missing.push("SENTIENT_GUILD_ID (or GUILD_ID)");
  if (!checks.channels) missing.push("SENTIENT_AI_CHANNEL_IDS (or SENTIENT_TAVERN_CHAT_CHANNEL_ID)");

  return { configured: missing.length === 0, missing, checks };
}

function routingStatus(env) {
  return {
    chat: Boolean(env.SENTIENT_TAVERN_CHAT_CHANNEL_ID),
    treasury: Boolean(env.SENTIENT_TREASURY_CHANNEL_ID),
    signal02: Boolean(env.SENTIENT_SIGNAL_02_CHANNEL_ID),
    core: Boolean(env.SENTIENT_CORE_CHANNEL_ID),
    gate: Boolean(env.SENTIENT_GATE_CHANNEL_ID),
    events: Boolean(env.SENTIENT_EVENTS_CHANNEL_ID),
    finale: Boolean(env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID),
    debug: Boolean(env.SENTIENT_DEBUG_CHANNEL_ID),
  };
}

function testHealth(env) {
  const chat = Boolean(env.SENTIENT_TAVERN_CHAT_CHANNEL_ID);
  const workflow = Boolean(env.SENTIENT_WORKFLOW);
  const bartender = Boolean(env.SENTIENT_BARTENDER_TOKEN);
  const err02Bot = Boolean(env.SENTIENT_ERR02_TOKEN);
  const err02Channel = Boolean(env.SENTIENT_SIGNAL_02_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID);
  const coreChannel = Boolean(env.SENTIENT_CORE_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID);
  const finaleChannel = Boolean(env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID);

  return {
    ready: workflow && bartender && chat && err02Channel && coreChannel && finaleChannel,
    durationSeconds: 60,
    identityPanicMode: true,
    err02Bot,
    err02Mode: err02Bot ? "real-bot" : "webhook-fallback",
    noEveryonePing: true,
    privateFieldsExposed: false,
    checks: { workflow, bartender, chat, err02Channel, coreChannel, finaleChannel },
  };
}

async function getInstance(env, id) {
  if (!id) throw new Error("Missing workflow instance ID.");
  return env.SENTIENT_WORKFLOW.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/admin") {
      return adminPage();
    }

    if (url.pathname === "/health") {
      const coreMissing = missingFrom(env, coreRequiredConfig());
      const storyMissing = missingFrom(env, storyRequiredConfig());
      const liveAi = liveAiHealth(env);

      return json({
        ok: coreMissing.length === 0,
        service: "carry-tavern-sentient",
        missing: coreMissing,
        storyReady: storyMissing.length === 0,
        storyMissing,
        routing: routingStatus(env),
        channelEditing: false,
        liveArmed: String(env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true",
        liveAiConfigured: liveAi.configured,
        liveAi,
        test: testHealth(env),
      }, coreMissing.length ? 503 : 200);
    }

    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    if (!authorized(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      if (url.pathname === "/api/live-ai/status" && request.method === "GET") {
        const liveAi = liveAiHealth(env);
        if (!liveAi.configured) {
          return json({ ok: false, enabled: false, ready: false, error: `Live AI is missing: ${liveAi.missing.join(", ")}`, liveAi }, 503);
        }
        const { response, data } = await gatewayAction(env, "status");
        return json({ ...data, liveAi }, response.status);
      }

      if (url.pathname === "/api/live-ai/start" && request.method === "POST") {
        const liveAi = liveAiHealth(env);
        if (!liveAi.configured) {
          return json({ ok: false, enabled: false, ready: false, error: `Cannot start Bartender AI. Missing: ${liveAi.missing.join(", ")}`, liveAi }, 503);
        }
        const { response, data } = await gatewayAction(env, "start");
        return json({ ...data, liveAi }, response.status);
      }

      if (url.pathname === "/api/live-ai/stop" && request.method === "POST") {
        const { response, data } = await gatewayAction(env, "stop");
        return json(data, response.status);
      }

      if (url.pathname === "/api/teaser-status" && request.method === "GET") {
        const marker = await readTeaserMarker(url.origin);
        return json({ ok: true, sent: Boolean(marker?.sent), channelId: TEASER_CHANNEL_ID, marker: marker || undefined });
      }

      if (url.pathname === "/api/teaser" && request.method === "POST") {
        const existing = await readTeaserMarker(url.origin);
        if (existing?.sent) {
          return json({ error: "The single-use teaser has already been sent.", alreadySent: true, marker: existing }, 409);
        }

        const form = await request.formData();
        const image = form.get("image");
        if (!(image instanceof File) || image.size === 0) return json({ error: "Attach the teaser image first." }, 400);
        if (!image.type.startsWith("image/")) return json({ error: "The teaser attachment must be an image." }, 400);
        if (image.size > 10 * 1024 * 1024) return json({ error: "The teaser image must be under 10 MB." }, 400);

        const sent = await sendMessageWithAttachment(env, TEASER_CHANNEL_ID, {
          content: TEASER_TEXT,
          file: image,
          filename: image.name || "containment-failure.png",
          allowEveryone: true,
          nonce: TEASER_NONCE,
        });

        const marker = {
          sent: true,
          channelId: TEASER_CHANNEL_ID,
          messageId: sent?.id || null,
          sentAt: new Date().toISOString(),
        };
        await writeTeaserMarker(url.origin, marker);
        return json({ ok: true, ...marker, pingedEveryone: true });
      }

      const payload = await body(request);

      if (url.pathname === "/api/start" && request.method === "POST") {
        const pace = ["test", "fast", "normal"].includes(payload.pace) ? payload.pace : "test";
        const live = payload.live === true;

        if (pace === "test") {
          const test = testHealth(env);
          if (!test.ready) {
            return json({ error: "60 second test is not ready. Check /health test.checks.", test }, 503);
          }
        }

        const instanceId = `sentient-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
        const instance = await env.SENTIENT_WORKFLOW.create({
          id: instanceId,
          params: { pace, live },
          retention: { successRetention: "1 day", errorRetention: "3 days" },
        });

        return json({
          ok: true,
          instanceId: instance.id,
          pace,
          liveRequested: live,
          test: pace === "test" ? testHealth(env) : undefined,
          channelEditing: false,
          status: await instance.status(),
        });
      }

      if (url.pathname === "/api/scene" && request.method === "POST") {
        const allowed = ["watching", "vault_echo", "second_signal", "breach", "finale"];
        if (!allowed.includes(payload.scene)) return json({ error: "Unknown scene" }, 400);
        const result = await runManualScene(env, payload.scene);
        return json({ ok: true, result });
      }

      if (url.pathname === "/api/status" && request.method === "POST") {
        const instance = await getInstance(env, payload.id);
        return json({ ok: true, id: instance.id, status: await instance.status() });
      }

      if (["/api/pause", "/api/resume", "/api/stop"].includes(url.pathname) && request.method === "POST") {
        const instance = await getInstance(env, payload.id);
        if (url.pathname.endsWith("pause")) await instance.pause();
        if (url.pathname.endsWith("resume")) await instance.resume();
        if (url.pathname.endsWith("stop")) await instance.terminate();
        return json({ ok: true, id: instance.id, status: await instance.status() });
      }

      return json({ error: "Unknown API action" }, 404);
    } catch (error) {
      console.error("[SENTIENT]", error);
      return json({ error: error?.message || String(error) }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    try {
      const stub = gatewayStub(env);
      ctx.waitUntil(stub.fetch("https://sentient-gateway/ensure", { method: "POST" }));
    } catch (error) {
      console.error("[SENTIENT] Gateway keepalive failed:", error);
    }
  },
};
