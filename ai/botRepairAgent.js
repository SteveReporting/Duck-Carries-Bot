const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    Collection,
    REST,
    Routes,
} = require("discord.js");
const db = require("../database/database");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 60000;
const MAX_TOOL_ROUNDS = 8;
const MAX_LOG_CHARS = 14000;

const FUNCTION_TOOLS = [
    {
        type: "function",
        name: "get_runtime_health",
        description: "Inspect the currently running Carry Tavern bot: Discord connection, uptime, memory, loaded commands, required configuration presence, PM2 state and SQLite health. No secret values are returned.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_recent_logs",
        description: "Read a redacted tail of the current PM2 error/output logs when available. Tokens, API keys and webhook secrets are removed before the logs are returned.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "check_database",
        description: "Run read-only SQLite integrity and foreign-key checks against the bot database.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "reload_commands",
        description: "Reload all command modules from the bot's local disk without restarting the process. Use for stale command code or a command module that failed to load previously.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "resync_slash_commands",
        description: "Re-register the currently loaded guild slash-command schema with Discord. Use when commands are missing, outdated, duplicated or have incorrect options.",
        strict: true,
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "restart_under_pm2",
        description: "Request one clean process restart after the repair report has been sent. This is only allowed when the bot is actually running under PM2/autorestart supervision.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                reason: { type: "string" },
            },
            required: ["reason"],
            additionalProperties: false,
        },
    },
];

function getModel() {
    const configured = String(process.env.OPENAI_MODEL || "").trim();
    if (!configured || configured === "gpt-5.6" || !configured.startsWith("gpt-5.6-")) {
        return "gpt-5.6-sol";
    }
    return configured;
}

function getHeaders() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured on the bot host.");
    }

    return {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
    };
}

function redactSecrets(value) {
    return String(value || "")
        .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_\-]{16,}\b/gi, "[REDACTED_KEY]")
        .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]")
        .replace(/(authorization\s*[:=]\s*(?:bot|bearer)?\s*)[^\s,]+/gi, "$1[REDACTED]")
        .replace(/\b(TOKEN|OPENAI_API_KEY|SUPABASE(?:_SERVICE_ROLE)?_KEY|BLOXLINK_API_KEY|DISCORD_TOKEN)\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
        .replace(/https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+/gi, "[REDACTED_WEBHOOK]");
}

function tailFile(filePath, maxBytes = 48000) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return null;

        const bytes = Math.min(stat.size, maxBytes);
        const start = Math.max(0, stat.size - bytes);
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(bytes);

        try {
            fs.readSync(fd, buffer, 0, bytes, start);
        } finally {
            fs.closeSync(fd);
        }

        return redactSecrets(buffer.toString("utf8"));
    } catch (error) {
        return `[Could not read ${path.basename(filePath || "log")}: ${error.message}]`;
    }
}

function candidatePm2Logs() {
    const pm2Home = process.env.PM2_HOME || path.join(os.homedir(), ".pm2");
    const processName = String(process.env.name || "carry-tavern");

    return {
        error: [
            process.env.pm_err_log_path,
            path.join(pm2Home, "logs", `${processName}-error.log`),
            path.join(pm2Home, "logs", "carry-tavern-error.log"),
        ].filter(Boolean),
        output: [
            process.env.pm_out_log_path,
            path.join(pm2Home, "logs", `${processName}-out.log`),
            path.join(pm2Home, "logs", "carry-tavern-out.log"),
        ].filter(Boolean),
    };
}

function firstReadable(paths) {
    for (const filePath of [...new Set(paths)]) {
        const content = tailFile(filePath);
        if (content != null) return { filePath, content };
    }
    return null;
}

function getRecentLogs() {
    const candidates = candidatePm2Logs();
    const errorLog = firstReadable(candidates.error);
    const outputLog = firstReadable(candidates.output);

    const result = {
        pm2_detected: isRunningUnderPm2(),
        error_log: errorLog ? errorLog.content.slice(-MAX_LOG_CHARS) : "No PM2 error log was found.",
        output_log: outputLog ? outputLog.content.slice(-Math.floor(MAX_LOG_CHARS / 2)) : "No PM2 output log was found.",
    };

    return result;
}

