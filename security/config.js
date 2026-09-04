'use strict';

const path = require('node:path');

function ids(value = '') {
  return new Set(
    String(value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const BOOT_GUILD_ID = String(process.env.GUILD_ID || '').trim();

function createSecurityConfig(guildId = BOOT_GUILD_ID) {
  const resolvedGuildId = String(guildId || '').trim();
  const securityOwners = ids(process.env.SECURITY_OWNER_IDS);

  // Permanent immunity: Chicken. Security treats this user the same as a
  // security owner so anti-spam/honeypot/anti-nuke containment ignores them.
  securityOwners.add('1137081101341433936');

  const stateName = resolvedGuildId && BOOT_GUILD_ID && resolvedGuildId !== BOOT_GUILD_ID
    ? `security-state-${resolvedGuildId}.json`
    : 'security-state.json';

  return {
    discord: {
      guildId: resolvedGuildId,
    },

    securityOwners,
    initialTrustedUsers: ids(process.env.TRUSTED_USER_IDS),
    initialTrustedRoles: ids(process.env.TRUSTED_ROLE_IDS),

    ai: {
      enabled: bool(process.env.AI_ANALYSIS_ENABLED, true),
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.SECURITY_AI_MODEL || process.env.OPENAI_MODEL || 'qwen3-vl:8b',
      minRuleScore: number(process.env.AI_MIN_RULE_SCORE, 3),
    },

    language: {
      enabled: bool(process.env.LANGUAGE_RESTRICTOR_ENABLED, false),
      allowed: String(process.env.ALLOWED_LANGUAGES || 'en')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    },

    restoreDeletedChannels: bool(process.env.RESTORE_DELETED_CHANNELS, true),
    restoreDeletedRoles: bool(process.env.RESTORE_DELETED_ROLES, true),
    autoLockdownOnNuke: bool(process.env.AUTO_LOCKDOWN_ON_NUKE, true),
    honeypotAutoBan: bool(process.env.HONEYPOT_AUTO_BAN, true),
    spamQuarantineMinutes: number(process.env.SPAM_QUARANTINE_MINUTES, 30),
    securityCategoryName: process.env.SECURITY_CATEGORY_NAME || '🔐・ANTI RAID SECURITY',
    logMemberJoins: bool(process.env.LOG_MEMBER_JOINS, false),

    scores: {
      delete: number(process.env.SPAM_DELETE_SCORE, 4),
      timeout: number(process.env.SPAM_TIMEOUT_SCORE, 7),
      ban: number(process.env.SPAM_BAN_SCORE, 12),
    },

    stateFile: path.join(process.cwd(), 'data', stateName),
  };
}

const config = createSecurityConfig();

function validateConfig(target = config) {
  if (!target?.discord?.guildId) {
    throw new Error('Integrated security requires a guild ID.');
  }
}

module.exports = {
  config,
  createSecurityConfig,
  validateConfig,
};
