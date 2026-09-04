require("dotenv").config();

const {
  REST,
  Routes,
} = require("discord.js");
const COMMAND_FILES = require("./command-manifest");

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
const globalRoute = Routes.applicationCommands(process.env.CLIENT_ID);
const TEST_GUILD_ID = String(process.env.TEST_GUILD_ID || "1544828627127115846").trim();

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

function baseCommands() {
  return COMMAND_FILES.map((file) => {
    const command = require(`./commands/${file}`);
    return command.data.toJSON();
  });
}

function cleanLiveCommand(command) {
  const {
    id,
    application_id,
    guild_id,
    version,
    ...definition
  } = command;
  return definition;
}

function isGuildAccessError(error) {
  return error?.code === 50001 || error?.code === 10004 || error?.status === 403 || error?.status === 404;
}

async function deployToGuild(guildId, label) {
  const route = Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId);
  const commands = baseCommands();

  try {
    // /security is owned by the standalone anti-raid service. Preserve the live
    // definition independently in every guild instead of copying one guild's
    // security command into another guild.
    const existing = await rest.get(route);
    const security = Array.isArray(existing)
      ? existing.find((command) => command.name === "security")
      : null;

    if (security) {
      commands.push(cleanLiveCommand(security));
    } else {
      console.warn(`⚠️ [${label}] /security is not currently registered.`);
    }

    const names = commands.map((command) => `/${command.name}`).sort();
    console.log(`🔄 [${label}] Deploying ${commands.length} guild slash commands to ${guildId}...`);
    console.log(`   ${names.join(", ")}`);

    await rest.put(route, { body: commands });
    console.log(`✅ [${label}] Command surface deployed to ${guildId}`);
    return true;
  } catch (error) {
    if (isGuildAccessError(error)) {
      console.warn(`⚠️ [${label}] Guild ${guildId} is unavailable to this application (${error.code || error.status || "access error"}); skipping.`);
      return false;
    }
    throw error;
  }
}

async function deploy() {
  await clearStaleGlobalCommands();

  const productionGuildId = String(process.env.GUILD_ID || "").trim();
  const targets = [];

  if (productionGuildId) {
    targets.push({ id: productionGuildId, label: "PRODUCTION" });
  }
  if (TEST_GUILD_ID && TEST_GUILD_ID !== productionGuildId) {
    targets.push({ id: TEST_GUILD_ID, label: "TEST" });
  }

  if (targets.length === 0) {
    throw new Error("No Discord guild IDs are configured for command deployment.");
  }

  let deployed = 0;
  for (const target of targets) {
    if (await deployToGuild(target.id, target.label)) deployed += 1;
  }

  if (deployed === 0) {
    throw new Error("Command deployment could not access any configured guild.");
  }

  console.log(`✅ Command deployment complete (${deployed}/${targets.length} guild target${targets.length === 1 ? "" : "s"} available).`);
}

deploy().catch((error) => {
  console.error("❌ Command deployment failed:", error);
  process.exitCode = 1;
});
