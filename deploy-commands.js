require("dotenv").config();

const {
  clearGuildCommandOverrides,
  commandDefinitions,
  syncGlobalCommands,
} = require("./platform/commandRegistry");
const { listConfiguredGuildIds } = require("./platform/guildConfig");

async function deploy() {
  const commands = commandDefinitions();
  const names = commands.map((command) => `/${command.name}`).sort();

  console.log(`🌍 Deploying ${commands.length} global Tavern commands...`);
  console.log(`   ${names.join(", ")}`);
  await syncGlobalCommands();

  // Old builds used guild-specific registrations. Clear any known overrides so
  // Discord shows one authoritative global command surface in every server.
  const knownGuilds = new Set([
    ...listConfiguredGuildIds(),
    process.env.GUILD_ID,
    process.env.PRIMARY_GUILD_ID,
    process.env.TEST_GUILD_ID,
    "1544828627127115846", // migration-only: the previous built-in test guild
  ].map((value) => String(value || "").trim()).filter(Boolean));

  let cleared = 0;
  for (const guildId of knownGuilds) {
    if (await clearGuildCommandOverrides(guildId)) cleared += 1;
  }

  console.log(`✅ Global multi-guild deployment complete • ${commands.length} commands • ${cleared}/${knownGuilds.size} old guild override(s) cleared.`);
  console.log("🍺 The bot can now be invited to any server; run /setup there once to configure it.");
}

deploy().catch((error) => {
  console.error("❌ Command deployment failed:", error);
  process.exitCode = 1;
});
