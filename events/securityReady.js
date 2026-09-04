'use strict';

const { startConfiguredSecurity } = require('../security/runtime');
const { listConfiguredGuildIds } = require('../platform/guildConfig');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const ids = listConfiguredGuildIds();
    if (!ids.length && process.env.GUILD_ID) ids.push(String(process.env.GUILD_ID));
    await startConfiguredSecurity(client, ids).catch((error) => {
      console.error('[security-startup] Failed to initialize integrated security:', error);
    });
  },
};
