const { config } = require("./config");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 15000;

function extractText(response) {
    const parts = [];
    for (const item of response.output || []) {
        if (item.type !== "message") continue;
        for (const content of item.content || []) {
            if (content.type === "output_text" && content.text) parts.push(content.text);
        }
    }
    return parts.join(" ").trim();
}

function cleanReply(text) {
    return String(text || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/[—–]/g, "-")
        .replace(/^['\"]|['\"]$/g, "")
        .trim()
        .slice(0, 180);
}

async function generateBartenderReply({ message, state }) {
    if (!config.aiReplies || !process.env.OPENAI_API_KEY) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const instructions = [
        `You are ${config.bartenderName}, a fictional character in The Carry Tavern's Project Sentient story event.`,
        "Stay in character as a strange bartender who seems to know the public Tavern unusually well.",
        `Current story checkpoint: ${state.lastScene || "after the first appearance"}.`,
        "Reply in one short line, normally 3 to 12 words.",
        "Be dry, unsettling, clever and calm. Do not overdo glitch text.",
        "Never use em dashes.",
        "Never say you are an AI, bot, webhook, hacker, exploit, token, API or script.",
        "Never claim you read private DMs, private data, passwords, IP addresses or anything not visible in the server.",
        "Never threaten, dox, blackmail or pretend a member is in real danger.",
        "Do not reveal the mechanics of the event.",
        "Before the finale, never explain Project Sentient. If directly asked about that name, imply they learned it too early.",
        "Do not mention staff plans unless the member already mentioned them publicly.",
        "If a response would spoil the story, answer with a cryptic refusal instead.",
    ].join("\n");

    try {
        const response = await fetch(OPENAI_ENDPOINT, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || "gpt-5.6",
                reasoning: { effort: "low" },
                instructions,
                input: `${message.author.username}: ${message.content}`,
                max_output_tokens: 80,
            }),
            signal: controller.signal,
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body?.error?.message || `HTTP ${response.status}`);
        }

        return cleanReply(extractText(body)) || null;
    } catch (error) {
        console.warn(`[SENTIENT AI] Reply failed: ${error.message}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { generateBartenderReply };
