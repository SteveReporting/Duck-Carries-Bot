'use strict';

const { PermissionFlagsBits } = require('discord.js');

const REQUIRED = [
  ['ViewAuditLog', PermissionFlagsBits.ViewAuditLog],
  ['ManageGuild', PermissionFlagsBits.ManageGuild],
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['KickMembers', PermissionFlagsBits.KickMembers],
  ['BanMembers', PermissionFlagsBits.BanMembers],
  ['ModerateMembers', PermissionFlagsBits.ModerateMembers],
  ['ManageWebhooks', PermissionFlagsBits.ManageWebhooks],
  ['ManageMessages', PermissionFlagsBits.ManageMessages],
];

class SecurityHeartbeat {
  constructor(client, security) {
    this.client = client;
    this.security = security;
    this.timer = null;
    this.lastFingerprint = null;
  }

  start(guild) {
    if (this.timer) return;
    this.check(guild).catch((e) => console.error('[security-heartbeat]', e));
    this.timer = setInterval(() => {
      this.check(guild).catch((e) => console.error('[security-heartbeat]', e));
    }, 2 * 60 * 1000);
    this.timer.unref?.();
  }

  async check(guild) {
    const me = guild.members.me || await guild.members.fetchMe();
    const missing = REQUIRED.filter(([, bit]) => !me.permissions.has(bit)).map(([name]) => name);

    const dangerousRolesAbove = guild.roles.cache.filter((role) =>
      role.id !== guild.roles.everyone.id &&
      role.position > me.roles.highest.position &&
      [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.BanMembers,
      ].some((bit) => role.permissions.has(bit)),
    );

    const fingerprint = JSON.stringify({
      missing: [...missing].sort(),
      above: [...dangerousRolesAbove.keys()].sort(),
    });

    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;

    if (missing.length || dangerousRolesAbove.size) {
      const problems = [];
      if (missing.length) problems.push(`Missing permissions: ${missing.join(', ')}`);
      if (dangerousRolesAbove.size) {
        problems.push(`Dangerous roles above bot role: ${[...dangerousRolesAbove.values()].map((r) => `@${r.name}`).join(', ')}`);
      }
      await this.security.incident('security-integrity-degraded', 'critical', {
        details: problems.join('\n'),
      }, 'security-audit');
    } else {
      await this.security.log('security-audit', '💚 Security heartbeat healthy: required permissions and role hierarchy look good.');
    }
  }
}

module.exports = { SecurityHeartbeat };
