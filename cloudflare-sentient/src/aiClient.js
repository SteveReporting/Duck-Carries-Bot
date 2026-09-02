function normalizeBaseUrl(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/\/v1$/i.test(base)) base += "/v1";
  return base;
}

function workersAiModel(env) {
  return String(
    env.SENTIENT_WORKERS_AI_MODEL ||
    "@cf/zai-org/glm-4.7-flash"
  ).trim();
}

export function localAiConfigured(env) {
  return Boolean(env.AI || normalizeBaseUrl(env.LOCAL_AI_BASE_URL || env.AI_BASE_URL));
}

export function localAiModel(env) {
  if (env.AI) return workersAiModel(env);

  return String(
    env.SENTIENT_AI_MODEL ||
    env.LOCAL_AI_MODEL ||
    "qwen3:8b"
  ).trim();
}

function responseText(payload) {
  return String(
    payload?.choices?.[0]?.message?.content ||
    payload?.response ||
    payload?.result?.response ||
    ""
  ).trim();
}

export async function localChatCompletion(env, {
  messages,
  maxTokens = 180,
  temperature,
}) {
  // Preferred standalone path: Cloudflare Workers AI. This keeps the live
  // Bartender self-contained and does not require OpenAI, Ollama, a VM-hosted
  // model, or an HTTPS tunnel back to the Carry Tavern server.
  if (env.AI) {
    const input = {
      messages,
      max_completion_tokens: maxTokens,
      stream: false,
    };
    if (Number.isFinite(temperature)) input.temperature = temperature;

    const payload = await env.AI.run(workersAiModel(env), input);
    const text = responseText(payload);
    if (!text) throw new Error("Workers AI returned an empty Sentient reply.");
    return text;
  }

  // Legacy fallback for anyone who intentionally configures an OpenAI-compatible
  // local/remote endpoint.
  const base = normalizeBaseUrl(env.LOCAL_AI_BASE_URL || env.AI_BASE_URL);
  if (!base) throw new Error("Workers AI binding or LOCAL_AI_BASE_URL is required for Sentient.");

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
    throw new Error(payload?.error?.message || payload?.error || `AI HTTP ${response.status}`);
  }

  return responseText(payload);
}
