require("dotenv").config();

const fs = require("fs");
const {
  REST,
  Routes,
} = require("discord.js");

const commandsByName = new Map();

fs.readdirSync("./commands")
  .filter((file) => file.endsWith(".js"))
  .sort()
  .forEach((file) => {
    const command = require(`./commands/${file}`);
    const json = command.data.toJSON();

    if (commandsByName.has(json.name)) {
      console.warn(`⚠️ Duplicate slash command /${json.name} found in ${file}; using the later file.`);
    }

    commandsByName.set(json.name, json);
  });

const commands = [...commandsByName.values()];
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

console.log(`🔄 Deploying ${commands.length} unique guild slash commands...`);

rest.put(
  Routes.applicationGuildCommands(
    process.env.CLIENT_ID,
    process.env.GUILD_ID,
  ),
  { body: commands },
)
  .then(() => console.log("✅ Commands deployed"))
  .catch((error) => {
    console.error("❌ Command deployment failed:", error);
    process.exitCode = 1;
  });