function databaseHealth() {
    try {
        const quick = db.pragma("quick_check");
        const foreignKeys = db.pragma("foreign_key_check");
        return {
            ok: Array.isArray(quick) && quick.every((row) => Object.values(row).includes("ok")),
            quick_check: quick,
            foreign_key_problem_count: Array.isArray(foreignKeys) ? foreignKeys.length : 0,
            foreign_key_problems: Array.isArray(foreignKeys) ? foreignKeys.slice(0, 20) : [],
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function isRunningUnderPm2() {
    return process.env.pm_id !== undefined || Boolean(process.env.PM2_HOME) || Boolean(process.env.pm_exec_path);
}

function getRuntimeHealth(interaction, client) {
    const memory = process.memoryUsage();
    const required = ["TOKEN", "CLIENT_ID", "GUILD_ID", "OPENAI_API_KEY"];

    return {
        process: {
            pid: process.pid,
            node: process.version,
            platform: process.platform,
            uptime_seconds: Math.round(process.uptime()),
            pm2_supervised: isRunningUnderPm2(),
            memory_mb: {
                rss: Math.round(memory.rss / 1024 / 1024),
                heap_used: Math.round(memory.heapUsed / 1024 / 1024),
                heap_total: Math.round(memory.heapTotal / 1024 / 1024),
            },
        },
        discord: {
            ready: client.isReady(),
            websocket_status: client.ws.status,
            ping_ms: Number.isFinite(client.ws.ping) ? Math.round(client.ws.ping) : null,
            guild_cached: Boolean(client.guilds.cache.get(interaction.guildId)),
        },
        commands: {
            loaded_count: client.commands?.size || 0,
            names: [...(client.commands?.keys?.() || [])].sort(),
        },
        configuration_present: Object.fromEntries(required.map((key) => [key, Boolean(process.env[key])])),
        database: databaseHealth(),
    };
}

function loadCommandCollection() {
    const directory = path.join(__dirname, "..", "commands");
    const files = fs.readdirSync(directory)
        .filter((name) => name.endsWith(".js"))
        .sort();

    const commands = new Collection();
    const loaded = [];

    for (const file of files) {
        const fullPath = path.join(directory, file);
        const resolved = require.resolve(fullPath);
        delete require.cache[resolved];

        const command = require(fullPath);
        if (!command?.data?.name || typeof command.execute !== "function") {
            throw new Error(`${file} does not export a valid { data, execute } command.`);
        }
        if (commands.has(command.data.name)) {
            throw new Error(`Duplicate slash-command name /${command.data.name} while loading ${file}.`);
        }

        commands.set(command.data.name, command);
        loaded.push({ file, name: command.data.name });
    }

    return { commands, loaded };
}

async function reloadCommands(client) {
    const { commands, loaded } = loadCommandCollection();
    client.commands = commands;
    return {
        ok: true,
        count: commands.size,
        loaded,
    };
}

async function resyncSlashCommands(client) {
    if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
        throw new Error("TOKEN, CLIENT_ID and GUILD_ID must all be configured before slash commands can be synced.");
    }

    const body = [...client.commands.values()].map((command) => command.data.toJSON());
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body },
    );

    return {
        ok: true,
        registered_count: body.length,
        names: body.map((command) => command.name).sort(),
    };
}

function buildInstructions(interaction) {
    return [
        "You are The Carry Tavern bot's emergency repair assistant.",
        `Guild: ${interaction.guild?.name || "unknown"} (${interaction.guildId || "unknown"}).`,
        `Requesting administrator: ${interaction.user.tag} (${interaction.user.id}).`,
        "Your job is to diagnose the administrator's reported bot problem and perform the smallest safe runtime repair that is likely to solve it.",
        "Always inspect runtime health first. Inspect recent logs when the complaint could involve crashes, exceptions, commands, startup, Discord API errors or unexplained failures.",
        "You may use web search to look up unfamiliar error messages, Discord.js behavior or Node/PM2 issues when useful.",
        "You have no tool that can read secret values, edit environment variables, run arbitrary shell commands, alter source files, git pull, delete data, or bypass Discord permissions. Do not ask for or attempt any of those things.",
        "Never reveal credentials or secrets. Logs are redacted, but still avoid repeating anything that resembles a token or key.",
        "Use reload_commands for stale/broken command-module loading. Use resync_slash_commands when Discord's registered command schema is the problem.",
        "Use check_database when queue/community data errors suggest SQLite corruption or constraint problems. The check is read-only; never delete or recreate the database.",
        "A PM2 restart is a last resort for a stuck Discord connection, stale runtime state, memory/runtime problems, or when a clean restart is clearly appropriate. Request at most one restart and do not use restart loops.",
        "If the evidence points to an actual source-code defect that these safe tools cannot repair, do not pretend it is fixed. Give the administrator the exact error and likely component/file so the owner can patch it.",
        "Do not change Discord roles, channels, permissions, members or messages from this repair agent. The separate /ai manager handles server configuration.",
        "Verify repairs using runtime health or another relevant read-only check when practical.",
        "End with a concise report containing: diagnosis, actions actually completed, whether the problem appears fixed, and anything the owner still needs to do.",
    ].join("\n");
}

