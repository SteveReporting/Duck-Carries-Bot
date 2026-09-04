'use strict';

const { createSecurityConfig, validateConfig } = require('./config');
const { SecurityStore } = require('./store');
const { AiSecurityAnalyst } = require('./ai');
const { SecurityEngine } = require('./security');
const { SecurityHeartbeat } = require('./heartbeat');

const runtimes = new Map();
const starting = new Map();

const TICKETS_V2_BOT_ID = '1325579039888511056';
const PERMANENT_SECURITY_IMMUNE_ACTORS = new Set([
  '1137081101341433936', // Chicken
  TICKETS_V2_BOT_ID,
]);

function normalizeChannelName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isDisposableTicketName(value) {
  const channelName = normalizeChannelName(value);
  if (!channelName) return false;
  return (
    /^duckrequest\d+$/.test(channelName)
    || /^ticket\d+$/.test(channelName)
    || /^carry[a-z0-9]*\d{3,}$/.test(channelName)
    || /^carrier(?:application|app|request)[a-z0-9]*\d+$/.test(channelName)
  );
}

function isDisposableTicketChannel(channel) {
  if (!channel?.guild || channel.isThread?.()) return false;
  const channelName = normalizeChannelName(channel.name);
  if (!isDisposableTicketName(channelName)) return false;

  const parentName = normalizeChannelName(
    channel.parent?.name
      || channel.guild.channels.cache.get(channel.parentId)?.name
      || '',
  );

  if (!parentName) return true;
  if (parentName.includes('security') || parentName.includes('test') || parentName.includes('demo')) {
    return false;
  }

  return (
    parentName.includes('ticket')
    || parentName.includes('carryrequest')
    || parentName.includes('carrierapplication')
    || parentName.includes('recruitment')
  );
}

function runtimeFor(guildId) {
  const id = String(guildId || '').trim();
  if (id) return runtimes.get(id) || null;
  if (runtimes.size === 1) return [...runtimes.values()][0] || null;
  return null;
}

