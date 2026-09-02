const { TOOL_DEFINITIONS, READ_ONLY_TOOLS, executeTool } = require("./discordTools");
const { TOOL_DEFINITION: CARRIER_DEPARTMENT_TOOL, setupCarrierDepartment } = require("./carrierDepartment");
const { createLocalResponse } = require("./localResponses");
const { getLocalAiModel } = require("./localChat");

const AI_TIMEOUT_MS = 90000;
const TOOL_TIMEOUT_MS = 25000;
const CARRIER_SETUP_TIMEOUT_MS = 180000;

function toolsForMode(mode) {
    if (mode === "fix") return [...TOOL_DEFINITIONS, CARRIER_DEPARTMENT_TOOL];
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
        "For the standard Carry Tavern Carrier Department restructure, prefer setup_carrier_department. It performs the approved one-category role/channel/permission setup idempotently in one action and avoids dozens of individual edits.",
        "When individual tools are required, batch independent tool calls in the same response instead of doing one tool call per round.",
        "Inspect the required server state once, perform all independent safe changes together, refresh IDs only when newly created objects require it, and verify once at the end. Do not repeatedly re-read unchanged state.",
        "Before changing role hierarchy, colours or permissions with individual tools, inspect get_roles first so you use current role IDs, positions and settings.",
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
    return createLocalResponse(payload, {
        timeoutMs: AI_TIMEOUT_MS,
        modelFallback: "qwen3:8b",
    });
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

function getModel() {
    return String(
        process.env.AI_MANAGER_MODEL ||
        getLocalAiModel("qwen3:8b")
    ).trim();
}

function getMaxToolRounds() {
    const configured = Number(process.env.AI_MAX_TOOL_ROUNDS);

    // Never allow an old host setting such as AI_MAX_TOOL_ROUNDS=3 to cripple
    // multi-step fixes. 20 is the safe minimum, while 30 remains a hard ceiling.
    if (!Number.isFinite(configured)) return 20;
    return Math.max(20, Math.min(Math.floor(configured), 30));
}

async function executeAgentTool(interaction, call, mode) {
    const args = parseToolArguments(call);

    if (call.name === "setup_carrier_department") {
        return withTimeout(
            setupCarrierDepartment(interaction, args),
            CARRIER_SETUP_TIMEOUT_MS,
            "Carrier Department setup"
        );
    }

    return withTimeout(
        executeTool(interaction, call.name, args, mode),
        TOOL_TIMEOUT_MS,
        `Tool ${call.name}`
    );
}

async function runDiscordAgent({ interaction, mode, prompt }) {
    const tools = toolsForMode(mode);
    const model = getModel();
    const maxToolRounds = getMaxToolRounds();

    console.log(`[AI AGENT] Local model: ${model}`);
    console.log(`[AI AGENT] Max rounds: ${maxToolRounds}`);

    let response = await createResponse({
        model,
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
                const result = await executeAgentTool(interaction, call, mode);
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
            instructions: buildInstructions(interaction, mode),
            tools,
            tool_choice: "auto",
            previous_response_id: response.id,
            input: toolOutputs,
            max_output_tokens: 1800,
        });
    }

    const finalResponse = await createResponse({
        model,
        instructions: buildInstructions(interaction, mode),
        tools,
        tool_choice: "none",
        previous_response_id: response.id,
        input: "The tool-round budget is exhausted. Do not call any more tools. Give a concise completion report of confirmed changes and clearly list anything that still remains.",
        max_output_tokens: 1200,
    });

    return extractOutputText(finalResponse) || `Reached the ${maxToolRounds}-round safety limit. Check the confirmed tool results before making any further changes.`;
}

module.exports = { runDiscordAgent };
