"use strict";

const { SentientControlClient, envBoolean } = require("./controlClient");

function envNumber(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeName(value, fallback = "unknown") {
  return String(value || fallback).slice(0, 120);
}

function actorIdFromInteraction(interaction) {
  return String(interaction?.user?.id || interaction?.member?.user?.id || "") || null;
}

function subcommandFromInteraction(interaction) {
  try {
    return interaction?.options?.getSubcommand?.(false) || null;
  } catch {
    return null;
  }
}

function interactionKind(interaction) {
  if (interaction?.isChatInputCommand?.()) return "command";
  if (interaction?.isButton?.()) return "button";
  if (interaction?.isModalSubmit?.()) return "modal";
  if (interaction?.isStringSelectMenu?.()) return "select";
  if (interaction?.isUserContextMenuCommand?.()) return "user_context";
  if (interaction?.isMessageContextMenuCommand?.()) return "message_context";
  return `type_${interaction?.type ?? "unknown"}`;
}

function commandDomain(name) {
  const value = String(name || "").toLowerCase();
  if (/queue|carry|carrier/.test(value)) return "carry";
  if (/treasury|pot|donat/.test(value)) return "treasury";
  if (/market/.test(value)) return "marketplace";
  if (/warn|report|security|moder/.test(value)) return "moderation";
  if (/setup|panel|tavern/.test(value)) return "operations";
  if (/sentient/.test(value)) return "sentient";
  return "discord";
}

class SentientRuntime {
  constructor(client, options = {}) {
    this.discord = client;
    this.control = options.control || new SentientControlClient(options);
    this.captureMessageContent = options.captureMessageContent ?? envBoolean("SENTIENT_CAPTURE_MESSAGE_CONTENT", false);
    this.memberEvents = options.memberEvents ?? envBoolean("SENTIENT_MEMBER_EVENTS_ENABLED", true);
    this.structureEvents = options.structureEvents ?? envBoolean("SENTIENT_STRUCTURE_EVENTS_ENABLED", true);
    this.ingestInteractions = options.ingestInteractions ?? envBoolean("SENTIENT_INGEST_INTERACTIONS", true);
    this.snapshotOnReady = options.snapshotOnReady ?? envBoolean("SENTIENT_SNAPSHOT_ON_READY", true);
    this.autoBootstrap = options.autoBootstrap ?? envBoolean("SENTIENT_AUTO_BOOTSTRAP", false);
    this.defaultGuildMode = String(process.env.SENTIENT_DEFAULT_GUILD_MODE || "full") === "minimal" ? "minimal" : "full";
    this.messageSampleEvery = envNumber("SENTIENT_MESSAGE_EVENT_SAMPLE_EVERY", 25, 1, 10_000);
    this.heartbeatMs = envNumber("SENTIENT_HEARTBEAT_MS", 300_000, 60_000, 3_600_000);
    this.queueLimit = envNumber("SENTIENT_EVENT_QUEUE_LIMIT", 500, 25, 5_000);
    this.queue = [];
    this.processing = false;
    this.closed = false;
    this.messageCounter = 0;
    this.dropped = 0;
    this.attached = false;
    this.heartbeat = null;
    this.listeners = [];
    this.lastWarnAt = 0;
  }

  configured() {
    return this.control.isConfigured();
  }

  status() {
    return {
      ...this.control.configurationState(),
      queueDepth: this.queue.length,
      droppedEvents: this.dropped,
      captureMessageContent: this.captureMessageContent,
      messageSampleEvery: this.messageSampleEvery,
      lastSuccessAt: this.control.lastSuccessAt,
      lastError: this.control.lastError,
    };
  }

  warn(message) {
    const now = Date.now();
    if (now - this.lastWarnAt < 30_000) return;
    this.lastWarnAt = now;
    console.warn(`[SENTIENT BRIDGE] ${message}`);
  }

  on(event, handler) {
    this.discord.on(event, handler);
    this.listeners.push([event, handler]);
  }

  attach() {
    if (this.attached) return this;
    this.attached = true;

    const state = this.control.configurationState();
    if (!state.configured) {
      console.warn(`[SENTIENT BRIDGE] Passive mode: ${state.reason}. Existing Tavern features remain online.`);
    } else {
      console.log(`🧠 SENTIENT bridge armed → ${this.control.baseUrl}`);
    }

    this.on("clientReady", () => void this.onReady());
    if (this.ingestInteractions) this.on("interactionCreate", (interaction) => void this.observeInteraction(interaction));
    this.on("messageCreate", (message) => void this.observeMessage(message));

    if (this.memberEvents) {
      this.on("guildMemberAdd", (member) => void this.observeMember(member, "discord.member.join"));
      this.on("guildMemberRemove", (member) => void this.observeMember(member, "discord.member.leave"));
    }

    if (this.structureEvents) {
      this.on("channelCreate", (channel) => void this.observeStructure("discord.channel.create", channel));
      this.on("channelDelete", (channel) => void this.observeStructure("discord.channel.delete", channel));
      this.on("channelUpdate", (before, after) => void this.observeStructure("discord.channel.update", after, before));
      this.on("roleCreate", (role) => void this.observeStructure("discord.role.create", role));
      this.on("roleDelete", (role) => void this.observeStructure("discord.role.delete", role));
      this.on("roleUpdate", (before, after) => void this.observeStructure("discord.role.update", after, before));
      this.on("guildUpdate", (before, after) => void this.observeStructure("discord.guild.update", after, before));
    }

    this.on("guildCreate", (guild) => void this.onGuildCreate(guild));
    this.on("guildDelete", (guild) => void this.onGuildDelete(guild));

    this.heartbeat = setInterval(() => void this.heartbeatTick(), this.heartbeatMs);
    this.heartbeat.unref?.();

    // When the runtime is attached from the modular clientReady event, READY has
    // already fired. Bootstrap immediately in that case; otherwise the listener
    // above handles the normal pre-login path.
    if (this.discord.isReady?.()) {
      const timer = setTimeout(() => void this.onReady(), 0);
      timer.unref?.();
    }

    return this;
  }

  enqueue(label, fn) {
    if (this.closed || !this.configured()) return false;
    if (this.queue.length >= this.queueLimit) {
      this.dropped += 1;
      this.warn(`event queue full; dropped ${label} (${this.dropped} total)`);
      return false;
    }
    this.queue.push({ label, fn });
    void this.drain();
    return true;
  }

  async drain() {
    if (this.processing || this.closed) return;
    this.processing = true;
    while (this.queue.length && !this.closed) {
      const item = this.queue.shift();
      try {
        await item.fn();
      } catch (error) {
        this.warn(`${item.label} failed: ${error?.message || error}`);
      }
    }
    this.processing = false;
  }

  ingest(guildId, kind, payload = {}, options = {}) {
    if (!guildId) return false;
    return this.enqueue(kind, () => this.control.intelligence("event_ingest", guildId, {
      kind,
      source: options.source || "carry-tavern-bot",
      actorDiscordId: options.actorDiscordId || null,
      payload,
      requiresLanguage: Boolean(options.requiresLanguage),
      consequential: Boolean(options.consequential),
      occurredAt: options.occurredAt || new Date().toISOString(),
    }));
  }

  async onReady() {
    const guilds = [...this.discord.guilds.cache.values()];
    console.log(`🧠 SENTIENT observer ready for ${guilds.length} guild(s).`);
    if (!this.configured()) return;

    for (const guild of guilds) {
      this.ingest(guild.id, "discord.gateway.ready", {
        guildName: safeName(guild.name),
        memberCount: Number(guild.memberCount || 0),
        botUserId: this.discord.user?.id || null,
      });

      if (this.autoBootstrap) {
        this.enqueue("guild.bootstrap", () => this.bootstrapGuild(guild, this.defaultGuildMode));
      }

      if (this.snapshotOnReady) {
        const timer = setTimeout(() => void this.snapshotGuild(guild, "carry-tavern-startup"), 8_000);
        timer.unref?.();
      }
    }

    void this.heartbeatTick();
  }

  async onGuildCreate(guild) {
    this.ingest(guild.id, "discord.guild.joined", {
      guildName: safeName(guild.name),
      memberCount: Number(guild.memberCount || 0),
    });
    if (this.autoBootstrap && this.configured()) {
      this.enqueue("guild.bootstrap", () => this.bootstrapGuild(guild, this.defaultGuildMode));
    }
  }

  async onGuildDelete(guild) {
    if (!guild?.id || !this.configured()) return;
    this.enqueue("guild.remove", () => this.control.guilds("remove", guild.id));
  }

  observeInteraction(interaction) {
    if (!interaction?.guildId || interaction?.user?.bot) return;
    const kind = interactionKind(interaction);
    const command = interaction.commandName || null;
    const subcommand = command ? subcommandFromInteraction(interaction) : null;
    const customId = interaction.customId ? safeName(interaction.customId) : null;
    const domain = commandDomain(command || customId);

    this.ingest(interaction.guildId, `discord.interaction.${kind}`, {
      domain,
      command,
      subcommand,
      customId,
      channelId: interaction.channelId || null,
      locale: interaction.locale || null,
    }, {
      actorDiscordId: actorIdFromInteraction(interaction),
      consequential: ["moderation", "treasury", "operations"].includes(domain),
    });
  }

  observeMessage(message) {
    if (!message?.guildId || message?.author?.bot) return;
    this.messageCounter += 1;
    const isDirectlyRelevant = Boolean(message.mentions?.has?.(this.discord.user)) || message.content?.startsWith?.("/");
    if (!isDirectlyRelevant && this.messageCounter % this.messageSampleEvery !== 0) return;

    const mentionIds = [...(message.mentions?.users?.keys?.() || [])]
      .filter((id) => id !== this.discord.user?.id)
      .slice(0, 8);

    const payload = {
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      attachmentCount: Number(message.attachments?.size || 0),
      mentionIds,
      sampled: !isDirectlyRelevant,
      ...(this.captureMessageContent ? { content: String(message.content || "").slice(0, 500) } : {}),
    };

    this.ingest(message.guildId, "discord.message.observed", payload, {
      actorDiscordId: message.author.id,
      requiresLanguage: this.captureMessageContent && isDirectlyRelevant,
    });

    for (const mentionedId of mentionIds.slice(0, 3)) {
      this.enqueue("graph.touch", () => this.control.intelligence("graph_touch", message.guildId, {
        fromType: "member",
        fromKey: message.author.id,
        relation: "mentioned",
        toType: "member",
        toKey: mentionedId,
        weight: 1,
        metadata: { channelId: message.channelId },
      }));
    }
  }

  observeMember(member, kind) {
    const guild = member?.guild;
    if (!guild?.id) return;
    this.ingest(guild.id, kind, {
      memberId: member.id,
      username: safeName(member.user?.username),
      accountCreatedAt: member.user?.createdAt?.toISOString?.() || null,
      memberCount: Number(guild.memberCount || 0),
    }, { actorDiscordId: member.id });
  }

  observeStructure(kind, entity, previous = null) {
    const guildId = entity?.guild?.id || entity?.guildId || previous?.guild?.id || previous?.guildId;
    if (!guildId) return;
    this.ingest(guildId, kind, {
      id: entity?.id || previous?.id || null,
      name: safeName(entity?.name || previous?.name),
      type: entity?.type ?? previous?.type ?? null,
      previousName: previous?.name && previous.name !== entity?.name ? safeName(previous.name) : null,
    }, { consequential: /delete|update/.test(kind) });
  }

  buildSnapshot(guild) {
    const channels = [...guild.channels.cache.values()].map((channel) => ({
      id: channel.id,
      name: safeName(channel.name),
      type: channel.type,
      parentId: channel.parentId || null,
      position: Number(channel.rawPosition ?? channel.position ?? 0),
    }));
    const roles = [...guild.roles.cache.values()].map((role) => ({
      id: role.id,
      name: safeName(role.name),
      position: Number(role.position || 0),
      managed: Boolean(role.managed),
    }));

    return {
      guild: {
        id: guild.id,
        name: safeName(guild.name),
        memberCount: Number(guild.memberCount || 0),
        ownerId: guild.ownerId || null,
        premiumTier: guild.premiumTier ?? null,
      },
      channels,
      roles,
      capturedAt: new Date().toISOString(),
      source: "carry-tavern-bot",
    };
  }

  async snapshotGuild(guild, label = "carry-tavern") {
    if (!guild?.id || !this.configured()) return null;
    const snapshot = this.buildSnapshot(guild);
    return this.control.intelligence("snapshot_create", guild.id, {
      snapshotType: "observed",
      label,
      snapshot,
      createdByDiscordId: this.discord.user?.id || null,
    });
  }

  async bootstrapGuild(guild, mode = this.defaultGuildMode) {
    if (!guild?.id) throw new Error("Guild is required for SENTIENT bootstrap.");
    return this.control.guilds("apply", guild.id, { mode: mode === "minimal" ? "minimal" : "full" });
  }

  async heartbeatTick() {
    if (!this.configured()) return;
    const started = Date.now();
    let status = "healthy";
    let details = {};
    try {
      const health = await this.control.health();
      details = { control: health, botGuilds: this.discord.guilds.cache.size, queueDepth: this.queue.length, dropped: this.dropped };
    } catch (error) {
      status = "degraded";
      details = { error: error?.message || String(error), botGuilds: this.discord.guilds.cache.size };
    }

    try {
      await this.control.intelligence("health_record", null, {
        service: "carry-tavern",
        status,
        latencyMs: Date.now() - started,
        details,
      });
    } catch (error) {
      this.warn(`health heartbeat failed: ${error?.message || error}`);
    }
  }

  async close() {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const [event, handler] of this.listeners) this.discord.off(event, handler);
    this.listeners = [];
    this.queue.length = 0;
  }
}

function createSentientRuntime(client, options = {}) {
  return new SentientRuntime(client, options);
}

module.exports = {
  SentientRuntime,
  createSentientRuntime,
};