async function createResponse(payload, allowWebSearch = true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    try {
        const tools = allowWebSearch
            ? [{ type: "web_search_preview" }, ...FUNCTION_TOOLS]
            : FUNCTION_TOOLS;

        const response = await fetch(OPENAI_ENDPOINT, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ ...payload, tools }),
            signal: controller.signal,
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = body?.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
            if (allowWebSearch && /web[_ -]?search|tool.*unsupported|unsupported.*tool/i.test(message)) {
                return createResponse(payload, false);
            }
            throw new Error(message);
        }

        return body;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(`OpenAI repair request timed out after ${OPENAI_TIMEOUT_MS / 1000}s.`);
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

function parseArguments(call) {
    try {
        return call.arguments ? JSON.parse(call.arguments) : {};
    } catch (error) {
        throw new Error(`Invalid tool arguments for ${call.name}: ${error.message}`);
    }
}

async function executeTool(interaction, client, call, state) {
    const args = parseArguments(call);

    switch (call.name) {
        case "get_runtime_health":
            return getRuntimeHealth(interaction, client);
        case "get_recent_logs":
            return getRecentLogs();
        case "check_database":
            return databaseHealth();
        case "reload_commands":
            return reloadCommands(client);
        case "resync_slash_commands":
            return resyncSlashCommands(client);
        case "restart_under_pm2": {
            if (!isRunningUnderPm2()) {
                throw new Error("Restart refused because PM2/autorestart supervision was not detected. Exiting could leave the bot offline.");
            }
            if (state.restartRequested) {
                return { ok: true, already_requested: true, reason: state.restartReason };
            }
            state.restartRequested = true;
            state.restartReason = String(args.reason || "AI repair requested a clean restart").slice(0, 300);
            return { ok: true, restart_requested: true, note: "The process will exit only after the Discord repair report has been sent; PM2 should then restart it." };
        }
        default:
            throw new Error(`Unknown repair tool: ${call.name}`);
    }
}

async function runBotRepairAgent({ interaction, client, issue }) {
    const state = {
        restartRequested: false,
        restartReason: null,
    };

    let response = await createResponse({
        model: getModel(),
        instructions: buildInstructions(interaction),
        tool_choice: "auto",
        input: `Administrator-reported problem:\n${String(issue).slice(0, 1800)}`,
        max_output_tokens: 1800,
    });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const calls = (response.output || []).filter((item) => item.type === "function_call");
        if (calls.length === 0) {
            return {
                text: extractOutputText(response) || "Repair inspection completed, but no text report was returned.",
                ...state,
            };
        }

        const outputs = [];
        for (const call of calls) {
            let payload;
            try {
                payload = { ok: true, result: await executeTool(interaction, client, call, state) };
            } catch (error) {
                payload = { ok: false, error: error.message };
            }

            outputs.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(payload),
            });
        }

        response = await createResponse({
            model: getModel(),
            instructions: buildInstructions(interaction),
            tool_choice: "auto",
            previous_response_id: response.id,
            input: outputs,
            max_output_tokens: 1800,
        });
    }

    const final = await createResponse({
        model: getModel(),
        instructions: buildInstructions(interaction),
        tool_choice: "none",
        previous_response_id: response.id,
        input: "The safe repair tool-round limit is exhausted. Do not call more tools. Report confirmed findings/actions and clearly state anything still unresolved.",
        max_output_tokens: 1200,
    }, false);

    return {
        text: extractOutputText(final) || "Repair inspection reached its safety limit.",
        ...state,
    };
}

module.exports = {
    runBotRepairAgent,
    isRunningUnderPm2,
};
