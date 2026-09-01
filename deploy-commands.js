require("dotenv").config();

const {
  REST,
  Routes,
} = require("discord.js");

// Production command surface. One-off setup, repair, migration, demo and legacy
// commands remain in the repository as internal utilities but are no longer
// registered in Discord.
const COMMAND_FILES = [
  "botfix.js",
  "carrier-admin.js",
  "carrier.js",
  "help.js",
  "leaderboard.js",
  "marketplace.js",
  "queue3.js",
  "report.js",
  "tavern.js",
  "treasury.js",
  "warn.js",
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
const route = Routes.applicationGuildCommands(
  process.env.CLIENT_ID,
  process.env.GUILD_ID,
);

async function deploy() {
  const commands = COMMAND_FILES.map((file) => {
    const command = require(`./commands/${file}`);
    return command.data.toJSON();
  });

  // /security is owned by the standalone anti-raid service. Preserve the live
  // definition rather than allowing this bot's deploy script to overwrite it.
  const existing = await rest.get(route).catch(() => []);
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

  await rest.put(route, { body: commands });
  console.log("✅ Production command surface deployed");
}

deploy().catch((error) => {
  console.error("❌ Command deployment failed:", error);
  process.exitCode = 1;
});
