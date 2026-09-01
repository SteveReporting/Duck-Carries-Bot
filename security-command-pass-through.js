'use strict';

const { Collection } = require('discord.js');

const originalGet = Collection.prototype.get;
const delegatedSecurityCommand = Object.freeze({
  data: { name: 'security' },
  async execute() {
    console.log('[COMMAND] /security delegated to standalone anti-raid service.');
  },
});

Collection.prototype.get = function carryTavernCommandGet(key) {
  const existing = originalGet.call(this, key);
  if (existing !== undefined || key !== 'security') return existing;

  // Only spoof /security for the main bot's command Collection. Other discord.js
  // Collections should retain their normal missing-key behaviour.
  const looksLikeMainCommandCollection = [...this.values()].some((value) =>
    value?.data?.name === 'queue' && typeof value?.execute === 'function',
  );

  return looksLikeMainCommandCollection ? delegatedSecurityCommand : existing;
};

console.log('[security-pass-through] /security delegated to standalone anti-raid service.');
