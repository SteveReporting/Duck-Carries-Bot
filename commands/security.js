'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleSecurityCommand } = require('../security/runtime');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Carry Tavern security controls')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('status').setDescription('Show security status'))
    .addSubcommand((s) => s
      .setName('panic')
      .setDescription('Immediately lock down the server')
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the emergency lockdown').setMaxLength(300)))
    .addSubcommand((s) => s.setName('unlock').setDescription('Release a security lockdown'))
    .addSubcommand((s) => s
      .setName('maintenance')
      .setDescription('Enable or disable maintenance mode for authorized structural work')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Maintenance mode').setRequired(true)))
    .addSubcommand((s) => s.setName('snapshot').setDescription('Save a fresh server-structure snapshot'))
    .addSubcommand((s) => s
      .setName('trust-user')
      .setDescription('Add or remove a trusted security actor')
      .addStringOption((o) => o
        .setName('mode')
        .setDescription('Add or remove')
        .setRequired(true)
        .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
      .addUserOption((o) => o.setName('user').setDescription('Discord user').setRequired(true)))
    .addSubcommand((s) => s
      .setName('trust-role')
      .setDescription('Add or remove a trusted role')
      .addStringOption((o) => o
        .setName('mode')
        .setDescription('Add or remove')
        .setRequired(true)
        .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
      .addRoleOption((o) => o.setName('role').setDescription('Discord role').setRequired(true)))
    .addSubcommand((s) => s.setName('trust-list').setDescription('Show trusted users and roles')),

  async execute(interaction) {
    return handleSecurityCommand(interaction);
  },
};
