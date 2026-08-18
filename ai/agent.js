const { TOOL_DEFINITIONS, READ_ONLY_TOOLS, executeTool } = require("./discordTools");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 60000;
const TOOL_TIMEOUT_MS = 25000;

function toolsForMode(mode) {
    if (mode === "fix") return TOOL_DEFINITIONS;
    return TOOL_DEFINITIONS.filter((tool) => READ_ONLY_TOOLS.has(tool.name));
}

function buildInstructions(interaction, mode) {
    return [
        "You are the AI server manager for The Carry Tavern Discord server.",
        `You are operating in ${mode.toUpperCase()} mode.`,
        `Guild: ${interaction.guild.name} (${interaction.guild.id}).`,
        `Requesting staff member: ${interaction.user.tag} (${interaction.user.id}).`,
        "Use Discord tools when server facts are needed; do not guess IDs, roles, channels, webhooks, permissions, colours or hierarchy positions.",
        "In ASK mode, explain and advise without making server changes.",
        "In AUDIT mode, inspect the server and report concrete problems and recommended fixes without changing anything.",
        "In FIX mode, you may make the requested non-destructive changes with the provided tools.",
        "In FIX mode, requested role colour, hierarchy position, hoist, mentionability, safe guild permission and channel access changes are allowed when the tools support them.",
        "Before changing role hierarchy, colours or permissions, inspect get_roles first so you use current role IDs, positions and settings.",
        "When moving roles, preserve unrelated role order and never move a role to or above the bot's highest role.",
        "Never claim a change succeeded unless the tool result confirms it.",
        "Never attempt deletion, kicking, banning, token access, credential access, mass DMs, granting Administrator, granting Manage Server, granting Manage Roles, or bypassing Discord permission hierarchy.",
        "Do not alter the carry queue/database internals unless the user explicitly asks about them and a tool supports the requested operation.",
        "Prefer the smallest set of changes that fulfills the request.",
        "When changing permissions, inspect the current structure first and preserve unrelated overwrites and role permissions.",
        "If one tool action fails or times out, continue with independent safe actions when possible and report the failed action instead of aborting the whole task.",
        "Keep the final Discord response concise: summarize what you found or changed, then mention any action that still requires the owner.",
    ].join("\n");
}

async function createResponse(payload) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured on the bot host.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    try {
        const response = await fetch(OPENAI_ENDPOINT, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = body?.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
            throw new Error(message);
        }

        return body;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(`OpenAI request timed out after ${OPENAI_TIMEOUT_MS / 1000}s.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function extractOutputText(response) {
    const parts = [];
    for (const item of response.output || []) {
        if (item.type !== "message") continue;
        for (const content of item.content || []) {
            if (content.type === "output_text" && content.text) parts.push(content.text);
        }
    }
    return parts.join("\n").trim();
}

function parseToolArguments(item) {
    try {
        return item.arguments ? JSON.parse(item.arguments) : {};
    } catch (error) {
        throw new Error(`Invalid arguments for ${item.name}: ${error.message}`);
    }
}

function withTimeout(promise, milliseconds, label) {
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${milliseconds / 1000}s.`)),
            milliseconds
        );
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runDiscordAgent({ interaction, mode, prompt }) {
    const tools = toolsForMode(mode);
    const model = process.env.OPENAI_MODEL || "gpt-5.6";
    const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || "low";
    const maxToolRounds = Math.max(1, Math.min(Number(process.env.AI_MAX_TOOL_ROUNDS) || 3, 10));

    console.log(`[AI AGENT] Model: ${model}`);
    console.log(`[AI AGENT] Max rounds: ${maxToolRounds}`);

    let response = await createResponse({
        model,
        reasoning: { effort: reasoningEffort },
        instructions: buildInstructions(interaction, mode),
        tools,
        tool_choice: "auto",
        input: prompt,
        max_output_tokens: 1800,
    });

    for (let round = 0; round < maxToolRounds; round += 1) {
        const calls = (response.output || []).filter((item) => item.type === "function_call");

        if (calls.length === 0) {
            return extractOutputText(response) || "Done. No text response was returned.";
        }

        console.log(`[AI AGENT] Round ${round + 1}: ${calls.length} tool call(s)`);

        const toolOutputs = [];

        for (const call of calls) {
            let output;

            try {
                const args = parseToolArguments(call);
                const result = await withTimeout(
                    executeTool(interaction, call.name, args, mode),
                    TOOL_TIMEOUT_MS,
                    `Tool ${call.name}`
                );
                output = { ok: true, result };
            } catch (error) {
                console.warn(`[AI TOOL] ${call.name} failed: ${error.message}`);
                output = { ok: false, error: error.message };
            }

            toolOutputs.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(output),
            });
        }

        response = await createResponse({
            model,
            reasoning: { effort: reasoningEffort },
            instructions: buildInstructions(interaction, mode),
            tools,
            tool_choice: "auto",
            previous_response_id: response.id,
            input: toolOutputs,
            max_output_tokens: 1800,
        });
    }

    throw new Error(`AI stopped after ${maxToolRounds} tool rounds to prevent an uncontrolled action loop.`);
}

module.exports = { runDiscordAgent };
