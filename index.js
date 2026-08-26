require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
    Client,
    Collection,
    GatewayIntentBits,
    MessageFlags,
    REST,
    Routes,
    TextChannel,
} = require("discord.js");
const db = require("./database/database");
const { guardCarryClaimInteraction } = require("./platform/carryClaimAccess");
const { ensureCarryControlCenter } = require("./platform/carryControlCenter");

console.log("=================================");
console.log("🍺 Starting The Carry Tavern...");
console.log(`Node version: ${process.version}`);
console.log("=================================");

const requiredEnvironment = ["TOKEN", "CLIENT_ID", "GUILD_ID"];
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
    ],
});

// The bot intentionally uses modular event files, so multiple handlers may listen
// to the same Discord event. Raise the EventEmitter warning threshold accordingly.
client.setMaxListeners(50);

client.commands = new Collection();

// Ready-check interactions have a strict Discord acknowledgement window. Because
// this bot intentionally has many modular interactionCreate listeners, acknowledge
// the latency-sensitive ready buttons before any normal event module gets a turn.
// The ready-check module awaits this promise before continuing, preventing both
// interaction expiry and double acknowledgement.
client.prependListener("interactionCreate", (interaction) => {
    if (!interaction?.isButton?.()) return;

    const customId = String(interaction.customId || "");
    const latencySensitive =
        customId === "carry_readycheck_start" ||
        /^carry_ready_yes_[0-9a-f-]{36}$/i.test(customId);

    if (!latencySensitive || interaction.deferred || interaction.replied || interaction.__carryFastAckPromise) return;

    interaction.__carryFastAckPromise = interaction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() => true)
        .catch((error) => {
            console.warn(`[CARRY FAST ACK] ${customId}: ${error.message}`);
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
    const files = fs.readdirSync(directory)
        .filter((name) => name.endsWith(".js"))
        .sort();

    console.log("📦 Loading commands...");

    for (const file of files) {
        try {
            const command = require(path.join(directory, file));

            if (!command?.data?.name || typeof command.execute !== "function") {
                throw new Error("Command must export { data, execute }.");
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

function loadEvents() {
    const directory = path.join(__dirname, "events");
    const files = fs.readdirSync(directory)
        .filter((name) => name.endsWith(".js"))
        .sort();

    console.log("📦 Loading events...");

    for (const file of files) {
        try {
            const event = require(path.join(directory, file));

            if (!event?.name || typeof event.execute !== "function") {
                throw new Error("Event must export { name, execute }.");
            }

            const listener = async (...args) => {
                if (event.name === "interactionCreate") {
                    const interaction = args[0];

                    if (interaction?.isStringSelectMenu?.() && interaction.customId === "queue_run_select") {
                        void warmGuildMemberCache(interaction);
                    }

                    const allowed = await guardCarryClaimInteraction(interaction);
                    if (!allowed) return;
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

async function syncSlashCommands() {
    const body = [...client.commands.values()].map((command) => command.data.toJSON());
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    console.log(`🔄 Syncing ${body.length} guild slash commands...`);
    await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body },
    );
    console.log("✅ Guild slash commands synced.");
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
    try {
        await syncSlashCommands();
    } catch (error) {
        console.error("❌ Slash command sync failed:", error);
        console.warn("⚠️ Continuing startup with the slash commands already registered in Discord.");
        console.warn("⚠️ Fix CLIENT_ID/GUILD_ID or bot guild access before the next command-schema update.");
    }

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
