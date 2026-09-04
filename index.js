require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
    Client,
    Collection,
    GatewayIntentBits,
    MessageFlags,
    TextChannel,
} = require("discord.js");
const db = require("./database/database");
const COMMAND_FILES = require("./command-manifest");
const {
    guardCarryClaimInteraction,
    isCarryClaimInteraction,
} = require("./platform/carryClaimAccess");
const { ensureCarryControlCenter } = require("./platform/carryControlCenter");
const { isLegacyGuildReadyFile } = require("./platform/guildRuntime");

console.log("=================================");
console.log("🍺 Starting The Carry Tavern...");
console.log(`Node version: ${process.version}`);
console.log("🌍 Mode: multi-guild / setup-driven");
console.log("=================================");

// A guild ID is deliberately NOT required. The bot must remain online even when
// it has not joined or configured a server yet.
const requiredEnvironment = ["TOKEN", "CLIENT_ID"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnvironment.join(", ")}`);
    process.exit(1);
}

process.on("uncaughtException", (error) => {
    console.error("[FATAL] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
    console.error("[FATAL] unhandledRejection:", reason);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// The bot intentionally uses modular event files, so multiple handlers may listen
// to the same Discord event. Raise the EventEmitter warning threshold accordingly.
client.setMaxListeners(50);

client.commands = new Collection();
client.tavernConfiguredGuildIds = new Set();
client.tavernLegacyGuildId = null;

// Discord interactions must be acknowledged within a few seconds. Some Tavern
// actions perform Supabase or Discord API work after the click, so acknowledge
// only the handlers that explicitly understand this shared fast-ack promise.
client.prependListener("interactionCreate", (interaction) => {
    const customId = String(interaction?.customId || "");
    const createdAt = Number(interaction?.createdTimestamp || 0);
    const ageMs = createdAt > 0 ? Date.now() - createdAt : null;

    if (Number.isFinite(ageMs) && ageMs >= 1500 && !interaction.__interactionLatencyLogged) {
        interaction.__interactionLatencyLogged = true;
        const label = customId || interaction?.commandName || `type:${interaction?.type}`;
        console.warn(`[INTERACTION LATENCY] ${label} arrived ${ageMs}ms after creation.`);
    }

    const latencySensitiveButton = interaction?.isButton?.() && (
        customId === "carry_readycheck_start" ||
        /^carry_ready_yes_[0-9a-f-]{36}$/i.test(customId) ||
        customId === "treasury_stock_legendary" ||
        customId === "treasury_stock_collect"
    );
    const latencySensitiveCarryModal =
        interaction?.isModalSubmit?.() && customId === "carry_request_modal_v4";

    if (
        (!latencySensitiveButton && !latencySensitiveCarryModal) ||
        interaction.deferred ||
        interaction.replied ||
        interaction.__carryFastAckPromise
    ) return;

    interaction.__carryFastAckPromise = interaction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() => true)
        .catch((error) => {
            const suffix = Number.isFinite(ageMs) ? ` age=${ageMs}ms` : "";
            console.warn(`[CARRY FAST ACK] ${customId}: ${error.message}${suffix}`);
            return false;
        });
});

function embedFooterText(embed) {
    if (!embed) return "";
    if (embed.data?.footer?.text) return String(embed.data.footer.text);
    if (embed.footer?.text) return String(embed.footer.text);
    if (typeof embed.toJSON === "function") {
        try {
            return String(embed.toJSON()?.footer?.text || "");
        } catch {}
    }
    return "";
}

function componentCustomIds(payload) {
    const rows = Array.isArray(payload?.components) ? payload.components : [];
    const ids = [];
    for (const row of rows) {
        const components = row?.components || row?.data?.components || [];
        for (const component of components) {
            const id = component?.customId || component?.custom_id || component?.data?.custom_id || component?.data?.customId;
            if (id) ids.push(String(id));
        }
    }
    return ids;
}

function isUnifiedCarryPayload(payload) {
    return (payload?.embeds || []).some((embed) =>
        embedFooterText(embed).includes("The Carry Tavern • Carry Control Center"),
    );
}

function isOldCarryControlPayload(channel, payload) {
    if (!channel || !String(channel.name || "").toLowerCase().startsWith("carry-")) return false;
    if (!payload || isUnifiedCarryPayload(payload)) return false;

    const ids = componentCustomIds(payload);
    return ids.some((id) =>
        id === "carry_carrier_complete" ||
        id === "carry_release_claim" ||
        id === "carry_show_ids" ||
        id === "carry_readycheck_start" ||
        id === "carry_close_ticket" ||
        id.startsWith("carry_cancel_") ||
        id.startsWith("carry_delete_") ||
        id.startsWith("carry_noshow_") ||
        id.startsWith("complete_") ||
        id.startsWith("requester_complete_") ||
        id.startsWith("legacy_release_"),
    );
}

function installUnifiedCarrySendInterceptor() {
    if (!TextChannel?.prototype?.send || TextChannel.prototype.__carryUnifiedPatched) return;

    const originalSend = TextChannel.prototype.send;
    Object.defineProperty(TextChannel.prototype, "__carryUnifiedPatched", {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
    });

    TextChannel.prototype.send = async function patchedCarrySend(payload) {
        if (!isOldCarryControlPayload(this, payload)) {
            return originalSend.call(this, payload);
        }

        try {
            const unified = await ensureCarryControlCenter(this, { replace: true, ping: true });
            if (unified) return unified;
        } catch (error) {
            console.warn(`[CARRY CONTROL CENTER] Could not replace legacy ticket panel in #${this.name}:`, error.message);
        }

        return originalSend.call(this, payload);
    };

    console.log("🍺 Unified carry-ticket send interceptor enabled.");
}

