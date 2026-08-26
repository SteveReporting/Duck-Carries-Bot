'use strict';

const { config, validateConfig } = require('./config');
const { SecurityStore } = require('./store');
const { AiSecurityAnalyst } = require('./ai');
const { SecurityEngine } = require('./security');
const { SecurityHeartbeat } = require('./heartbeat');

let runtime = null;
let starting = null;

async function startSecurity(client) {
  if (runtime) return runtime;
  if (starting) return starting;

  starting = (async () => {
    validateConfig();

    const guild = client.guilds.cache.get(config.discord.guildId)
      || await client.guilds.fetch(config.discord.guildId);

    // Prime configured member/role targets used by channel permission overwrites.
    for (const ownerId of [...config.securityOwners]) {
      const member = guild.members.cache.get(ownerId)
        || await guild.members.fetch(ownerId).catch(() => null);
      if (!member) {
        console.warn(`[security-config] SECURITY_OWNER_IDS contains ${ownerId}, but that user is not in this guild. Ignoring it.`);
        config.securityOwners.delete(ownerId);
      }
    }

    const store = new SecurityStore(
      config.stateFile,
      config.initialTrustedUsers,
      config.initialTrustedRoles,
    );

    for (const roleId of [...store.state.trustedRoles]) {
      if (!guild.roles.cache.has(roleId)) {
        console.warn(`[security-config] Removing stale trusted role ${roleId}.`);
        store.removeTrustedRole(roleId);
      }
    }

    const ai = new AiSecurityAnalyst({
      enabled: config.ai.enabled,
      apiKey: config.ai.apiKey,
      model: config.ai.model,
      allowedLanguages: config.language.allowed,
      languageRestrictionEnabled: config.language.enabled,
    });

    const engine = new SecurityEngine(client, config, store, ai);
    const heartbeat = new SecurityHeartbeat(client, engine);
    engine.bind();
    await engine.initialize(guild);
    heartbeat.start(guild);

    runtime = { client, guild, config, store, ai, engine, heartbeat };
    console.log(`[security] Integrated protection active for ${guild.name} (${guild.id})`);
    console.log('[security] Mass join waves are NOT used as a raid signal.');
    return runtime;
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

function getSecurityRuntime() {
  return runtime;
}

async function handleSecurityCommand(interaction) {
  const current = runtime || await startSecurity(interaction.client);
  const { engine, store, ai } = current;

  if (!engine.isSecurityOwner(interaction.user.id, interaction.guild)) {
    await interaction.reply({ content: '❌ Security-owner authorization required.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const snap = store.state.snapshot;
    await interaction.editReply([
      '**Security status**',
      `AI analyst: ${ai.available ? 'online' : 'offline'}`,
      `Maintenance: ${store.state.maintenance ? 'ON' : 'OFF'}`,
      `Lockdown: ${store.state.lockdown.active ? 'ACTIVE' : 'OFF'}`,
      `Last snapshot: ${snap?.createdAt || 'none'}`,
      `Trusted users: ${store.state.trustedUsers.length}`,
      `Trusted roles: ${store.state.trustedRoles.length}`,
      'Join-wave detection: disabled by design (join volume is not a raid signal).',
    ].join('\n'));
    return;
  }

  if (sub === 'panic') {
    const reason = interaction.options.getString('reason') || `Manual panic by ${interaction.user.tag}`;
    const activated = await engine.lockdown(interaction.guild, reason, interaction.user.id);
    await interaction.editReply(activated ? '🚨 Emergency lockdown activated.' : 'Lockdown is already active.');
    return;
  }

  if (sub === 'unlock') {
    const released = await engine.unlock(interaction.guild, interaction.user.id);
    await interaction.editReply(released ? '✅ Lockdown released.' : 'No lockdown is active.');
    return;
  }

  if (sub === 'maintenance') {
    const enabled = interaction.options.getBoolean('enabled', true);
    store.setMaintenance(enabled);
    await engine.log('security-audit', `🛠️ Maintenance mode **${enabled ? 'ENABLED' : 'DISABLED'}** by <@${interaction.user.id}>.`);
    await engine.updateOverview(interaction.guild);
    await interaction.editReply(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}.`);
    return;
  }

  if (sub === 'snapshot') {
    await engine.snapshotGuild(interaction.guild, `manual by ${interaction.user.id}`);
    await interaction.editReply('📸 Security snapshot saved.');
    return;
  }

  if (sub === 'trust-user') {
    const user = interaction.options.getUser('user', true);
    const mode = interaction.options.getString('mode', true);
    if (mode === 'add') store.addTrustedUser(user.id);
    else store.removeTrustedUser(user.id);
    await interaction.editReply(`${mode === 'add' ? 'Added' : 'Removed'} ${user.tag} ${mode === 'add' ? 'to' : 'from'} the trusted-user list.`);
    return;
  }

  if (sub === 'trust-role') {
    const role = interaction.options.getRole('role', true);
    const mode = interaction.options.getString('mode', true);
    if (mode === 'add') store.addTrustedRole(role.id);
    else store.removeTrustedRole(role.id);
    await interaction.editReply(`${mode === 'add' ? 'Added' : 'Removed'} @${role.name} ${mode === 'add' ? 'to' : 'from'} the trusted-role list.`);
    return;
  }

  if (sub === 'trust-list') {
    const users = store.state.trustedUsers.length
      ? store.state.trustedUsers.map((id) => `<@${id}>`).join(', ')
      : 'none';
    const roles = store.state.trustedRoles.length
      ? store.state.trustedRoles.map((id) => `<@&${id}>`).join(', ')
      : 'none';
    await interaction.editReply(`**Trusted users:** ${users}\n**Trusted roles:** ${roles}`);
  }
}

module.exports = { startSecurity, getSecurityRuntime, handleSecurityCommand };
