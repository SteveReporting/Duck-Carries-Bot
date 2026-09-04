const db = require("../database/database");

const CONFIG_COLUMNS = [
  "guild_name",
  "setup_complete",
  "setup_by",
  "setup_at",
  "updated_at",
  "home_channel_id",
  "queue_channel_id",
  "completed_channel_id",
  "ticket_category_id",
  "voice_category_id",
  "waiting_voice_id",
  "carrier_role_id",
  "staff_role_id",
  "mod_log_channel_id",
  "operations_channel_id",
  "treasury_channel_id",
  "marketplace_channel_id",
  "support_channel_id",
  "support_dashboard_channel_id",
  "enabled",
];

db.prepare(`
  CREATE TABLE IF NOT EXISTS guild_config(
    guild TEXT PRIMARY KEY,
    guild_name TEXT,
    setup_complete INTEGER NOT NULL DEFAULT 0,
    setup_by TEXT,
    setup_at INTEGER,
    updated_at INTEGER,
    home_channel_id TEXT,
    queue_channel_id TEXT,
    completed_channel_id TEXT,
    ticket_category_id TEXT,
    voice_category_id TEXT,
    waiting_voice_id TEXT,
    carrier_role_id TEXT,
    staff_role_id TEXT,
    mod_log_channel_id TEXT,
    operations_channel_id TEXT,
    treasury_channel_id TEXT,
    marketplace_channel_id TEXT,
    support_channel_id TEXT,
    support_dashboard_channel_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  )
`).run();

// CREATE TABLE IF NOT EXISTS does not add columns to an existing installation,
// so migrate older guild_config databases in-place.
const existingColumns = new Set(
  db.prepare("PRAGMA table_info(guild_config)").all().map((row) => String(row.name)),
);
for (const column of [
  "home_channel_id",
  "voice_category_id",
  "treasury_channel_id",
  "marketplace_channel_id",
  "support_channel_id",
  "support_dashboard_channel_id",
]) {
  if (!existingColumns.has(column)) {
    db.prepare(`ALTER TABLE guild_config ADD COLUMN ${column} TEXT`).run();
  }
}

function normalizeId(value) {
  const text = String(value || "").trim();
  return text || null;
}

function getGuildConfig(guildId) {
  const id = normalizeId(guildId);
  if (!id) return null;
  return db.prepare("SELECT * FROM guild_config WHERE guild=?").get(id) || null;
}

function isGuildConfigured(guildId) {
  const row = getGuildConfig(guildId);
  return Boolean(row && Number(row.setup_complete) === 1 && Number(row.enabled) !== 0);
}

function saveGuildConfig(guildId, patch = {}) {
  const guild = normalizeId(guildId);
  if (!guild) throw new Error("A guild ID is required.");

  const current = getGuildConfig(guild) || {};
  const now = Date.now();
  const next = {
    guild_name: patch.guild_name ?? current.guild_name ?? null,
    setup_complete: patch.setup_complete ?? current.setup_complete ?? 1,
    setup_by: patch.setup_by ?? current.setup_by ?? null,
    setup_at: patch.setup_at ?? current.setup_at ?? now,
    updated_at: now,
    home_channel_id: normalizeId(patch.home_channel_id ?? current.home_channel_id),
    queue_channel_id: normalizeId(patch.queue_channel_id ?? current.queue_channel_id),
    completed_channel_id: normalizeId(patch.completed_channel_id ?? current.completed_channel_id),
    ticket_category_id: normalizeId(patch.ticket_category_id ?? current.ticket_category_id),
    voice_category_id: normalizeId(patch.voice_category_id ?? current.voice_category_id),
    waiting_voice_id: normalizeId(patch.waiting_voice_id ?? current.waiting_voice_id),
    carrier_role_id: normalizeId(patch.carrier_role_id ?? current.carrier_role_id),
    staff_role_id: normalizeId(patch.staff_role_id ?? current.staff_role_id),
    mod_log_channel_id: normalizeId(patch.mod_log_channel_id ?? current.mod_log_channel_id),
    operations_channel_id: normalizeId(patch.operations_channel_id ?? current.operations_channel_id),
    treasury_channel_id: normalizeId(patch.treasury_channel_id ?? current.treasury_channel_id),
    marketplace_channel_id: normalizeId(patch.marketplace_channel_id ?? current.marketplace_channel_id),
    support_channel_id: normalizeId(patch.support_channel_id ?? current.support_channel_id),
    support_dashboard_channel_id: normalizeId(patch.support_dashboard_channel_id ?? current.support_dashboard_channel_id),
    enabled: patch.enabled ?? current.enabled ?? 1,
  };

  const names = CONFIG_COLUMNS.join(",");
  const placeholders = CONFIG_COLUMNS.map(() => "?").join(",");
  const updates = CONFIG_COLUMNS.map((name) => `${name}=excluded.${name}`).join(",");
  db.prepare(`
    INSERT INTO guild_config(guild,${names}) VALUES(?,${placeholders})
    ON CONFLICT(guild) DO UPDATE SET ${updates}
  `).run(guild, ...CONFIG_COLUMNS.map((name) => next[name]));

  // Keep the original queue settings table compatible with older queue modules.
  db.prepare(`
    INSERT INTO settings(guild,queueChannel,requestChannel,completedChannel)
    VALUES(?,?,?,?)
    ON CONFLICT(guild) DO UPDATE SET
      queueChannel=excluded.queueChannel,
      requestChannel=excluded.requestChannel,
      completedChannel=excluded.completedChannel
  `).run(guild, next.queue_channel_id, next.home_channel_id || next.queue_channel_id, next.completed_channel_id);

  return getGuildConfig(guild);
}

