'use strict';

const { REST, Routes } = require('discord.js');

const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.warn('[command-cleanup] Skipped global command cleanup because TOKEN/DISCORD_TOKEN or CLIENT_ID is missing.');
} else {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = Routes.applicationCommands(clientId);

  void (async () => {
    try {
      const commands = await rest.get(route);
      if (!Array.isArray(commands) || commands.length === 0) {
        console.log('[command-cleanup] No stale global slash commands found.');
        return;
      }

      console.log(`[command-cleanup] Removing ${commands.length} stale global slash command(s): ${commands.map((command) => `/${command.name}`).join(', ')}`);
      await rest.put(route, { body: [] });
      console.log('[command-cleanup] Global slash-command scope cleared. Production commands remain guild-only.');
    } catch (error) {
      console.warn(`[command-cleanup] Could not clear global slash commands: ${error.message}`);
    }
  })();
}
