const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen3:8b";

function normalizeBaseUrl(value) {
    let base = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    if (!/\/v1$/i.test(base)) base += "/v1";
    return base;
}

function getLocalAiBaseUrl() {
    return normalizeBaseUrl(
        process.env.LOCAL_AI_BASE_URL ||
        process.env.OLLAMA_BASE_URL ||
        process.env.AI_BASE_URL ||
        DEFAULT_BASE_URL
    );
}

function getLocalAiModel(fallback = DEFAULT_MODEL) {
    return String(
        process.env.LOCAL_AI_MODEL ||
        process.env.OLLAMA_MODEL ||
        fallback ||
        DEFAULT_MODEL
    ).trim();
}

function getLocalAiApiKey() {
    return String(
        process.env.LOCAL_AI_API_KEY ||
        process.env.AI_API_KEY ||
        "ollama"
    ).trim();
}

async function chatCompletion(payload, { timeoutMs = 90000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${getLocalAiBaseUrl()}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${getLocalAiApiKey()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                body?.error?.message ||
                body?.error ||
                `Local AI request failed with HTTP ${response.status}.`
            );
        }

        return body;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(`Local AI request timed out after ${timeoutMs / 1000}s.`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    chatCompletion,
    getLocalAiApiKey,
    getLocalAiBaseUrl,
    getLocalAiModel,
};
