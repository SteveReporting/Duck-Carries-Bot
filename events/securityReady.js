'use strict';

const { startSecurity } = require('../security/runtime');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    await startSecurity(client).catch((error) => {
      console.error('[security-startup] Failed to initialize integrated security:', error);
    });
  },
};
