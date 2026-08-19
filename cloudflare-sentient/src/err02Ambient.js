const DISCORD_API = "https://discord.com/api/v10";
const STATE_URL = "https://sentient.internal/__sentient/err02-ambient-state-v1";

const LINES = [
  "it's coming.",
  "not much longer now.",
  "you were warned.",
  "the signal is getting louder.",
  "it can hear this room.",
  "stop asking what it is.",
  "you keep talking like it isn't listening.",
  "something is getting closer.",
  "don't let it answer.",
];

function envTrue(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function envNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stateRequest() {
  return new Request(STATE_URL, { method: "GET" });
}

async function readState() {
  const cached = await caches.default.match(stateRequest());
  if (!cached) return {};
  try {
    return await cached.json();
  } catch {
    return {};
  }
}

async function writeState(state) {
  await caches.default.put(
    stateRequest(),
    Response.json(state, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    })
  );
}

async function hasRecentHumanActivity(env, channelId, windowMs) {
  try {
    const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=8`, {
      headers: { Authorization: `Bot ${env.SENTIENT_ERR02_TOKEN}` },
    });

    if (!response.ok) return true;
    const messages = await response.json().catch(() => []);
    const cutoff = Date.now() - windowMs;

    return Array.isArray(messages) && messages.some((message) => {
      if (message?.author?.bot || message?.webhook_id) return false;
      const timestamp = Date.parse(message?.timestamp || "");
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
  } catch {
    return true;
  }
}

async function sendErr02Message(env, channelId, content) {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.SENTIENT_ERR02_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Discord ${response.status} while sending ERR_02 ambient message: ${JSON.stringify(body)}`);
  }
  return body;
}

export async function maybeSendErr02Ambient(env) {
  if (!envTrue(env.SENTIENT_ERR02_AMBIENT_ENABLED, true)) {
    return { sent: false, reason: "disabled" };
  }

  const token = String(env.SENTIENT_ERR02_TOKEN || "").trim();
  const channelId = String(env.SENTIENT_TAVERN_CHAT_CHANNEL_ID || "").trim();
  if (!token || !channelId) {
    return { sent: false, reason: "missing-config" };
  }

  const cooldownMs = Math.max(
    60_000,
    envNumber(env.SENTIENT_ERR02_AMBIENT_COOLDOWN_MS, 8 * 60_000)
  );
  const activityWindowMs = Math.max(
    60_000,
    envNumber(env.SENTIENT_ERR02_ACTIVITY_WINDOW_MS, 4 * 60_000)
  );
  const chance = Math.max(
    0,
    Math.min(1, envNumber(env.SENTIENT_ERR02_AMBIENT_CHANCE, 0.10))
  );

  const state = await readState();
  const now = Date.now();
  const lastSentAt = Number(state.lastSentAt) || 0;
  if (now - lastSentAt < cooldownMs) {
    return { sent: false, reason: "cooldown" };
  }

  const active = await hasRecentHumanActivity(env, channelId, activityWindowMs);
  if (!active) {
    return { sent: false, reason: "quiet-chat" };
  }

  if (Math.random() >= chance) {
    return { sent: false, reason: "chance" };
  }

  const available = LINES.filter((line) => line !== state.lastLine);
  const pool = available.length ? available : LINES;
  const line = pool[Math.floor(Math.random() * pool.length)];
  const message = await sendErr02Message(env, channelId, line);

  await writeState({
    lastSentAt: now,
    lastLine: line,
    lastMessageId: message?.id || null,
  });

  return {
    sent: true,
    line,
    messageId: message?.id || null,
    channelId,
  };
}
