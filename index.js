require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
    Client,
    Collection,
    GatewayIntentBits,
} = require("discord.js");
const db = require("./database/database");

console.log("=================================");
console.log("🍺 Starting The Carry Tavern...");
console.log(`Node version: ${process.version}`);
console.log("=================================");

const requiredEnvironment = ["TOKEN", "GUILD_ID"];
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

            const listener = (...args) => event.execute(...args, client);

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

console.log("🔐 Logging into Discord...");

client.login(process.env.TOKEN)
    .then(() => console.log("✅ Discord login request accepted."))
    .catch((error) => {
        console.error("❌ Discord login failed:", error);
        process.exit(1);
    });
