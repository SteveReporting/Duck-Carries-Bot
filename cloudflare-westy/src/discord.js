const DISCORD_API = "https://discord.com/api/v10";

async function parseResponse(response, label) {
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`Discord ${response.status} on ${label}: ${detail}`);
  }

  return body;
}

async function discordRequest(env, path, options = {}) {
  if (!env.WESTY_BOT_TOKEN) {
    throw new Error("WESTY_BOT_TOKEN is not configured.");
  }

  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${env.WESTY_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  return parseResponse(response, path);
}

export async function sendMessage(env, channelId, {
  content,
  embeds,
  allowEveryone = false,
  nonce,
}) {
  if (!channelId) throw new Error("Missing Discord channel ID.");

  const body = {
    content,
    allowed_mentions: {
      parse: allowEveryone ? ["everyone"] : [],
    },
  };

  if (Array.isArray(embeds) && embeds.length) body.embeds = embeds;

  if (nonce) {
    body.nonce = String(nonce).slice(0, 25);
    body.enforce_nonce = true;
  }

  return discordRequest(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function triggerTyping(env, channelId) {
  if (!env.WESTY_BOT_TOKEN || !channelId) return;
  await fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
    method: "POST",
    headers: { Authorization: `Bot ${env.WESTY_BOT_TOKEN}` },
  }).catch(() => {});
}
