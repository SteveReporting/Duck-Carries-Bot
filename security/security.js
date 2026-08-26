'use strict';

const {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks,
];

const SECURITY_CHANNELS = [
  ['security-overview', 'Read-only security status and operating notes.'],
  ['nuke-detection', 'Channel/role destruction, mass moderation and server tampering.'],
  ['spam-detection', 'Behaviour-based spam and coordinated payload detection.'],
  ['nsfw-auto-delete', 'NSFW content deletion reports.'],
  ['language-restrictor', 'Language policy detections when enabled.'],
  ['administrator-privilege-abuse', 'Dangerous role/permission escalation events.'],
  ['webhook-security', 'Unauthorized webhook creation, deletion and changes.'],
  ['bot-security', 'Unauthorized bot additions and dangerous bot permissions.'],
  ['honeypot', 'SECURITY TRAP — do not send messages here. Messages trigger automatic enforcement.'],
  ['ai-security-analysis', 'AI analyst context. AI never directly executes moderation actions.'],
  ['incident-reports', 'Master security incident log.'],
  ['security-audit', 'Security bot health, maintenance and routine audit events.'],
];

const SCAM_TERMS = [
  'free nitro', 'free robux', 'steam gift', 'claim reward', 'claim your reward',
  'verify your account', 'verification required', 'limited gift', 'airdrop',
  'wallet connect', 'crypto giveaway', 'gift inventory', 'discord staff verification',
];

const NSFW_TERMS = [
  'pornhub', 'xvideos', 'xnxx', 'rule34', 'onlyfans leak', 'nudes leak',
];

const SHORTENER_HOSTS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at',
]);

class SecurityEngine {
  constructor(client, config, store, ai) {
    this.client = client;
    this.config = config;
    this.store = store;
    this.ai = ai;
    this.channels = new Map();
    this.messageWindows = new Map();
    this.payloadClusters = new Map();
    this.dangerWindows = new Map();
    this.auditSeen = new Map();
    this.snapshotTimer = null;
    this.snapshotBusy = false;
    this.bound = false;
    this.reportError = (error) => console.error('[security]', error);
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    const c = this.client;

    c.on('messageCreate', (m) => this.onMessage(m).catch(this.reportError));
    c.on('messageUpdate', (_old, m) => {
      if (!m.partial) this.onMessage(m, true).catch(this.reportError);
    });

    c.on('channelCreate', (ch) => this.onChannelCreate(ch).catch(this.reportError));
    c.on('channelDelete', (ch) => this.onChannelDelete(ch).catch(this.reportError));
    c.on('channelUpdate', (oldCh, newCh) => this.onChannelUpdate(oldCh, newCh).catch(this.reportError));

    c.on('roleCreate', (r) => this.onRoleCreate(r).catch(this.reportError));
    c.on('roleDelete', (r) => this.onRoleDelete(r).catch(this.reportError));
    c.on('roleUpdate', (oldR, newR) => this.onRoleUpdate(oldR, newR).catch(this.reportError));

    c.on('guildMemberAdd', (m) => this.onMemberAdd(m).catch(this.reportError));
    c.on('guildMemberRemove', (m) => this.onMemberRemove(m).catch(this.reportError));
    c.on('guildMemberUpdate', (oldM, newM) => this.onMemberUpdate(oldM, newM).catch(this.reportError));
    c.on('guildBanAdd', (ban) => this.onBanAdd(ban).catch(this.reportError));
    c.on('webhooksUpdate', (ch) => this.onWebhooksUpdate(ch).catch(this.reportError));
    c.on('guildUpdate', (oldG, newG) => this.onGuildUpdate(oldG, newG).catch(this.reportError));
  }

  async initialize(guild) {
    await this.ensureSecurityChannels(guild);
    await this.snapshotGuild(guild, 'startup');
    if (!this.snapshotTimer) {
      this.snapshotTimer = setInterval(() => {
        this.snapshotGuild(guild, 'periodic').catch(this.reportError);
        this.cleanupRuntimeMaps();
      }, 5 * 60 * 1000);
      this.snapshotTimer.unref?.();
    }

    await this.log('security-audit', `✅ Integrated security engine online. Join-wave volume is **not** used as a raid trigger. AI analyst: **${this.ai.available ? 'online' : 'offline'}**.`);
    await this.updateOverview(guild);
  }

  isSecurityOwner(userId, guild) {
    return userId === guild.ownerId || this.config.securityOwners.has(String(userId));
  }

  async isTrustedActor(userId, guild) {
    if (!userId) return false;
    if (userId === this.client.user?.id) return true;
    if (this.isSecurityOwner(userId, guild)) return true;
    if (this.store.isTrustedUser(userId)) return true;

    try {
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
      return member.roles.cache.some((role) => this.store.isTrustedRole(role.id));
    } catch {
      return false;
    }
  }

