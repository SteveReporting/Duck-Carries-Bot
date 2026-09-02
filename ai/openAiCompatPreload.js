const { createLocalResponse } = require("./localResponses");

const originalFetch = global.fetch;

if (typeof originalFetch !== "function") {
    throw new Error("Node.js global fetch is required for the local AI compatibility layer.");
}

// Legacy modules still check this variable before making a request. Give them a
// harmless local marker so they keep working while every OpenAI Responses call
// is intercepted and answered by Ollama instead of leaving the server.
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = "local-ollama";

function isOpenAiResponsesUrl(input) {
    const value = typeof input === "string" ? input : input?.url;
    return /^https:\/\/api\.openai\.com\/v1\/responses(?:\?|$)/i.test(String(value || ""));
}

global.fetch = async function localAiCompatibleFetch(input, init = {}) {
    if (!isOpenAiResponsesUrl(input)) {
        return originalFetch(input, init);
    }

    try {
        const payload = typeof init.body === "string"
            ? JSON.parse(init.body)
            : (init.body || {});

        const result = await createLocalResponse(payload, {
            timeoutMs: Number(process.env.LOCAL_AI_TIMEOUT_MS) || 120000,
            modelFallback: "qwen3:8b",
        });

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: { message: `Local AI compatibility error: ${error.message}` },
        }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
        });
    }
};

console.log("🤖 OpenAI Responses compatibility redirected to local Ollama.");
