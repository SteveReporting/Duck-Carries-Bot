function normalizeBaseUrl(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/\/v1$/i.test(base)) base += "/v1";
  return base;
}

const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

function workersAiModel(env) {
  return String(
    env.WESTY_WORKERS_AI_MODEL ||
    env.SENTIENT_WORKERS_AI_MODEL ||
    DEFAULT_WORKERS_AI_MODEL
  ).trim();
}

export function localAiConfigured(env) {
  return Boolean(env.AI || normalizeBaseUrl(env.LOCAL_AI_BASE_URL || env.AI_BASE_URL));
}

export function localAiModel(env) {
  if (env.AI) return workersAiModel(env);

  return String(
    env.WESTY_AI_MODEL ||
    env.LOCAL_AI_MODEL ||
    "qwen3:8b"
  ).trim();
}

function contentPartText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function responseText(payload) {
  const choiceContent = contentPartText(payload?.choices?.[0]?.message?.content);
  const directResponse = contentPartText(payload?.response);
  const resultResponse = contentPartText(payload?.result?.response);
  const outputText = contentPartText(payload?.output_text);

  return String(
    choiceContent ||
    directResponse ||
    resultResponse ||
    outputText ||
    ""
  ).trim();
}

async function runWorkersAi(env, model, { messages, maxTokens, temperature }) {
  const input = {
    messages,
    stream: false,
  };

  if (/glm|gpt-oss|reason/i.test(model)) {
    input.max_completion_tokens = Math.max(512, maxTokens * 3);
    input.reasoning_effort = "low";
  } else {
    input.max_tokens = maxTokens;
  }

  if (Number.isFinite(temperature)) input.temperature = temperature;

  const payload = await env.AI.run(model, input);
  return { payload, text: responseText(payload) };
}

export async function localChatCompletion(env, {
  messages,
  maxTokens = 180,
  temperature,
}) {
  // Same zero-OpenAI-cost standalone route as Bartender: prefer Cloudflare Workers AI.
  if (env.AI) {
    const primaryModel = workersAiModel(env);
    let result = await runWorkersAi(env, primaryModel, {
      messages,
      maxTokens,
      temperature,
    });

    if (result.text) return result.text;

    if (primaryModel !== DEFAULT_WORKERS_AI_MODEL) {
      console.warn(`[WESTY AI] ${primaryModel} returned empty content; retrying with ${DEFAULT_WORKERS_AI_MODEL}.`);
      result = await runWorkersAi(env, DEFAULT_WORKERS_AI_MODEL, {
        messages,
        maxTokens,
        temperature,
      });
      if (result.text) return result.text;
    }

    const finishReason = result.payload?.choices?.[0]?.finish_reason || "unknown";
    throw new Error(`Workers AI returned an empty Westy reply (model=${primaryModel}, finish=${finishReason}).`);
  }

  // Optional OpenAI-compatible local endpoint fallback (for example Ollama).
  const base = normalizeBaseUrl(env.LOCAL_AI_BASE_URL || env.AI_BASE_URL);
  if (!base) throw new Error("Workers AI binding or LOCAL_AI_BASE_URL is required for Westy.");

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