  async ensureSecurityChannels(guild) {
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === this.config.securityCategoryName,
    );

    const ownerOverwrites = [];
    for (const id of [...this.config.securityOwners]) {
      const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
      if (!member) continue;
      ownerOverwrites.push({
        id: member.user,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks,
        ],
      });
    }

    const trustedRoleOverwrites = this.store.state.trustedRoles
      .map((id) => guild.roles.cache.get(id))
      .filter(Boolean)
      .map((role) => ({
        id: role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      }));

    const privateOverwrites = [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      ...ownerOverwrites,
      ...trustedRoleOverwrites,
    ];

    if (!category) {
      category = await guild.channels.create({
        name: this.config.securityCategoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: privateOverwrites,
        reason: 'Security system setup',
      });
    }

    for (const [name, topic] of SECURITY_CHANNELS) {
      let channel = guild.channels.cache.find(
        (c) => c.parentId === category.id && c.name === name && c.type === ChannelType.GuildText,
      );

      if (!channel) {
        const options = {
          name,
          type: ChannelType.GuildText,
          parent: category.id,
          topic,
          reason: 'Security system setup',
        };

        if (name === 'honeypot') {
          options.permissionOverwrites = [
            {
              id: guild.roles.everyone,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
              deny: [PermissionFlagsBits.ReadMessageHistory],
            },
            ...ownerOverwrites.map((overwrite) => ({
              id: overwrite.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            })),
          ];
        }

        channel = await guild.channels.create(options);
      }

      this.channels.set(name, channel.id);
    }
  }

  async updateOverview(guild) {
    const channel = this.getChannel('security-overview');
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('🔐 Carry Tavern Security')
      .setDescription([
        '**Protection model:** behaviour + audit-log based.',
        '**Mass join waves:** explicitly ignored as a raid signal.',
        '**AI:** analyst only; AI output cannot directly ban, alter roles, or execute commands.',
        '**Honeypot:** messages trigger automatic enforcement when enabled.',
        '**Anti-nuke:** channel/role deletion, privilege escalation, webhooks, bot adds, mass kicks/bans.',
      ].join('\n'))
      .addFields(
        { name: 'Maintenance', value: this.store.state.maintenance ? '🟠 ON' : '🟢 OFF', inline: true },
        { name: 'Lockdown', value: this.store.state.lockdown.active ? '🔴 ACTIVE' : '🟢 OFF', inline: true },
        { name: 'AI analyst', value: this.ai.available ? '🟢 ONLINE' : '⚪ OFFLINE', inline: true },
      )
      .setTimestamp();

    const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const existing = recent?.find((m) => m.author.id === this.client.user.id && m.embeds[0]?.title === '🔐 Carry Tavern Security');
    if (existing) await existing.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    else await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  async onMessage(message, edited = false) {
    if (!message.guild || message.guild.id !== this.config.discord.guildId) return;
    if (message.author.bot) return;

    const honeypotId = this.channels.get('honeypot');
    if (message.channelId === honeypotId) {
      await this.handleHoneypot(message);
      return;
    }

    if (await this.isTrustedActor(message.author.id, message.guild)) return;

    const signals = this.scoreMessage(message);
    let aiResult = null;
    const hasImage = [...message.attachments.values()].some((a) => (a.contentType || '').startsWith('image/'));
    const shouldUseAi = this.ai.available && (
      signals.score >= this.config.ai.minRuleScore ||
      hasImage ||
      this.config.language.enabled
    );

    if (shouldUseAi) {
      aiResult = await this.ai.analyzeMessage(message, signals);
      if (aiResult) await this.logAiAnalysis(message, signals, aiResult);
    }

    if (aiResult?.nsfw) {
      await message.delete().catch(() => {});
      await this.incident('nsfw', 'medium', {
        actorId: message.author.id,
        channelId: message.channelId,
        details: `AI classified content as NSFW (${Math.round(aiResult.confidence * 100)}% confidence).`,
      }, 'nsfw-auto-delete');
      return;
    }

    if (this.config.language.enabled && aiResult && aiResult.confidence >= 0.9) {
      const language = aiResult.language.toLowerCase();
      if (language !== 'unknown' && !this.config.language.allowed.includes(language)) {
        await message.delete().catch(() => {});
        await this.incident('language-policy', 'low', {
          actorId: message.author.id,
          channelId: message.channelId,
          details: `Detected language: ${language}. Allowed: ${this.config.language.allowed.join(', ')}.`,
        }, 'language-restrictor');
        return;
      }
    }

    let total = signals.score;
    if (aiResult && aiResult.confidence >= 0.75) {
      total += Math.min(3, Math.floor((aiResult.risk * aiResult.confidence) / 3));
    }

    const coordinated = signals.coordinated || Boolean(aiResult?.coordinated && aiResult.confidence >= 0.8);
    const hardMalicious = signals.hardMalicious;

    if (total >= this.config.scores.ban && (coordinated || hardMalicious)) {
      await message.delete().catch(() => {});
      await this.incident('malicious-message', 'critical', {
        actorId: message.author.id,
        channelId: message.channelId,
        details: `Score ${total}. ${signals.reasons.join('; ')}`,
      }, 'spam-detection');
      await message.member?.ban({ reason: `Security engine: malicious/coordinated payload score ${total}` }).catch(() => {});
      return;
    }

    if (total >= this.config.scores.timeout) {
      await message.delete().catch(() => {});
      const mins = this.config.spamQuarantineMinutes;
      await message.member?.timeout(mins * 60_000, `Security engine: behaviour score ${total}`).catch(() => {});
      await this.incident('spam-quarantine', 'high', {
        actorId: message.author.id,
        channelId: message.channelId,
        details: `Score ${total}; timeout ${mins}m. ${signals.reasons.join('; ')}`,
      }, 'spam-detection');
      return;
    }

    if (total >= this.config.scores.delete) {
      await message.delete().catch(() => {});
      await this.incident('spam-delete', 'medium', {
        actorId: message.author.id,
        channelId: message.channelId,
        details: `Score ${total}. ${signals.reasons.join('; ')}`,
      }, 'spam-detection');
    } else if (edited && hardMalicious) {
      await message.delete().catch(() => {});
    }
  }

  scoreMessage(message) {
    const now = Date.now();
    const userId = message.author.id;
    const normalized = normalizeMessage(message.content || '');
    const urls = extractUrls(message.content || '');
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    const reasons = [];
    let score = 0;
    let hardMalicious = false;

    const history = this.messageWindows.get(userId) || [];
    history.push({ ts: now, normalized, channelId: message.channelId, mentions });
    const recent = history.filter((x) => now - x.ts <= 15_000);
    this.messageWindows.set(userId, recent);

    const in8s = recent.filter((x) => now - x.ts <= 8_000);
    if (in8s.length >= 6) {
      score += in8s.length >= 11 ? 3 : 1;
      reasons.push(`${in8s.length} messages/8s`);
    }

    if (normalized.length >= 3) {
      const duplicateCount = recent.filter((x) => x.normalized === normalized).length;
      if (duplicateCount >= 3) {
        score += duplicateCount >= 5 ? 5 : 3;
        reasons.push(`${duplicateCount} duplicate payloads`);
      }
    }

    const uniqueChannels = new Set(recent.map((x) => x.channelId)).size;
    if (uniqueChannels >= 4) {
      score += 2;
      reasons.push(`channel hopping (${uniqueChannels})`);
    }

    if (mentions >= 6) {
      score += mentions >= 12 ? 6 : 4;
      reasons.push(`${mentions} mentions`);
      hardMalicious = mentions >= 12;
    }

    if (message.mentions.everyone) {
      score += 4;
      reasons.push('@everyone/@here mention');
    }

    if (urls.length >= 3) {
      score += 2;
      reasons.push(`${urls.length} URLs`);
    }

    const linkRisk = scoreLinks(message.content || '', urls);
    score += linkRisk.score;
    reasons.push(...linkRisk.reasons);
    if (linkRisk.hard) hardMalicious = true;

    const lower = (message.content || '').toLowerCase();
    const scamTerm = SCAM_TERMS.find((term) => lower.includes(term));
    if (scamTerm && urls.length) {
      score += 4;
      reasons.push(`scam phrase: ${scamTerm}`);
      hardMalicious = true;
    }

    const deterministicNsfw = NSFW_TERMS.some((term) => lower.includes(term));
    if (deterministicNsfw) {
      score += 4;
      reasons.push('known NSFW domain/phrase');
    }

    const ageDays = (now - message.author.createdTimestamp) / 86_400_000;
    if (ageDays < 1 && score >= 3) {
      score += 1;
      reasons.push('very new account + other risk');
    }

    let coordinated = false;
    if (normalized.length >= 8) {
      const cluster = this.payloadClusters.get(normalized) || [];
      cluster.push({ userId, ts: now, channelId: message.channelId });
      const active = cluster.filter((x) => now - x.ts <= 60_000);
      this.payloadClusters.set(normalized, active);
      const users = new Set(active.map((x) => x.userId));
      if (users.size >= 3) {
        coordinated = true;
        const add = users.size >= 8 ? 7 : 4;
        score += add;
        reasons.push(`coordinated payload across ${users.size} accounts`);
        hardMalicious = users.size >= 8 || hardMalicious;
      }
    }

    return { score, reasons, coordinated, hardMalicious, deterministicNsfw, urls: urls.length, mentions };
  }

  async handleHoneypot(message) {
    const guild = message.guild;
    if (await this.isTrustedActor(message.author.id, guild)) {
      await this.log('security-audit', `Honeypot message ignored for trusted actor <@${message.author.id}>.`);
      return;
    }

    await message.delete().catch(() => {});
    const incident = await this.incident('honeypot-trigger', 'critical', {
      actorId: message.author.id,
      channelId: message.channelId,
      details: 'User sent a message in the security honeypot.',
    }, 'incident-reports');

    if (this.config.honeypotAutoBan) {
      await message.member?.ban({ reason: `${incident.id}: honeypot trigger` }).catch(async () => {
        await message.member?.timeout(24 * 60 * 60_000, `${incident.id}: honeypot fallback`).catch(() => {});
      });
    }
  }

  async onChannelCreate(channel) {
    if (!channel.guild || channel.guild.id !== this.config.discord.guildId) return;
    if (this.channels.has(channel.name)) return;
    const entry = await this.findAudit(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    if (!entry) return;
    if (await this.isTrustedActor(entry.executorId, channel.guild)) return;

    await this.recordDangerousAction(channel.guild, entry.executorId, 'channel-create', `#${channel.name}`);
    await channel.delete('Unauthorized channel creation').catch(() => {});
  }

  async onChannelDelete(channel) {
    if (!channel.guild || channel.guild.id !== this.config.discord.guildId) return;
    const entry = await this.findAudit(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    if (!entry || entry.executorId === this.client.user.id) return;
    const trusted = await this.isTrustedActor(entry.executorId, channel.guild);
    if (trusted && this.store.state.maintenance) return;

    await this.recordDangerousAction(channel.guild, entry.executorId, 'channel-delete', `#${channel.name}`);
    if (!trusted && this.config.restoreDeletedChannels) await this.restoreDeletedChannel(channel.guild, channel.id);
  }

  async onChannelUpdate(oldChannel, newChannel) {
    if (!newChannel.guild || newChannel.guild.id !== this.config.discord.guildId) return;
    if (oldChannel.name === newChannel.name && overwriteFingerprint(oldChannel) === overwriteFingerprint(newChannel)) return;

    const types = [AuditLogEvent.ChannelUpdate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete];
    const entry = await this.findAnyAudit(newChannel.guild, types, newChannel.id);
    if (!entry || entry.executorId === this.client.user.id) return;
    if (await this.isTrustedActor(entry.executorId, newChannel.guild)) return;

    await this.recordDangerousAction(newChannel.guild, entry.executorId, 'channel-update', `#${newChannel.name}`);

    if (overwriteFingerprint(oldChannel) !== overwriteFingerprint(newChannel)) {
      const oldOverwrites = [...oldChannel.permissionOverwrites.cache.values()].map((o) => ({
        id: o.id,
        type: o.type,
        allow: o.allow.bitfield,
        deny: o.deny.bitfield,
      }));
      await newChannel.permissionOverwrites.set(oldOverwrites, 'Reverting unauthorized permission overwrite change').catch(() => {});
    }
  }

  async onRoleCreate(role) {
    if (role.guild.id !== this.config.discord.guildId || role.managed) return;
    const entry = await this.findAudit(role.guild, AuditLogEvent.RoleCreate, role.id);
    if (!entry) return;
    if (await this.isTrustedActor(entry.executorId, role.guild)) return;

    await this.recordDangerousAction(role.guild, entry.executorId, 'role-create', `@${role.name}`);
    if (hasDangerousPermissions(role.permissions)) {
      await role.delete('Unauthorized dangerous role creation').catch(() => {});
    }
  }

  async onRoleDelete(role) {
    if (role.guild.id !== this.config.discord.guildId || role.managed) return;
    const entry = await this.findAudit(role.guild, AuditLogEvent.RoleDelete, role.id);
    if (!entry || entry.executorId === this.client.user.id) return;
    const trusted = await this.isTrustedActor(entry.executorId, role.guild);
    if (trusted && this.store.state.maintenance) return;

    await this.recordDangerousAction(role.guild, entry.executorId, 'role-delete', `@${role.name}`);
    if (!trusted && this.config.restoreDeletedRoles) await this.restoreDeletedRole(role.guild, role.id);
  }

  async onRoleUpdate(oldRole, newRole) {
    if (newRole.guild.id !== this.config.discord.guildId || newRole.managed) return;
    const addedDanger = DANGEROUS_PERMISSIONS.some((p) => !oldRole.permissions.has(p) && newRole.permissions.has(p));
    if (!addedDanger) return;

    const entry = await this.findAudit(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    if (!entry || entry.executorId === this.client.user.id) return;
    if (await this.isTrustedActor(entry.executorId, newRole.guild)) return;

    await newRole.setPermissions(oldRole.permissions, 'Reverting unauthorized dangerous permission grant').catch(() => {});
    await this.incident('privilege-escalation', 'critical', {
      actorId: entry.executorId,
      targetId: newRole.id,
      details: `Unauthorized dangerous permissions added to @${newRole.name}; reverted.`,
    }, 'administrator-privilege-abuse');
    await this.containActor(newRole.guild, entry.executorId, 'Unauthorized privilege escalation');
  }

  async onMemberUpdate(oldMember, newMember) {
    if (newMember.guild.id !== this.config.discord.guildId) return;
    const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const dangerous = addedRoles.filter((r) => hasDangerousPermissions(r.permissions));
    if (!dangerous.size) return;

    const entry = await this.findAudit(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
    if (!entry || entry.executorId === this.client.user.id) return;
    if (await this.isTrustedActor(entry.executorId, newMember.guild)) return;

    await newMember.roles.remove([...dangerous.values()], 'Reverting unauthorized dangerous role assignment').catch(() => {});
    await this.incident('dangerous-role-assignment', 'critical', {
      actorId: entry.executorId,
      targetId: newMember.id,
      details: `Removed unauthorized dangerous roles: ${[...dangerous.values()].map((r) => r.name).join(', ')}`,
    }, 'administrator-privilege-abuse');
    await this.containActor(newMember.guild, entry.executorId, 'Unauthorized dangerous role assignment');
  }

  async onMemberAdd(member) {
    if (member.guild.id !== this.config.discord.guildId) return;

    if (!member.user.bot) {
      if (this.config.logMemberJoins) await this.log('security-audit', `Member joined: <@${member.id}>. No raid score is assigned from join volume.`);
      return;
    }

    const entry = await this.findAudit(member.guild, AuditLogEvent.BotAdd, member.id, 15_000);
    if (!entry) return;
    if (await this.isTrustedActor(entry.executorId, member.guild)) return;

    await this.incident('unauthorized-bot-add', 'critical', {
      actorId: entry.executorId,
      targetId: member.id,
      details: `Unauthorized bot added: ${member.user.tag}`,
    }, 'bot-security');
    await member.ban({ reason: 'Unauthorized bot addition' }).catch(() => member.kick('Unauthorized bot addition').catch(() => {}));
    await this.containActor(member.guild, entry.executorId, 'Unauthorized bot addition');
  }

  async onMemberRemove(member) {
    if (member.guild.id !== this.config.discord.guildId) return;
    const entry = await this.findAudit(member.guild, AuditLogEvent.MemberKick, member.id, 5_000);
    if (!entry || entry.executorId === this.client.user.id) return;
    await this.recordDangerousAction(member.guild, entry.executorId, 'member-kick', member.user.tag);
  }

  async onBanAdd(ban) {
    if (ban.guild.id !== this.config.discord.guildId) return;
    const entry = await this.findAudit(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, 7_000);
    if (!entry || entry.executorId === this.client.user.id) return;
    await this.recordDangerousAction(ban.guild, entry.executorId, 'member-ban', ban.user.tag);
  }

  async onWebhooksUpdate(channel) {
    if (channel.guild.id !== this.config.discord.guildId) return;
    const entry = await this.findAnyAudit(channel.guild, [
      AuditLogEvent.WebhookCreate,
      AuditLogEvent.WebhookUpdate,
      AuditLogEvent.WebhookDelete,
    ], null, 6_000);
    if (!entry || entry.executorId === this.client.user.id) return;
    if (await this.isTrustedActor(entry.executorId, channel.guild)) return;

    await this.incident('webhook-tampering', 'critical', {
      actorId: entry.executorId,
      channelId: channel.id,
      targetId: entry.targetId,
      details: `Unauthorized webhook action (${entry.action}).`,
    }, 'webhook-security');

    if (entry.action === AuditLogEvent.WebhookCreate && entry.targetId) {
      const hooks = await channel.fetchWebhooks().catch(() => null);
      await hooks?.get(entry.targetId)?.delete('Unauthorized webhook').catch(() => {});
    }
    await this.containActor(channel.guild, entry.executorId, 'Unauthorized webhook tampering');
  }

  async onGuildUpdate(oldGuild, newGuild) {
    if (newGuild.id !== this.config.discord.guildId) return;
    if (oldGuild.name === newGuild.name && oldGuild.verificationLevel === newGuild.verificationLevel) return;
    const entry = await this.findAudit(newGuild, AuditLogEvent.GuildUpdate, newGuild.id, 8_000);
    if (!entry || entry.executorId === this.client.user.id) return;
    if (await this.isTrustedActor(entry.executorId, newGuild)) return;

    await this.incident('server-settings-tampering', 'critical', {
      actorId: entry.executorId,
      details: 'Unauthorized server settings update detected.',
    }, 'nuke-detection');
    await this.containActor(newGuild, entry.executorId, 'Unauthorized server settings update');
  }

  async recordDangerousAction(guild, actorId, kind, target) {
    if (!actorId || this.isSecurityOwner(actorId, guild) || actorId === this.client.user.id) return;
    if (this.store.state.maintenance && await this.isTrustedActor(actorId, guild)) return;

    const now = Date.now();
    const window = (this.dangerWindows.get(actorId) || []).filter((x) => now - x.ts <= 30_000);
    window.push({ ts: now, kind, target });
    this.dangerWindows.set(actorId, window);

    const trusted = await this.isTrustedActor(actorId, guild);
    const destructive = window.filter((x) => ['channel-delete', 'role-delete', 'member-ban', 'member-kick', 'channel-create', 'role-create'].includes(x.kind));
    const threshold = trusted ? 6 : 2;

    await this.incident('dangerous-action', destructive.length >= threshold ? 'critical' : 'high', {
      actorId,
      details: `${kind}: ${target}. ${destructive.length}/${threshold} destructive actions in 30s.`,
    }, 'nuke-detection');

    if (destructive.length >= threshold) {
      await this.containActor(guild, actorId, `Anti-nuke threshold reached: ${destructive.length}/${threshold}`);
      if (this.config.autoLockdownOnNuke && !this.store.state.lockdown.active) {
        await this.lockdown(guild, `Automatic anti-nuke containment for actor ${actorId}`, this.client.user.id);
      }
    }
  }

  async containActor(guild, actorId, reason) {
    if (!actorId || this.isSecurityOwner(actorId, guild) || actorId === this.client.user.id) return;
    let member;
    try {
      member = guild.members.cache.get(actorId) || await guild.members.fetch(actorId);
    } catch {
      return;
    }

    const dangerousRoles = member.roles.cache.filter((r) => r.id !== guild.roles.everyone.id && r.editable && hasDangerousPermissions(r.permissions));
    if (dangerousRoles.size) {
      await member.roles.remove([...dangerousRoles.values()], `Security containment: ${reason}`).catch(() => {});
    }

    const trusted = await this.isTrustedActor(actorId, guild);
    await member.timeout(24 * 60 * 60_000, `Security containment: ${reason}`).catch(() => {});

    if (!trusted && member.bannable) {
      await member.ban({ reason: `Security containment: ${reason}` }).catch(() => {});
    }

    await this.incident('actor-contained', 'critical', {
      actorId,
      details: `${trusted ? 'Trusted actor quarantined (dangerous roles stripped + timeout)' : 'Untrusted actor contained/banned'}: ${reason}`,
    }, 'incident-reports');
  }

  async lockdown(guild, reason, by) {
    if (this.store.state.lockdown.active) return false;
    const previous = {};

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased?.() || channel.isThread?.()) continue;
      if (this.channels.has(channel.name)) continue;
      if (!channel.permissionOverwrites) continue;

      const overwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      previous[channel.id] = snapshotLockdownOverwrite(overwrite);
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false,
      }, { reason: `Security lockdown: ${reason}` }).catch(() => {});
    }

    this.store.setLockdown({
      active: true,
      startedAt: new Date().toISOString(),
      reason,
      by: String(by || 'system'),
      overwrites: previous,
    });

    await this.incident('server-lockdown', 'critical', { actorId: by, details: reason }, 'incident-reports');
    await this.updateOverview(guild);
    return true;
  }

  async unlock(guild, by) {
    if (!this.store.state.lockdown.active) return false;
    const previous = this.store.state.lockdown.overwrites || {};

    for (const [channelId, state] of Object.entries(previous)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel?.permissionOverwrites) continue;
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: state.SendMessages,
        AddReactions: state.AddReactions,
        CreatePublicThreads: state.CreatePublicThreads,
        CreatePrivateThreads: state.CreatePrivateThreads,
        SendMessagesInThreads: state.SendMessagesInThreads,
      }, { reason: 'Security lockdown released' }).catch(() => {});
    }

    this.store.setLockdown({ active: false, startedAt: null, reason: null, by: null, overwrites: {} });
    await this.incident('server-unlock', 'medium', { actorId: by, details: 'Server lockdown released.' }, 'security-audit');
    await this.updateOverview(guild);
    return true;
  }

  async snapshotGuild(guild, reason = 'manual') {
    if (this.snapshotBusy) return null;
    this.snapshotBusy = true;
    try {
      await guild.members.fetch().catch(() => null);
      const snapshot = {
        createdAt: new Date().toISOString(),
        reason,
        guild: { id: guild.id, name: guild.name, verificationLevel: guild.verificationLevel },
        channels: [...guild.channels.cache.values()]
          .filter((c) => !c.isThread?.())
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            parentId: c.parentId,
            position: c.rawPosition ?? c.position ?? 0,
            topic: 'topic' in c ? c.topic : null,
            nsfw: 'nsfw' in c ? Boolean(c.nsfw) : false,
            rateLimitPerUser: 'rateLimitPerUser' in c ? c.rateLimitPerUser : 0,
            bitrate: 'bitrate' in c ? c.bitrate : null,
            userLimit: 'userLimit' in c ? c.userLimit : null,
            permissionOverwrites: c.permissionOverwrites
              ? [...c.permissionOverwrites.cache.values()].map((o) => ({
                  id: o.id,
                  type: o.type,
                  allow: o.allow.bitfield.toString(),
                  deny: o.deny.bitfield.toString(),
                }))
              : [],
          })),
        roles: [...guild.roles.cache.values()]
          .filter((r) => r.id !== guild.roles.everyone.id && !r.managed)
          .map((r) => ({
            id: r.id,
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            position: r.position,
            permissions: r.permissions.bitfield.toString(),
            mentionable: r.mentionable,
            memberIds: [...r.members.keys()],
          })),
      };
      this.store.setSnapshot(snapshot);
      if (reason !== 'periodic') await this.log('security-audit', `📸 Security snapshot saved (${reason}).`);
      return snapshot;
    } finally {
      this.snapshotBusy = false;
    }
  }

  async restoreDeletedChannel(guild, oldId) {
    const data = this.store.state.snapshot?.channels?.find((c) => c.id === oldId);
    if (!data) return;
    if ([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(data.type)) return;

    const options = {
      name: data.name,
      type: data.type,
      permissionOverwrites: data.permissionOverwrites.map((o) => ({
        id: o.id,
        type: o.type,
        allow: BigInt(o.allow),
        deny: BigInt(o.deny),
      })),
      reason: `Anti-nuke restore of deleted channel ${oldId}`,
    };

    if (data.parentId && guild.channels.cache.has(data.parentId)) options.parent = data.parentId;
    if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(data.type)) {
      if (data.topic != null) options.topic = data.topic;
      options.nsfw = data.nsfw;
      if (data.rateLimitPerUser != null) options.rateLimitPerUser = data.rateLimitPerUser;
    }
    if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(data.type)) {
      if (data.bitrate) options.bitrate = data.bitrate;
      if (data.userLimit != null) options.userLimit = data.userLimit;
    }

    const restored = await guild.channels.create(options).catch(() => null);
    if (restored && Number.isFinite(data.position)) await restored.setPosition(data.position).catch(() => {});
    if (restored) await this.log('nuke-detection', `♻️ Restored deleted channel **${data.name}** as <#${restored.id}>.`);
  }

  async restoreDeletedRole(guild, oldId) {
    const data = this.store.state.snapshot?.roles?.find((r) => r.id === oldId);
    if (!data) return;

    const restored = await guild.roles.create({
      name: data.name,
      color: data.color,
      hoist: data.hoist,
      permissions: BigInt(data.permissions),
      mentionable: data.mentionable,
      reason: `Anti-nuke restore of deleted role ${oldId}`,
    }).catch(() => null);
    if (!restored) return;

    await restored.setPosition(data.position).catch(() => {});
    const memberIds = data.memberIds || [];
    for (const batch of chunk(memberIds, 10)) {
      await Promise.allSettled(batch.map(async (id) => {
        const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
        if (member && restored.editable) await member.roles.add(restored, 'Restoring deleted role assignment').catch(() => {});
      }));
    }
    await this.log('nuke-detection', `♻️ Restored deleted role **${data.name}** as <@&${restored.id}> (${memberIds.length} saved assignments attempted).`);
  }

  async findAudit(guild, type, targetId = null, maxAge = 8_000) {
    try {
      const logs = await guild.fetchAuditLogs({ type, limit: 8 });
      const now = Date.now();
      for (const entry of logs.entries.values()) {
        if (now - entry.createdTimestamp > maxAge) continue;
        if (targetId && String(entry.targetId) !== String(targetId)) continue;
        const key = `${entry.id}:${type}`;
        if (this.auditSeen.has(key)) continue;
        this.auditSeen.set(key, now);
        return entry;
      }
    } catch (error) {
      console.error('[security-audit]', type, error.message);
    }
    return null;
  }

  async findAnyAudit(guild, types, targetId = null, maxAge = 8_000) {
    for (const type of types) {
      const entry = await this.findAudit(guild, type, targetId, maxAge);
      if (entry) return entry;
    }
    return null;
  }

  async logAiAnalysis(message, signals, aiResult) {
    const embed = new EmbedBuilder()
      .setTitle('🧠 AI Security Analysis')
      .setDescription(aiResult.reason || 'No explanation returned.')
      .addFields(
        { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: false },
        { name: 'Rule score', value: String(signals.score), inline: true },
        { name: 'AI risk', value: `${aiResult.risk}/10`, inline: true },
        { name: 'Confidence', value: `${Math.round(aiResult.confidence * 100)}%`, inline: true },
        { name: 'Labels', value: aiResult.labels.join(', ') || 'none', inline: false },
      )
      .setFooter({ text: 'AI is advisory only; deterministic code owns enforcement.' })
      .setTimestamp();
    await this.log('ai-security-analysis', { embeds: [embed] });
  }

  async incident(type, severity, data = {}, channelName = 'incident-reports') {
    const incident = this.store.nextIncident(type, severity, data);
    const embed = new EmbedBuilder()
      .setTitle(`${severityEmoji(severity)} ${incident.id} — ${type}`)
      .setDescription(String(data.details || 'Security event recorded.').slice(0, 4000))
      .addFields(
        ...(data.actorId ? [{ name: 'Actor', value: `<@${data.actorId}> \`${data.actorId}\``, inline: true }] : []),
        ...(data.targetId ? [{ name: 'Target', value: `\`${data.targetId}\``, inline: true }] : []),
        ...(data.channelId ? [{ name: 'Channel', value: `<#${data.channelId}>`, inline: true }] : []),
        { name: 'Severity', value: severity.toUpperCase(), inline: true },
      )
      .setTimestamp(new Date(incident.createdAt));

    await this.log(channelName, { embeds: [embed] });
    if (channelName !== 'incident-reports' && severity === 'critical') {
      await this.log('incident-reports', { embeds: [embed] });
    }
    return incident;
  }

  async log(channelName, payload) {
    const channel = this.getChannel(channelName);
    if (!channel?.isTextBased?.()) return null;
    const body = typeof payload === 'string' ? { content: payload } : payload;
    return channel.send({ ...body, allowedMentions: { parse: [] } }).catch(() => null);
  }

  getChannel(name) {
    const id = this.channels.get(name);
    return id ? this.client.channels.cache.get(id) : null;
  }

  cleanupRuntimeMaps() {
    const now = Date.now();
    for (const [key, items] of this.messageWindows) {
      const active = items.filter((x) => now - x.ts <= 15_000);
      if (active.length) this.messageWindows.set(key, active);
      else this.messageWindows.delete(key);
    }
    for (const [key, items] of this.payloadClusters) {
      const active = items.filter((x) => now - x.ts <= 60_000);
      if (active.length) this.payloadClusters.set(key, active);
      else this.payloadClusters.delete(key);
    }
    for (const [key, ts] of this.auditSeen) {
      if (now - ts > 60_000) this.auditSeen.delete(key);
    }
  }
}

