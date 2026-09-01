require("dotenv").config();

const {
  REST,
  Routes,
} = require("discord.js");
const COMMAND_FILES = require("./command-manifest");

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
const guildRoute = Routes.applicationGuildCommands(
  process.env.CLIENT_ID,
  process.env.GUILD_ID,
);
const globalRoute = Routes.applicationCommands(process.env.CLIENT_ID);

async function clearStaleGlobalCommands() {
  const globalCommands = await rest.get(globalRoute).catch((error) => {
    console.warn(`⚠️ Could not inspect global slash commands: ${error.message}`);
    return [];
  });

  if (!Array.isArray(globalCommands) || globalCommands.length === 0) {
    console.log("✅ No stale global slash commands found.");
    return;
  }

  console.log(`🧹 Removing ${globalCommands.length} stale global slash command(s): ${globalCommands.map((command) => `/${command.name}`).join(", ")}`);
  await rest.put(globalRoute, { body: [] });
  console.log("✅ All global slash commands removed. Production commands are guild-only.");
}

async function deploy() {
  // Older versions of Duck Carries Bot registered commands globally. Those can
  // remain visible even after the guild command list is cleaned, so explicitly
  // wipe the global application-command scope before publishing the production
  // guild command set.
  await clearStaleGlobalCommands();

  const commands = COMMAND_FILES.map((file) => {
    const command = require(`./commands/${file}`);
    return command.data.toJSON();
  });

  // /security is owned by the standalone anti-raid service. Preserve the live
  // guild definition rather than allowing this bot's deploy script to overwrite it.
  const existing = await rest.get(guildRoute).catch(() => []);
  const security = Array.isArray(existing)
    ? existing.find((command) => command.name === "security")
    : null;

  if (security) {
    const {
      id,
      application_id,
      guild_id,
      version,
      ...definition
    } = security;
    commands.push(definition);
  } else {
    console.warn("⚠️ /security is not currently registered. Start the anti-raid service before deploying the main bot commands.");
  }

  const names = commands.map((command) => `/${command.name}`).sort();
  console.log(`🔄 Deploying ${commands.length} production guild slash commands...`);
  console.log(`   ${names.join(", ")}`);

  await rest.put(guildRoute, { body: commands });
  console.log("✅ Production command surface deployed");
}

deploy().catch((error) => {
  console.error("❌ Command deployment failed:", error);
  process.exitCode = 1;
});
