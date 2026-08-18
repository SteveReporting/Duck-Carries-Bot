const db = require("../database/database");
const { liveConfig } = require("./liveConfig");

db.prepare(`
    CREATE TABLE IF NOT EXISTS sentient_live_state(
        guild TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        err02_used INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    )
`).run();

function ensure(guildId) {
    if (!guildId) return;
    db.prepare(`
        INSERT INTO sentient_live_state(guild, enabled, err02_used, updated_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(guild) DO NOTHING
    `).run(guildId, liveConfig.aiEnabledByDefault ? 1 : 0, Date.now());
}

function get(guildId) {
    ensure(guildId);
    return db.prepare("SELECT * FROM sentient_live_state WHERE guild = ?").get(guildId) || {
        guild: guildId,
        enabled: liveConfig.aiEnabledByDefault ? 1 : 0,
        err02_used: 0,
        updated_at: Date.now(),
    };
}

function setEnabled(guildId, enabled) {
    ensure(guildId);
    db.prepare("UPDATE sentient_live_state SET enabled = ?, updated_at = ? WHERE guild = ?")
        .run(enabled ? 1 : 0, Date.now(), guildId);
    return get(guildId);
}

function markErr02Used(guildId) {
    ensure(guildId);
    const result = db.prepare(`
        UPDATE sentient_live_state
        SET err02_used = 1, updated_at = ?
        WHERE guild = ? AND err02_used = 0
    `).run(Date.now(), guildId);
    return result.changes === 1;
}

module.exports = {
    get,
    setEnabled,
    markErr02Used,
};
