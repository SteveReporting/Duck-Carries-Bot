const path = require("path");
const {
  applyLegacyEnvironment,
  getGuildConfig,
  isGuildConfigured,
  listConfiguredGuilds,
} = require("./guildConfig");

// These older startup modules still use one environment-selected guild. They are
// run for a compatibility-primary guild only. Interaction-driven commands and
// stored community state are independently guild-scoped.
const LEGACY_GUILD_READY_FILES = new Set([
  "carrierApplicationTicketCleanupReady.js",
  "carryControlCenterReady.js",
  "carryOpsIntelligenceReady.js",
  "carryServiceTimeReady.js",
  "carryTicketOrphanCleanupReady.js",
  "carryVoiceReady.js",
  "goldDonationReady.js",
  "liveCarryBoardReady.js",
  "ready.js",
  "securityEveryoneMentionPolicyReady.js",
  "securityReady.js",
  "staffOperationsHubReady.js",
  "supportTicketReady.js",
  "treasuryReady.js",
]);

function configuredVisibleGuilds(client) {
  if (!client?.guilds?.cache) return [];
  return listConfiguredGuilds().filter((config) => client.guilds.cache.has(String(config.guild)));
}

function chooseCompatibilityGuild(client) {
  const visible = configuredVisibleGuilds(client);
  if (!visible.length) return null;

  const preferredIds = [
    process.env.PRIMARY_GUILD_ID,
    process.env.GUILD_ID,
    process.env.TEST_GUILD_ID,
  ].map((value) => String(value || "").trim()).filter(Boolean);

  for (const id of preferredIds) {
    const config = visible.find((row) => String(row.guild) === id);
    if (config) return config;
  }
  return visible[0];
}

function activateCompatibilityGuild(client, guildId) {
  const id = String(guildId || "").trim();
  if (!id || !isGuildConfigured(id) || !client?.guilds?.cache?.has(id)) return null;
  const config = getGuildConfig(id);
  applyLegacyEnvironment(config);
  client.tavernLegacyGuildId = id;
  client.tavernConfiguredGuildIds = new Set(configuredVisibleGuilds(client).map((row) => String(row.guild)));
  console.log(`🌍 Tavern runtime compatibility guild: ${config.guild_name || id} (${id})`);
  return config;
}

function initializeRuntimeSelection(client) {
  const visible = configuredVisibleGuilds(client);
  client.tavernConfiguredGuildIds = new Set(visible.map((row) => String(row.guild)));

  const chosen = chooseCompatibilityGuild(client);
  if (!chosen) {
    client.tavernLegacyGuildId = null;
    delete process.env.GUILD_ID;
    console.log(`🌍 Multi-guild mode online • ${client.guilds.cache.size} joined server(s) • none configured yet. Run /setup in any server.`);
    return null;
  }

  activateCompatibilityGuild(client, chosen.guild);
  console.log(`🌍 Multi-guild mode online • ${client.guilds.cache.size} joined server(s) • ${visible.length} configured and visible.`);
  return chosen;
}

function isLegacyGuildReadyFile(file) {
  return LEGACY_GUILD_READY_FILES.has(String(file || ""));
}

async function runLegacyGuildReadyEvents(client) {
  if (!client?.tavernLegacyGuildId) return 0;
  if (client.__tavernLegacyReadyManuallyStarted) return 0;
  client.__tavernLegacyReadyManuallyStarted = true;

  let started = 0;
  for (const file of LEGACY_GUILD_READY_FILES) {
    try {
      const event = require(path.join(__dirname, "..", "events", file));
      if (event?.name !== "clientReady" || typeof event.execute !== "function") continue;
      await event.execute(client);
      started += 1;
    } catch (error) {
      console.warn(`[MULTI-GUILD] Could not start ${file}: ${error.message}`);
    }
  }
  console.log(`🌍 Started ${started} compatibility background module(s) for guild ${client.tavernLegacyGuildId}.`);
  return started;
}

async function activateAfterSetup(client, guildId) {
  if (!client?.guilds?.cache?.has(String(guildId))) return null;
  client.tavernConfiguredGuildIds ||= new Set();
  client.tavernConfiguredGuildIds.add(String(guildId));

  if (client.tavernLegacyGuildId) return getGuildConfig(guildId);
  const config = activateCompatibilityGuild(client, guildId);
  if (!config) return null;
  await runLegacyGuildReadyEvents(client);
  return config;
}

module.exports = {
  LEGACY_GUILD_READY_FILES,
  activateAfterSetup,
  activateCompatibilityGuild,
  chooseCompatibilityGuild,
  configuredVisibleGuilds,
  initializeRuntimeSelection,
  isLegacyGuildReadyFile,
  runLegacyGuildReadyEvents,
};