installUnifiedCarrySendInterceptor();

function loadCommands() {
    const directory = path.join(__dirname, "commands");

    console.log("📦 Loading production commands...");

    for (const file of COMMAND_FILES) {
        try {
            const command = require(path.join(directory, file));

            if (!command?.data?.name || typeof command.execute !== "function") {
                throw new Error("Command must export { data, execute }.");
            }

            if (client.commands.has(command.data.name)) {
                throw new Error(`Duplicate production command /${command.data.name}.`);
            }

            client.commands.set(command.data.name, command);
            console.log(`   ✅ /${command.data.name}`);
        } catch (error) {
            console.error(`   ❌ ${file}:`, error);
        }
    }
}

const guildMemberWarmups = new Map();

function warmGuildMemberCache(interaction) {
    if (!interaction?.guild) return Promise.resolve();

    const guildId = String(interaction.guild.id);
    const existing = guildMemberWarmups.get(guildId);
    if (existing) return existing;

    const promise = interaction.guild.members.fetch()
        .catch((error) => {
            console.warn(`[DISCORD CACHE] Could not prefetch guild members before carry ticket creation: ${error.message}`);
        })
        .finally(() => {
            const timer = setTimeout(() => {
                if (guildMemberWarmups.get(guildId) === promise) {
                    guildMemberWarmups.delete(guildId);
                }
            }, 30_000);
            timer.unref?.();
        });

    guildMemberWarmups.set(guildId, promise);
    return promise;
}

function eventFilePriority(name) {
    if (name === "interactionCreate.js") return 0;
    return 1;
}

function loadEvents() {
    const directory = path.join(__dirname, "events");
    const files = fs.readdirSync(directory)
        .filter((name) => name.endsWith(".js"))
        .sort((a, b) => {
            const priority = eventFilePriority(a) - eventFilePriority(b);
            return priority || a.localeCompare(b);
        });

    console.log("📦 Loading events...");

    for (const file of files) {
        try {
            const event = require(path.join(directory, file));

            if (!event?.name || typeof event.execute !== "function") {
                throw new Error("Event must export { name, execute }.");
            }

            const listener = async (...args) => {
                // Guild-specific legacy startup systems must not fire against a
                // stale Carry Tavern GUILD_ID when the bot is in a new/unconfigured
                // server. /setup can activate them later without a restart.
                if (event.name === "clientReady" && isLegacyGuildReadyFile(file) && !client.tavernLegacyGuildId) {
                    console.log(`[MULTI-GUILD] ${file} waiting for the first configured guild.`);
                    return;
                }

                if (event.name === "interactionCreate") {
                    const interaction = args[0];

                    if (interaction?.isStringSelectMenu?.() && interaction.customId === "queue_run_select") {
                        void warmGuildMemberCache(interaction);
                    }

                    if (isCarryClaimInteraction(interaction)) {
                        if (!interaction.__carryClaimGuardPromise) {
                            interaction.__carryClaimGuardPromise = guardCarryClaimInteraction(interaction);
                        }
                        const allowed = await interaction.__carryClaimGuardPromise;
                        if (!allowed) return;
                    }
                }
                return event.execute(...args, client);
            };

            if (event.once) {
                client.once(event.name, listener);
            } else {
                client.on(event.name, listener);
            }

            console.log(`   ✅ ${event.name}${event.once ? " (once)" : ""}`);
        } catch (error) {
            console.error(`   ❌ ${file}:`, error);
        }
    }
}

loadCommands();
loadEvents();

client.on("error", (error) => {
    console.error("[DISCORD] Client error:", error);
});

client.on("warn", (warning) => {
    console.warn("[DISCORD] Warning:", warning);
});

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n🛑 Received ${signal}. Shutting down cleanly...`);

    try {
        client.destroy();
    } catch (error) {
        console.error("[SHUTDOWN] Discord cleanup failed:", error);
    }

    try {
        db.close();
    } catch (error) {
        console.error("[SHUTDOWN] Database cleanup failed:", error);
    }

    process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
    console.log("🔐 Logging into Discord...");

    try {
        await client.login(process.env.TOKEN);
        console.log("✅ Discord login request accepted.");
    } catch (error) {
        console.error("❌ Discord login failed:", error);
        process.exit(1);
    }
}

void start();