function hasDangerousPermissions(permissions) {
  return DANGEROUS_PERMISSIONS.some((p) => permissions.has(p));
}

function normalizeMessage(content) {
  return content
    .toLowerCase()
    .replace(/<@!?\d+>/g, '@user')
    .replace(/<@&\d+>/g, '@role')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function extractUrls(content) {
  return content.match(/https?:\/\/[^\s<>()]+/gi) || [];
}

function scoreLinks(content, urls) {
  let score = 0;
  let hard = false;
  const reasons = [];

  for (const raw of urls) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (host.startsWith('xn--') || /[^\x00-\x7F]/.test(host)) {
        score += 4;
        hard = true;
        reasons.push('IDN/punycode lookalike link');
      }
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        score += 3;
        reasons.push('raw-IP URL');
      }
      if (SHORTENER_HOSTS.has(host)) {
        score += 1;
        reasons.push('URL shortener');
      }
      if (host.includes('discord') && !['discord.com', 'discord.gg', 'cdn.discordapp.com', 'media.discordapp.net'].includes(host)) {
        score += 5;
        hard = true;
        reasons.push('Discord lookalike domain');
      }
    } catch {
      score += 1;
      reasons.push('malformed URL');
    }
  }

  const lower = content.toLowerCase();
  if (/discord(?:app)?\.(?:gift|nitro|claim)|steamcommun[i1]ty|d[i1]scord-gift/.test(lower)) {
    score += 5;
    hard = true;
    reasons.push('known phishing-style domain pattern');
  }

  return { score, hard, reasons };
}

function overwriteFingerprint(channel) {
  if (!channel.permissionOverwrites) return '';
  return [...channel.permissionOverwrites.cache.values()]
    .map((o) => `${o.id}:${o.type}:${o.allow.bitfield}:${o.deny.bitfield}`)
    .sort()
    .join('|');
}

function snapshotLockdownOverwrite(overwrite) {
  const names = ['SendMessages', 'AddReactions', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'];
  const result = {};
  for (const name of names) {
    const bit = PermissionFlagsBits[name];
    if (!overwrite) result[name] = null;
    else if (overwrite.allow.has(bit)) result[name] = true;
    else if (overwrite.deny.has(bit)) result[name] = false;
    else result[name] = null;
  }
  return result;
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

function severityEmoji(severity) {
  return ({ low: 'ℹ️', medium: '⚠️', high: '🟠', critical: '🚨' })[severity] || '⚠️';
}

module.exports = { SecurityEngine, hasDangerousPermissions };
