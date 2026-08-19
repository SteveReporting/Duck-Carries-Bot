const DISCORD_API = "https://discord.com/api/v10";
const COMPONENTS_V2_FLAG = 1 << 15;
const SENTIENT_WEBHOOK_NAME = "Sentient Relay";

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

async function requestWithToken(token, path, options = {}, label = path) {
  if (!token) throw new Error("Discord bot token is not configured.");
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return parseResponse(response, label);
}

async function discordRequest(env, path, options = {}) {
  if (!env.SENTIENT_BARTENDER_TOKEN) {
    throw new Error("SENTIENT_BARTENDER_TOKEN is not configured.");
  }
  return requestWithToken(env.SENTIENT_BARTENDER_TOKEN, path, options);
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

export async function sendMessageAsBotToken(token, channelId, {
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

  return requestWithToken(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  }, `/channels/${channelId}/messages (alternate bot)`);
}

export async function sendMessageWithAttachment(env, channelId, {
  content,
  file,
  filename = "sentient-teaser.png",
  allowEveryone = false,
  nonce,
}) {
  if (!env.SENTIENT_BARTENDER_TOKEN) {
    throw new Error("SENTIENT_BARTENDER_TOKEN is not configured.");
  }
  if (!channelId) throw new Error("Missing Discord channel ID.");
  if (!(file instanceof Blob)) throw new Error("Missing teaser image file.");

  const payload = {
    content,
    allowed_mentions: {
      parse: allowEveryone ? ["everyone"] : [],
    },
  };

  if (nonce) {
    payload.nonce = String(nonce).slice(0, 25);
    payload.enforce_nonce = true;
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", file, filename);

  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.SENTIENT_BARTENDER_TOKEN}`,
    },
    body: form,
  });

  return parseResponse(response, `/channels/${channelId}/messages`);
}

export async function sendComponentMessage(env, channelId, {
  components,
  allowEveryone = false,
  nonce,
}) {
  if (!channelId) throw new Error("Missing Discord channel ID.");
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error("Components V2 message requires components.");
  }

  const body = {
    flags: COMPONENTS_V2_FLAG,
    components,
    allowed_mentions: {
      parse: allowEveryone ? ["everyone"] : [],
    },
  };

  if (nonce) {
    body.nonce = String(nonce).slice(0, 25);
    body.enforce_nonce = true;
  }

  return discordRequest(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function getOrCreateWebhook(env, channelId) {
  const hooks = await discordRequest(env, `/channels/${channelId}/webhooks`, { method: "GET" });
  let hook = Array.isArray(hooks)
    ? hooks.find((item) => item?.type === 1 && item?.name === SENTIENT_WEBHOOK_NAME && item?.token)
    : null;

  if (!hook) {
    hook = await discordRequest(env, `/channels/${channelId}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ name: SENTIENT_WEBHOOK_NAME }),
    });
  }

  if (!hook?.id || !hook?.token) {
    throw new Error(`Sentient webhook in channel ${channelId} is missing an executable token.`);
  }

  return hook;
}

export async function sendWebhookIdentity(env, channelId, {
  username,
  avatarUrl,
  content,
  components,
  allowEveryone = false,
}) {
  if (!channelId) throw new Error("Missing Discord channel ID.");
  const hook = await getOrCreateWebhook(env, channelId);
  const hasComponents = Array.isArray(components) && components.length > 0;
  const query = new URLSearchParams({ wait: "true" });
  if (hasComponents) query.set("with_components", "true");

  const body = {
    username: username || "Sentient",
    allowed_mentions: {
      parse: allowEveryone ? ["everyone"] : [],
    },
  };

  if (avatarUrl) body.avatar_url = avatarUrl;
  if (content) body.content = content;
  if (hasComponents) {
    body.flags = COMPONENTS_V2_FLAG;
    body.components = components;
  }

  const response = await fetch(
    `${DISCORD_API}/webhooks/${hook.id}/${hook.token}?${query.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  return parseResponse(response, `/webhooks/${hook.id}/...`);
}

export function textDisplay(content) {
  return { type: 10, content };
}

export function separator(spacing = 2, divider = true) {
  return { type: 14, spacing, divider };
}

export function container(components, accentColor) {
  const value = {
    type: 17,
    components,
  };
  if (Number.isInteger(accentColor)) value.accent_color = accentColor;
  return value;
}

export function mediaGallery(url, description) {
  return {
    type: 12,
    items: [
      {
        media: { url },
        ...(description ? { description } : {}),
      },
    ],
  };
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
