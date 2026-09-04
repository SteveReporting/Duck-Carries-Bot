const {
  EmbedBuilder,
} = require("discord.js");

const {
  applyLegacyEnvironment,
  getGuildConfig,
  saveGuildConfig,
} = require("./guildConfig");
const { publishOperationsHub } = require("../commands/panel");
const { ensureLiveCarryBoard } = require("./liveCarryBoard");
const { ensureSupportTicketSystem } = require("./supportTicketSystem");
const { refreshStaffOperationsHub } = require("./staffOperationsHub");
const { ensureTreasuryStockPanel } = require("./treasuryStock");
const {
  saveSettings: saveTreasurySettings,
  treasuryPanelComponents,
  treasuryPanelEmbed,
} = require("../treasury/treasury");
const { goldDonationButtonRow } = require("../treasury/goldDonations");

const TREASURY_PANEL_FOOTER = "The Carry Tavern • Treasury";
const ENV_KEYS = [
  "GUILD_ID",
  "CARRY_QUEUE_CHANNEL_ID",
  "QUEUE_CHANNEL_ID",
  "TICKET_CATEGORY_ID",
  "CARRY_VOICE_CATEGORY_ID",
  "CARRY_WAITING_VC_ID",
  "MOD_LOG_CHANNEL_ID",
  "AI_AUDIT_CHANNEL_ID",
  "CARRIER_ROLE",
  "CARRIER_TEAM_ROLE_ID",
  "CARRY_CLAIM_ROLE_ID",
  "STAFF_BASE_ROLE_ID",
  "PLATFORM_DISCORD_ROLE_MODERATOR",
  "TREASURY_STOCK_CHANNEL_ID",
  "MARKETPLACE_CHANNEL_ID",
  "EVENT_FEED_CHANNEL_ID",
  "ANNOUNCEMENT_CHANNEL_ID",
];

function serverBotNickname(guildName) {
  const suffix = " Bot";
  const raw = String(guildName || "Server").trim() || "Server";
  const maxName = Math.max(1, 32 - suffix.length);
  return `${raw.slice(0, maxName).trim()}${suffix}`.slice(0, 32);
}

async function syncServerNickname(guild) {
  const desired = serverBotNickname(guild?.name);
  const member = guild?.members?.me || await guild?.members?.fetchMe?.().catch(() => null);
  if (!member) return { ok: false, nickname: desired, changed: false, error: "Bot member could not be resolved." };

  if (member.nickname === desired || member.displayName === desired) {
    return { ok: true, nickname: desired, changed: false };
  }

  try {
    await member.setNickname(desired, "Tavern /setup server branding");
    return { ok: true, nickname: desired, changed: true };
  } catch (error) {
    return {
      ok: false,
      nickname: desired,
      changed: false,
      error: error.message || "Discord refused the server nickname update.",
    };
  }
}

function snapshotEnvironment() {
  return new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const [key, value] of snapshot.entries()) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withGuildEnvironment(config, fn) {
  const snapshot = snapshotEnvironment();
  try {
    applyLegacyEnvironment(config);
    if (config?.staff_role_id) {
      process.env.PLATFORM_DISCORD_ROLE_MODERATOR = String(config.staff_role_id);
    }
    return await fn();
  } finally {
    restoreEnvironment(snapshot);
  }
}

async function publishTreasuryConsole(channel) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find((message) =>
    message.author?.id === channel.client.user.id
    && message.embeds?.some((embed) => String(embed.footer?.text || "") === TREASURY_PANEL_FOOTER),
  ) || null;

  const embed = treasuryPanelEmbed()
    .setColor(0xf2b705)
    .setAuthor({
      name: "THE CARRY TAVERN • TREASURY",
      ...(channel.guild.iconURL() ? { iconURL: channel.guild.iconURL({ size: 128 }) } : {}),
    });

  const payload = {
    embeds: [embed],
    components: [
      ...treasuryPanelComponents(),
      goldDonationButtonRow(),
    ],
  };

  if (existing) {
    await existing.edit(payload);
    if (!existing.pinned) await existing.pin("Permanent Tavern Treasury console").catch(() => {});
    return existing;
  }

  const message = await channel.send(payload);
  await message.pin("Permanent Tavern Treasury console").catch(() => {});
  return message;
}

async function configureTreasury(guild, client, config) {
  const channel = config?.treasury_channel_id
    ? await guild.channels.fetch(config.treasury_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased?.()) throw new Error("Treasury channel is missing.");

  const category = channel.parentId
    ? await guild.channels.fetch(channel.parentId).catch(() => null)
    : null;
  if (!category) throw new Error("Treasury category is missing.");
  if (!config.staff_role_id) throw new Error("Tavern Staff role is missing.");
  if (!config.mod_log_channel_id) throw new Error("Tavern log channel is missing.");

  saveTreasurySettings(
    guild.id,
    channel.id,
    category.id,
    config.staff_role_id,
    config.mod_log_channel_id,
  );

  await publishTreasuryConsole(channel);
  await ensureTreasuryStockPanel(client, guild, channel);
  return channel;
}

async function setupSupportForGuild(client, guild, config) {
  return withGuildEnvironment(config, async () => ensureSupportTicketSystem(client));
}

async function finalizeGuildSetup({ guild, client, config: initialConfig }) {
  let config = initialConfig || getGuildConfig(guild.id);
  if (!config) throw new Error("Guild setup configuration was not saved.");

  const identity = await syncServerNickname(guild);
  const ui = [];
  const attempt = async (name, task) => {
    try {
      const result = await task();
      ui.push({ name, ok: true });
      return result;
    } catch (error) {
      console.warn(`[SETUP FINALIZER] ${name}: ${error.message}`);
      ui.push({ name, ok: false, error: error.message });
      return null;
    }
  };

  const support = await attempt("Support Desk + Staff Dashboard", () => setupSupportForGuild(client, guild, config));
  if (support) {
    config = saveGuildConfig(guild.id, {
      support_channel_id: support.publicChannel?.id,
      support_dashboard_channel_id: support.dashboard?.id,
    });
  }

  await attempt("Treasury Console + Stock", () => configureTreasury(guild, client, config));

  const home = config.home_channel_id
    ? await guild.channels.fetch(config.home_channel_id).catch(() => null)
    : null;
  if (home?.isTextBased?.()) {
    await attempt("Tavern Hub Refresh", () => publishOperationsHub(home, { guild, config }));
  }

  await attempt("Live Carry Board Refresh", () => ensureLiveCarryBoard(client, guild));
  await attempt("Staff Operations Refresh", () => refreshStaffOperationsHub(guild));

  return { config, identity, ui };
}

function setupHealthEmbed(guild, result) {
  const failed = result.ui.filter((item) => !item.ok);
  return new EmbedBuilder()
    .setColor(failed.length ? 0xf2b705 : 0x2ecc71)
    .setTitle(failed.length ? "⚠️ Setup verification completed with warnings" : "✅ Setup verification passed")
    .setDescription([
      `Server identity: **${result.identity.nickname}** ${result.identity.ok ? "✅" : "⚠️"}`,
      ...result.ui.map((item) => `${item.ok ? "✅" : "⚠️"} ${item.name}`),
    ].join("\n"));
}

module.exports = {
  TREASURY_PANEL_FOOTER,
  configureTreasury,
  finalizeGuildSetup,
  serverBotNickname,
  setupHealthEmbed,
  syncServerNickname,
  withGuildEnvironment,
};
