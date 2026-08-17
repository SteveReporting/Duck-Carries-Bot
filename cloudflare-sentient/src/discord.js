const DISCORD_API = "https://discord.com/api/v10";

async function discordRequest(env, path, options = {}) {
  if (!env.SENTIENT_BARTENDER_TOKEN) {
    throw new Error("SENTIENT_BARTENDER_TOKEN is not configured.");
  }

  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${env.SENTIENT_BARTENDER_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

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
    throw new Error(`Discord ${response.status} on ${path}: ${detail}`);
  }

  return body;
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

export async function getChannel(env, channelId) {
  return discordRequest(env, `/channels/${channelId}`, { method: "GET" });
}

export async function renameChannel(env, channelId, name) {
  return discordRequest(env, `/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}
