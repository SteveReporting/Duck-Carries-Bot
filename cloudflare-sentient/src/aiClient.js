function normalizeBaseUrl(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/\/v1$/i.test(base)) base += "/v1";
  return base;
}

export function localAiConfigured(env) {
  return Boolean(normalizeBaseUrl(env.LOCAL_AI_BASE_URL || env.AI_BASE_URL));
}

export function localAiModel(env) {
  return String(
    env.SENTIENT_AI_MODEL ||
    env.LOCAL_AI_MODEL ||
    "qwen3:8b"
  ).trim();
}

export async function localChatCompletion(env, {
  messages,
  maxTokens = 180,
  temperature,
}) {
  const base = normalizeBaseUrl(env.LOCAL_AI_BASE_URL || env.AI_BASE_URL);
  if (!base) throw new Error("LOCAL_AI_BASE_URL is not configured for Sentient.");

  const headers = {
    "Content-Type": "application/json",
  };

  const key = String(env.LOCAL_AI_API_KEY || env.AI_API_KEY || "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const body = {
    model: localAiModel(env),
    messages,
    max_tokens: maxTokens,
    stream: false,
  };
  if (Number.isFinite(temperature)) body.temperature = temperature;

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || `Local AI HTTP ${response.status}`);
  }

  return String(payload?.choices?.[0]?.message?.content || "").trim();
}