async function buildSecurityRuntime(client, guildId) {
  const targetConfig = createSecurityConfig(guildId);
  validateConfig(targetConfig);

  const guild = client.guilds.cache.get(targetConfig.discord.guildId)
    || await client.guilds.fetch(targetConfig.discord.guildId);

  const ticketsV2Ban = await guild.bans.fetch(TICKETS_V2_BOT_ID).catch(() => null);
  if (ticketsV2Ban) {
    const unbanned = await guild.members.unban(
      TICKETS_V2_BOT_ID,
      'Recovering trusted Tickets v2 bot after false-positive anti-nuke containment',
    ).then(() => true).catch((error) => {
      console.warn(`[security:${guild.id}] Could not auto-unban Tickets v2: ${error.message}`);
      return false;
    });
    if (unbanned) console.log(`[security:${guild.id}] Auto-unbanned trusted Tickets v2 bot.`);
  }

  for (const ownerId of [...targetConfig.securityOwners]) {
    const member = guild.members.cache.get(ownerId)
      || await guild.members.fetch(ownerId).catch(() => null);
    if (!member) targetConfig.securityOwners.delete(ownerId);
  }

  const store = new SecurityStore(
    targetConfig.stateFile,
    targetConfig.initialTrustedUsers,
    targetConfig.initialTrustedRoles,
  );

  for (const roleId of [...store.state.trustedRoles]) {
    if (!guild.roles.cache.has(roleId)) store.removeTrustedRole(roleId);
  }

  const ai = new AiSecurityAnalyst({
    enabled: targetConfig.ai.enabled,
    apiKey: targetConfig.ai.apiKey,
    model: targetConfig.ai.model,
    allowedLanguages: targetConfig.language.allowed,
    languageRestrictionEnabled: targetConfig.language.enabled,
  });

  const engine = new SecurityEngine(client, targetConfig, store, ai);

  const originalIsTrustedActor = engine.isTrustedActor.bind(engine);
  engine.isTrustedActor = async (userId, targetGuild) => {
    if (PERMANENT_SECURITY_IMMUNE_ACTORS.has(String(userId))) return true;
    return originalIsTrustedActor(userId, targetGuild);
  };

  const originalRecordDangerousAction = engine.recordDangerousAction.bind(engine);
  engine.recordDangerousAction = async (targetGuild, actorId, kind, target) => {
    if (PERMANENT_SECURITY_IMMUNE_ACTORS.has(String(actorId))) {
      console.log(`[security:${guild.id}] Ignored ${kind} from permanently immune actor ${actorId}: ${target}.`);
      return;
    }
    return originalRecordDangerousAction(targetGuild, actorId, kind, target);
  };

  const originalContainActor = engine.containActor.bind(engine);
  engine.containActor = async (targetGuild, actorId, reason) => {
    if (PERMANENT_SECURITY_IMMUNE_ACTORS.has(String(actorId))) {
      console.log(`[security:${guild.id}] Blocked containment against immune actor ${actorId}: ${reason}.`);
      return;
    }
    return originalContainActor(targetGuild, actorId, reason);
  };

  const originalOnMemberAdd = engine.onMemberAdd.bind(engine);
  engine.onMemberAdd = async (member) => {
    if (String(member?.guild?.id || '') !== String(guild.id)) return;
    if (String(member?.id) === TICKETS_V2_BOT_ID) {
      await engine.log(
        'security-audit',
        `✅ Approved Tickets v2 bot <@${TICKETS_V2_BOT_ID}> joined; anti-bot enforcement skipped.`,
      );
      return;
    }
    return originalOnMemberAdd(member);
  };

  const originalOnChannelDelete = engine.onChannelDelete.bind(engine);
  engine.onChannelDelete = async (channel) => {
    if (String(channel?.guild?.id || '') !== String(guild.id)) return;
    if (isDisposableTicketChannel(channel)) {
      const parentName = channel.parent?.name
        || channel.guild?.channels?.cache?.get(channel.parentId)?.name
        || 'unknown/deleted category';
      await engine.log(
        'security-audit',
        `🧾 Expected ticket closure ignored by anti-nuke: **#${channel.name}** under **${parentName}**.`,
      );
      return;
    }
    return originalOnChannelDelete(channel);
  };

  const originalRestoreDeletedChannel = engine.restoreDeletedChannel.bind(engine);
  engine.restoreDeletedChannel = async (targetGuild, oldId) => {
    const snapshotChannel = store.state.snapshot?.channels?.find(
      (entry) => String(entry.id) === String(oldId),
    );
    if (snapshotChannel && isDisposableTicketName(snapshotChannel.name)) return null;
    return originalRestoreDeletedChannel(targetGuild, oldId);
  };

  const originalOnRoleUpdate = engine.onRoleUpdate.bind(engine);
  engine.onRoleUpdate = async (oldRole, newRole) => {
    if (String(newRole?.guild?.id || '') !== String(guild.id)) return;
    const expected = client.__securityExpectedRolePermissionChanges;
    const key = String(newRole?.id || '');
    const token = expected instanceof Map ? expected.get(key) : null;

    if (token) {
      if (Date.now() > Number(token.expiresAt || 0)) {
        expected.delete(key);
      } else if (String(newRole.permissions.bitfield) === String(token.bitfield)) {
        expected.delete(key);
        await engine.log(
          'security-audit',
          `✅ Expected staff permission update accepted for **@${newRole.name}**. Anti-raid remained active for all other role changes.`,
        );
        return;
      }
    }
    return originalOnRoleUpdate(oldRole, newRole);
  };

  const heartbeat = new SecurityHeartbeat(client, engine);
  engine.bind();
  await engine.initialize(guild);
  heartbeat.start(guild);

  const runtime = { client, guild, config: targetConfig, store, ai, engine, heartbeat };
  runtimes.set(String(guild.id), runtime);
  console.log(`[security] Integrated protection active for ${guild.name} (${guild.id})`);
  return runtime;
}

async function startSecurity(client, guildId = process.env.GUILD_ID) {
  const id = String(guildId || '').trim();
  if (!id) throw new Error('Integrated security requires a guild ID.');
  if (runtimes.has(id)) return runtimes.get(id);
  if (starting.has(id)) return starting.get(id);

  const promise = buildSecurityRuntime(client, id);
  starting.set(id, promise);
  try {
    return await promise;
  } finally {
    starting.delete(id);
  }
}

async function startConfiguredSecurity(client, guildIds = []) {
  const ids = [...new Set((guildIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const results = [];
  for (const id of ids) {
    try {
      results.push(await startSecurity(client, id));
    } catch (error) {
      console.error(`[security-startup:${id}] ${error.message}`);
    }
  }
  return results;
}

function getSecurityRuntime(guildId = null) {
  return runtimeFor(guildId);
}

async function handleSecurityCommand(interaction) {
  const current = runtimeFor(interaction.guildId)
    || await startSecurity(interaction.client, interaction.guildId);
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
      'Anti-nuke, anti-bot, webhook, spam, honeypot and privilege-abuse protection are active.',
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
    await engine.ensureSecurityChannels(interaction.guild);
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

module.exports = {
  startSecurity,
  startConfiguredSecurity,
  getSecurityRuntime,
  handleSecurityCommand,
};
