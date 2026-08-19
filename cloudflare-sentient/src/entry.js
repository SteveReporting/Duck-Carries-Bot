export { SentientWorkflow } from "./workflow.js";
export { SentientGateway } from "./gateway.js";

import sentientApp from "./index.js";
import { maybeSendErr02Ambient } from "./err02Ambient.js";

const DISCORD_API = "https://discord.com/api/v10";
const MATISSE_USER_ID = "1493006418759127222";
const MATISSE_PING_MARKER_URL = "https://sentient.internal/__sentient/matisse-carry-ping-v1";

async function maybeSendMatisseCarryPing(env) {
  if (!env.SENTIENT_BARTENDER_TOKEN || !env.SENTIENT_TAVERN_CHAT_CHANNEL_ID) {
    return { sent: false, reason: "missing-config" };
  }

  const markerRequest = new Request(MATISSE_PING_MARKER_URL, { method: "GET" });
  const existing = await caches.default.match(markerRequest);
  if (existing) return { sent: false, reason: "already-sent" };

  const response = await fetch(`${DISCORD_API}/channels/${env.SENTIENT_TAVERN_CHAT_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.SENTIENT_BARTENDER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: `<@${MATISSE_USER_ID}> Hey Matisse, Are you still carrying?`,
      allowed_mentions: {
        parse: [],
        users: [MATISSE_USER_ID],
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Discord ${response.status} while sending Matisse carry ping: ${JSON.stringify(body)}`);
  }

  await caches.default.put(
    markerRequest,
    Response.json(
      {
        sent: true,
        userId: MATISSE_USER_ID,
        messageId: body?.id || null,
        sentAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, max-age=31536000, immutable" } }
    )
  );

  return { sent: true, messageId: body?.id || null };
}

export default {
  fetch(request, env, ctx) {
    return sentientApp.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof sentientApp.scheduled === "function") {
      await sentientApp.scheduled(controller, env, ctx);
    }

    ctx.waitUntil(
      maybeSendErr02Ambient(env)
        .then((result) => {
          if (result?.sent) {
            console.log(`[SENTIENT] ERR_02 ambient message sent: ${result.messageId || "unknown"}`);
          }
        })
        .catch((error) => {
          console.error("[SENTIENT] ERR_02 ambient message failed:", error);
        })
    );

    ctx.waitUntil(
      maybeSendMatisseCarryPing(env)
        .then((result) => {
          if (result?.sent) {
            console.log(`[SENTIENT] Matisse carry ping sent: ${result.messageId || "unknown"}`);
          }
        })
        .catch((error) => {
          console.error("[SENTIENT] Matisse carry ping failed:", error);
        })
    );
  },
};
