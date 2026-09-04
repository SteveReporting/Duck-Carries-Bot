const { REST, Routes } = require("discord.js");
const COMMAND_FILES = require("../command-manifest");

function commandDefinitions() {
  return COMMAND_FILES.map((file) => require(`../commands/${file}`).data.toJSON());
}

function restClient() {
  const token = String(process.env.TOKEN || process.env.DISCORD_TOKEN || "").trim();
  if (!token) throw new Error("Discord TOKEN/DISCORD_TOKEN is missing.");
  return new REST({ version: "10" }).setToken(token);
}

function applicationId() {
  const id = String(process.env.CLIENT_ID || "").trim();
  if (!id) throw new Error("CLIENT_ID is missing.");
  return id;
}

async function syncGlobalCommands() {
  const body = commandDefinitions();
  const rest = restClient();
  await rest.put(Routes.applicationCommands(applicationId()), { body });
  console.log(`🌍 Synced ${body.length} global slash commands. New servers can use /setup immediately.`);
  return body.length;
}

async function clearGuildCommandOverrides(guildId) {
  const id = String(guildId || "").trim();
  if (!id) return false;
  const rest = restClient();
  const route = Routes.applicationGuildCommands(applicationId(), id);
  try {
    await rest.put(route, { body: [] });
    console.log(`🧹 Cleared old guild command overrides in ${id}; global commands are now authoritative.`);
    return true;
  } catch (error) {
    if (error?.code === 50001 || error?.code === 10004 || error?.status === 403 || error?.status === 404) {
      console.warn(`⚠️ Could not clear guild command overrides in ${id}: guild is not currently accessible.`);
      return false;
    }
    throw error;
  }
}

module.exports = {
  applicationId,
  clearGuildCommandOverrides,
  commandDefinitions,
  syncGlobalCommands,
};
