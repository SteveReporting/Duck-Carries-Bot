require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
    Client,
    Collection,
    GatewayIntentBits,
    REST,
    Routes,
} = require("discord.js");
const db = require("./database/database");
const { guardCarryClaimInteraction } = require("./platform/carryClaimAccess");

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
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.commands = new Collection();

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

async function warmGuildMemberCache(interaction) {
    if (!interaction?.guild) return;
    try {
        await interaction.guild.members.fetch();
    } catch (error) {
        console.warn(`[DISCORD CACHE] Could not prefetch guild members before carry ticket creation: ${error.message}`);
    }
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

                    // Discord.js resolves channel permission overwrites through the
                    // guild member/role cache when a grouped carry ticket is created.
                    // Freshly restarted bots may not have every requester cached yet,
                    // which caused "Supplied parameter is not a cached User or Role."
                    // Fetch members before the run-tier selection reaches ticket creation.
                    if (interaction?.isStringSelectMenu?.() && interaction.customId === "queue_run_select") {
                        await warmGuildMemberCache(interaction);
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
