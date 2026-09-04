const { REST, Routes } = require("discord.js");
const COMMAND_FILES = require("../command-manifest");

const BUILTIN_TEST_GUILD_ID = "1544828627127115846";

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

function testGuildId() {
  return String(process.env.TEST_GUILD_ID || BUILTIN_TEST_GUILD_ID).trim();
}

function selectRuntimeGuild(client) {
  const primary = String(process.env.PRIMARY_GUILD_ID || process.env.GUILD_ID || "").trim();
  const test = testGuildId();

  if (!process.env.PRIMARY_GUILD_ID && primary) {
    process.env.PRIMARY_GUILD_ID = primary;
  }

  const primaryVisible = Boolean(primary && client.guilds.cache.has(primary));
  const testVisible = Boolean(test && client.guilds.cache.has(test));

  if (primaryVisible) {
    process.env.GUILD_ID = primary;
    process.env.RUNTIME_GUILD_MODE = "production";
    console.log(`🏰 Runtime guild: production ${primary}`);
    return { primary, test, primaryVisible, testVisible, active: primary, mode: "production" };
  }

  if (testVisible) {
    process.env.GUILD_ID = test;
    process.env.RUNTIME_GUILD_MODE = "test";
    console.warn(`🧪 Production guild ${primary || "not configured"} is unavailable; using test guild ${test} for this runtime.`);
    return { primary, test, primaryVisible, testVisible, active: test, mode: "test" };
  }

  process.env.RUNTIME_GUILD_MODE = "unavailable";
  console.warn(`⚠️ Neither production guild ${primary || "not configured"} nor test guild ${test || "not configured"} is visible to the bot.`);
  return { primary, test, primaryVisible, testVisible, active: primary || null, mode: "unavailable" };
}

async function deployCommandsToTestGuild(client, test) {
  if (!test || !client.guilds.cache.has(test)) return false;

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const applicationId = String(process.env.CLIENT_ID || client.user.id);
  const route = Routes.applicationGuildCommands(applicationId, test);
  const body = COMMAND_FILES.map((file) => require(`../commands/${file}`).data.toJSON());

  // If the standalone anti-raid service is also installed in the test guild,
  // preserve its /security command instead of deleting it during the test sync.
  const existing = await rest.get(route).catch(() => []);
  const security = Array.isArray(existing)
    ? existing.find((command) => command.name === "security")
    : null;
  if (security) body.push(cleanLiveCommand(security));

  await rest.put(route, { body });
  console.log(`🧪 Test guild ${test}: synced ${body.length} slash command${body.length === 1 ? "" : "s"}.`);
  return true;
}

module.exports = {
  name: "clientReady",
  once: true,
  execute(client) {
    // IMPORTANT: choose the runtime guild synchronously before the first await.
    // This file is deliberately prefixed with 000 so it is registered before
    // the other clientReady modules; they will therefore read the resolved
    // process.env.GUILD_ID on their first line.
    const target = selectRuntimeGuild(client);

    if (target.testVisible && target.test !== target.primary) {
      deployCommandsToTestGuild(client, target.test).catch((error) => {
        console.warn(`[TEST GUILD] Command sync failed for ${target.test}: ${error.message}`);
      });
    }
  },
};

module.exports._test = {
  BUILTIN_TEST_GUILD_ID,
  testGuildId,
};
