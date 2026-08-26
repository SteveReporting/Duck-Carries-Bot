'use strict';

const { config, validateConfig } = require('./config');
const { SecurityStore } = require('./store');
const { AiSecurityAnalyst } = require('./ai');
const { SecurityEngine } = require('./security');
const { SecurityHeartbeat } = require('./heartbeat');

let runtime = null;
let starting = null;

const TICKETS_V2_BOT_ID = '1325579039888511056';
const PERMANENT_SECURITY_IMMUNE_ACTORS = new Set([
  '1137081101341433936', // Chicken
  TICKETS_V2_BOT_ID, // Tickets v2
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

  // Deleted Discord channel objects do not always retain a resolvable parent.
  // A strong ephemeral ticket name is therefore enough to suppress anti-nuke
  // restoration even when parent/category data has already disappeared.
  if (!parentName) return true;

  // Never suppress anti-nuke inside security or development/test areas.
  if (
    parentName.includes('security')
    || parentName.includes('test')
    || parentName.includes('demo')
  ) {
    return false;
  }

  return (
    parentName.includes('ticket')
    || parentName.includes('carryrequest')
    || parentName.includes('carrierapplication')
    || parentName.includes('recruitment')
  );
}

async function startSecurity(client) {
  if (runtime) return runtime;
  if (starting) return starting;

  starting = (async () => {
    validateConfig();

    const guild = client.guilds.cache.get(config.discord.guildId)
      || await client.guilds.fetch(config.discord.guildId);

    // Recover Tickets v2 if this security system previously false-positive banned it.
    // Unbanning does not add the bot back by itself, but it makes the normal Discord
    // app invite/install work again immediately.
    const ticketsV2Ban = await guild.bans.fetch(TICKETS_V2_BOT_ID).catch(() => null);
    if (ticketsV2Ban) {
      const unbanned = await guild.members.unban(
        TICKETS_V2_BOT_ID,
        'Recovering trusted Tickets v2 bot after false-positive anti-nuke containment',
      ).then(() => true).catch((error) => {
        console.warn(`[security] Could not auto-unban Tickets v2 (${TICKETS_V2_BOT_ID}): ${error.message}`);
        return false;
      });

      if (unbanned) {
        console.log(`[security] Auto-unbanned trusted Tickets v2 bot (${TICKETS_V2_BOT_ID}).`);
      }
    }

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

    // Permanent immunity is stronger than the ordinary trusted-user threshold.
    // These actors must never be counted toward anti-nuke, contained, timed out,
    // stripped of roles, or banned by this security engine.
    const originalIsTrustedActor = engine.isTrustedActor.bind(engine);
    engine.isTrustedActor = async (userId, targetGuild) => {
      if (PERMANENT_SECURITY_IMMUNE_ACTORS.has(String(userId))) return true;
      return originalIsTrustedActor(userId, targetGuild);
    };

    const originalRecordDangerousAction = engine.recordDangerousAction.bind(engine);
    engine.recordDangerousAction = async (targetGuild, actorId, kind, target) => {
      if (PERMANENT_SECURITY_IMMUNE_ACTORS.has(String(actorId))) {
        console.log(`[security] Ignored ${kind} from permanently immune actor ${actorId}: ${target}.`);
        return;
      }
      return originalRecordDangerousAction(targetGuild, actorId, kind, target);
    };

    const originalContainActor = engine.containActor.bind(engine);
    engine.containActor = async (targetGuild, actorId, reason) => {
      if (PERMANENT_SECURITY_IMMUNE_ACTORS.has(String(actorId))) {
        console.log(`[security] Blocked containment attempt against permanently immune actor ${actorId}: ${reason}.`);
        return;
      }
      return originalContainActor(targetGuild, actorId, reason);
    };

    // Tickets v2 itself is an approved bot. Never treat the bot being re-added as
    // an unauthorized bot addition, regardless of which moderator performs the invite.
    const originalOnMemberAdd = engine.onMemberAdd.bind(engine);
    engine.onMemberAdd = async (member) => {
      if (String(member?.id) === TICKETS_V2_BOT_ID) {
        console.log(`[security] Approved Tickets v2 bot joined (${TICKETS_V2_BOT_ID}); anti-bot enforcement skipped.`);
        await engine.log(
          'security-audit',
          `✅ Approved Tickets v2 bot <@${TICKETS_V2_BOT_ID}> joined; anti-bot enforcement skipped.`,
        );
        return;
      }
      return originalOnMemberAdd(member);
    };

    // Normal ticket closures can delete several channels within seconds. Those
    // deletions are expected lifecycle actions, not server destruction. Bypass
    // channel-delete anti-nuke accounting/restoration for clearly disposable
    // ticket channels; all permanent channels remain protected as before.
    const originalOnChannelDelete = engine.onChannelDelete.bind(engine);
    engine.onChannelDelete = async (channel) => {
      if (isDisposableTicketChannel(channel)) {
        const parentName = channel.parent?.name
          || channel.guild?.channels?.cache?.get(channel.parentId)?.name
          || 'unknown/deleted category';
        console.log(
          `[security] Expected ticket closure ignored by anti-nuke: #${channel.name} under ${parentName}.`,
        );
        await engine.log(
          'security-audit',
          `🧾 Expected ticket closure ignored by anti-nuke: **#${channel.name}** under **${parentName}**.`,
        );
        return;
      }

      return originalOnChannelDelete(channel);
    };

    // Defense in depth: even if another path calls restoreDeletedChannel
    // directly, never recreate a snapshot entry whose name is a disposable
    // ticket. This permanently stops closed ticket channels being resurrected.
    const originalRestoreDeletedChannel = engine.restoreDeletedChannel.bind(engine);
    engine.restoreDeletedChannel = async (targetGuild, oldId) => {
      const snapshotChannel = store.state.snapshot?.channels?.find(
        (entry) => String(entry.id) === String(oldId),
      );

      if (snapshotChannel && isDisposableTicketName(snapshotChannel.name)) {
        console.log(
          `[security] Suppressed anti-nuke restore for closed ticket #${snapshotChannel.name} (${oldId}).`,
        );
        return null;
      }

      return originalRestoreDeletedChannel(targetGuild, oldId);
    };

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
