'use strict';

const { Collection, MessageFlags } = require('discord.js');
const { isGuildConfigured } = require('./platform/guildConfig');

const originalGet = Collection.prototype.get;
const guardedCache = new WeakMap();

const delegatedSecurityCommand = Object.freeze({
  data: { name: 'security' },
  async execute() {
    console.log('[COMMAND] /security delegated to standalone anti-raid service.');
  },
});

async function setupRequired(interaction) {
  const payload = {
    content: '🍺 This server has not been configured yet. A server manager must run `/setup` once before using Tavern systems.',
    flags: MessageFlags.Ephemeral,
  };
  if (interaction?.deferred || interaction?.replied) return interaction.followUp(payload).catch(() => null);
  return interaction?.reply?.(payload).catch(() => null);
}

function guardedCommand(command) {
  if (!command?.data?.name || typeof command.execute !== 'function') return command;
  if (command.data.name === 'setup') return command;
  if (guardedCache.has(command)) return guardedCache.get(command);

  const wrapped = Object.create(command);
  wrapped.execute = async function guardedExecute(interaction, ...args) {
    if (!interaction?.guildId) {
      return setupRequired(interaction);
    }
    if (!isGuildConfigured(interaction.guildId)) {
      return setupRequired(interaction);
    }
    return command.execute(interaction, ...args);
  };

  if (typeof command.autocomplete === 'function') {
    wrapped.autocomplete = async function guardedAutocomplete(interaction, ...args) {
      if (!interaction?.guildId || !isGuildConfigured(interaction.guildId)) {
        return interaction.respond([]).catch(() => null);
      }
      return command.autocomplete(interaction, ...args);
    };
  }

  guardedCache.set(command, wrapped);
  return wrapped;
}

Collection.prototype.get = function carryTavernCommandGet(key) {
  const existing = originalGet.call(this, key);

  if (existing !== undefined) {
    return guardedCommand(existing);
  }
  if (key !== 'security') return existing;

  // Only spoof /security for the main bot's command Collection. Other discord.js
  // Collections retain normal missing-key behaviour.
  const looksLikeMainCommandCollection = [...this.values()].some((value) =>
    value?.data?.name === 'queue' && typeof value?.execute === 'function',
  );

  return looksLikeMainCommandCollection ? delegatedSecurityCommand : existing;
};

console.log('[command-access] Multi-guild /setup guard enabled; /security remains delegated.');
