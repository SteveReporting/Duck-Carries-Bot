function normalizeBaseUrl(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/\/v1$/i.test(base)) base += "/v1";
  return base;
}

const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

function workersAiModel(env) {
  return String(
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
    env.SENTIENT_AI_MODEL ||
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

  // Llama's Workers AI schema uses max_tokens. Reasoning/chat-completions style
  // models use max_completion_tokens; give them extra room so reasoning cannot
  // consume the entire visible-answer budget.
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
  // Preferred standalone path: Cloudflare Workers AI. This keeps the live
  // Bartender self-contained and does not require OpenAI, Ollama, a VM-hosted
  // model, or an HTTPS tunnel back to the Carry Tavern server.
  if (env.AI) {
    const primaryModel = workersAiModel(env);
    let result = await runWorkersAi(env, primaryModel, {
      messages,
      maxTokens,
      temperature,
    });

    if (result.text) return result.text;

    // Some reasoning models can legitimately finish with no visible content if
    // their reasoning budget consumes the completion. Retry once on the fast,
    // non-reasoning Llama model instead of making Discord silently stop typing.
    if (primaryModel !== DEFAULT_WORKERS_AI_MODEL) {
      console.warn(`[SENTIENT AI] ${primaryModel} returned empty content; retrying with ${DEFAULT_WORKERS_AI_MODEL}.`);
      result = await runWorkersAi(env, DEFAULT_WORKERS_AI_MODEL, {
        messages,
        maxTokens,
        temperature,
      });
      if (result.text) return result.text;
    }

    const finishReason = result.payload?.choices?.[0]?.finish_reason || "unknown";
    throw new Error(`Workers AI returned an empty Sentient reply (model=${primaryModel}, finish=${finishReason}).`);
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
