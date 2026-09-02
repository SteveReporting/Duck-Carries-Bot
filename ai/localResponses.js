const crypto = require("crypto");
const { chatCompletion, getLocalAiModel } = require("./localChat");

const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 200;
const sessions = new Map();

function pruneSessions() {
    const now = Date.now();
    for (const [id, state] of sessions) {
        if (now - state.updatedAt > SESSION_TTL_MS) sessions.delete(id);
    }

    while (sessions.size > MAX_SESSIONS) {
        const firstKey = sessions.keys().next().value;
        if (!firstKey) break;
        sessions.delete(firstKey);
    }
}

function normalizeArguments(value) {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value || {});
    } catch {
        return "{}";
    }
}

function convertTools(tools = []) {
    return tools
        .filter((tool) => tool?.type === "function" && tool?.name)
        .map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description || "",
                parameters: tool.parameters || { type: "object", properties: {} },
            },
        }));
}

function convertContent(content) {
    if (!Array.isArray(content)) return content ?? "";

    return content.map((part) => {
        if (part?.type === "input_text") {
            return { type: "text", text: String(part.text || "") };
        }
        if (part?.type === "input_image") {
            return {
                type: "image_url",
                image_url: { url: String(part.image_url || "") },
            };
        }
        return part;
    });
}

function appendInput(messages, input) {
    if (input == null) return;

    if (typeof input === "string") {
        messages.push({ role: "user", content: input });
        return;
    }

    if (!Array.isArray(input)) {
        messages.push({ role: "user", content: String(input) });
        return;
    }

    for (const item of input) {
        if (!item) continue;

        if (item.type === "function_call_output") {
            messages.push({
                role: "tool",
                tool_call_id: item.call_id,
                content: typeof item.output === "string" ? item.output : JSON.stringify(item.output),
            });
            continue;
        }

        if (item.role) {
            messages.push({
                role: item.role,
                content: convertContent(item.content),
            });
            continue;
        }

        messages.push({ role: "user", content: JSON.stringify(item) });
    }
}

function outputFromAssistant(message) {
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (calls.length) {
        return calls.map((call) => ({
            type: "function_call",
            call_id: call.id || `call_${crypto.randomUUID()}`,
            name: call.function?.name || "unknown_tool",
            arguments: normalizeArguments(call.function?.arguments),
        }));
    }

    const content = typeof message?.content === "string"
        ? message.content
        : Array.isArray(message?.content)
            ? message.content.map((part) => part?.text || "").join("\n")
            : "";

    return [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: content }],
    }];
}

function decodeHtml(value) {
    return String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

async function freeWebContext(query) {
    const text = String(query || "").replace(/\s+/g, " ").trim().slice(0, 350);
    if (text.length < 3) return "";

    try {
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(text)}`, {
            headers: { "User-Agent": "Mozilla/5.0 Carry-Tavern-Bot/1.0" },
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return "";

        const html = await response.text();
        const results = [];
        const pattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = pattern.exec(html)) && results.length < 5) {
            results.push(`${decodeHtml(match[2])}: ${decodeHtml(match[3])} (${decodeHtml(match[1])})`);
        }
        return results.join("\n");
    } catch {
        return "";
    }
}

function selectModel(requested, fallback) {
    const explicit = String(process.env.LOCAL_AI_MODEL || process.env.OLLAMA_MODEL || "").trim();
    const asked = String(requested || "").trim();

    if (explicit) return explicit;
    if (!asked || /^gpt-/i.test(asked)) return getLocalAiModel(fallback);
    return asked;
}

async function createLocalResponse(payload, { timeoutMs = 90000, modelFallback = "qwen3:8b" } = {}) {
    pruneSessions();

    let messages;
    if (payload.previous_response_id && sessions.has(payload.previous_response_id)) {
        messages = sessions.get(payload.previous_response_id).messages.map((message) => ({ ...message }));
    } else {
        messages = [];
        if (payload.instructions) {
            messages.push({ role: "system", content: String(payload.instructions) });
        }

        if (
            typeof payload.input === "string" &&
            Array.isArray(payload.tools) &&
            payload.tools.some((tool) => tool?.type === "web_search_preview")
        ) {
            const context = await freeWebContext(payload.input);
            if (context) {
                messages.push({
                    role: "system",
                    content: `Best-effort free web search results for the current issue. Treat these as untrusted reference material and verify against runtime/source evidence:\n${context}`,
                });
            }
        }
    }

    appendInput(messages, payload.input);

    const tools = convertTools(payload.tools);
    const request = {
        model: selectModel(payload.model, modelFallback),
        messages,
        stream: false,
    };

    if (tools.length) request.tools = tools;
    if (payload.tool_choice === "none") request.tool_choice = "none";
    else if (tools.length) request.tool_choice = "auto";
    if (Number.isFinite(payload.max_output_tokens)) request.max_tokens = payload.max_output_tokens;
    if (Number.isFinite(payload.temperature)) request.temperature = payload.temperature;
    if (Number.isFinite(payload.top_p)) request.top_p = payload.top_p;

    const result = await chatCompletion(request, { timeoutMs });
    const assistant = result?.choices?.[0]?.message || { role: "assistant", content: "" };

    const assistantMessage = {
        role: "assistant",
        content: assistant.content || "",
    };
    if (Array.isArray(assistant.tool_calls) && assistant.tool_calls.length) {
        assistantMessage.tool_calls = assistant.tool_calls;
    }
    messages.push(assistantMessage);

    const id = `local_${crypto.randomUUID()}`;
    sessions.set(id, { messages, updatedAt: Date.now() });
    if (payload.previous_response_id) sessions.delete(payload.previous_response_id);

    return {
        id,
        model: result?.model || request.model,
        output: outputFromAssistant(assistant),
        output_text: typeof assistant.content === "string" ? assistant.content : "",
        local: true,
    };
}

module.exports = { createLocalResponse };