function disableGuild(guildId) {
  const id = normalizeId(guildId);
  if (!id) return false;
  const result = db.prepare("UPDATE guild_config SET enabled=0,updated_at=? WHERE guild=?").run(Date.now(), id);
  return result.changes > 0;
}

function listConfiguredGuilds() {
  return db.prepare(`
    SELECT * FROM guild_config
    WHERE setup_complete=1 AND enabled=1
    ORDER BY COALESCE(setup_at,updated_at,0) ASC, guild ASC
  `).all();
}

function listConfiguredGuildIds() {
  return listConfiguredGuilds().map((row) => String(row.guild));
}

function configuredValue(guildId, column, envKey = null) {
  const row = getGuildConfig(guildId);
  const value = row?.[column];
  if (value != null && String(value).trim()) return String(value).trim();
  if (envKey && process.env[envKey] && String(process.env[envKey]).trim()) {
    return String(process.env[envKey]).trim();
  }
  return null;
}

function setEnv(name, value) {
  if (value == null || String(value).trim() === "") delete process.env[name];
  else process.env[name] = String(value).trim();
}

function applyLegacyEnvironment(config) {
  if (!config?.guild) return false;

  // Older background modules still read environment variables. Point them at a
  // configured guild while keeping every stored channel/role value guild-scoped.
  setEnv("GUILD_ID", config.guild);
  setEnv("CARRY_QUEUE_CHANNEL_ID", config.queue_channel_id);
  setEnv("QUEUE_CHANNEL_ID", config.queue_channel_id);
  setEnv("TICKET_CATEGORY_ID", config.ticket_category_id);
  setEnv("CARRY_VOICE_CATEGORY_ID", config.voice_category_id);
  setEnv("CARRY_WAITING_VC_ID", config.waiting_voice_id);
  setEnv("MOD_LOG_CHANNEL_ID", config.mod_log_channel_id);
  setEnv("AI_AUDIT_CHANNEL_ID", config.mod_log_channel_id);
  setEnv("CARRIER_ROLE", config.carrier_role_id);
  setEnv("CARRIER_TEAM_ROLE_ID", config.carrier_role_id);
  setEnv("CARRY_CLAIM_ROLE_ID", config.carrier_role_id);
  setEnv("STAFF_BASE_ROLE_ID", config.staff_role_id);
  setEnv("TREASURY_STOCK_CHANNEL_ID", config.treasury_channel_id);
  setEnv("MARKETPLACE_CHANNEL_ID", config.marketplace_channel_id);

  // Generic servers never inherit Carry Tavern website feed IDs from the host.
  setEnv("EVENT_FEED_CHANNEL_ID", null);
  setEnv("ANNOUNCEMENT_CHANNEL_ID", null);

  return true;
}

module.exports = {
  CONFIG_COLUMNS,
  applyLegacyEnvironment,
  configuredValue,
  disableGuild,
  getGuildConfig,
  isGuildConfigured,
  listConfiguredGuildIds,
  listConfiguredGuilds,
  normalizeId,
  saveGuildConfig,
};
