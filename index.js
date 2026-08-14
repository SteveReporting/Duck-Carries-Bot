require("dotenv").config();

const fs = require("fs");
const express = require("express");
const {
    Client,
    Collection,
    GatewayIntentBits,
} = require("discord.js");

const requiredEnvironment = ["TOKEN"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length > 0) {
    throw new Error(
        `Missing required environment variables: ${missingEnvironment.join(", ")}`
    );
}

// Small health endpoint used by hosting providers to verify the process is alive.
const app = express();

app.get("/", (_req, res) => {
    res.status(200).json({
        service: "carry-tavern-bot",
        status: "online",
    });
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Health server online");
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
    ],
});

client.commands = new Collection();

for (const file of fs.readdirSync("./commands").filter((name) => name.endsWith(".js"))) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

for (const file of fs.readdirSync("./events").filter((name) => name.endsWith(".js"))) {
    const event = require(`./events/${file}`);

    client.on(event.name, (...args) => event.execute(...args, client));
}

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
