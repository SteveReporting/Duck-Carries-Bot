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
                content: item.content ?? "",
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
    }

    appendInput(messages, payload.input);

    const tools = convertTools(payload.tools);
    const request = {
        model: payload.model || getLocalAiModel(modelFallback),
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
