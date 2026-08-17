const db = require("../database/database");

db.prepare(`
    CREATE TABLE IF NOT EXISTS sentient_state(
        guild TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        pace TEXT NOT NULL DEFAULT 'fast',
        started_at INTEGER,
        next_scene INTEGER NOT NULL DEFAULT 0,
        last_scene TEXT,
        flags_json TEXT NOT NULL DEFAULT '{}',
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS sentient_messages(
        message_id TEXT PRIMARY KEY,
        guild TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )
`).run();

db.prepare("CREATE INDEX IF NOT EXISTS sentient_messages_guild_idx ON sentient_messages(guild, created_at)").run();

function now() {
    return Date.now();
}

function safeJson(value, fallback = {}) {
    try {
        return JSON.parse(value || "{}");
    } catch {
        return fallback;
    }
}

function ensureState(guildId) {
    db.prepare(`
        INSERT INTO sentient_state(guild, updated_at)
        VALUES(?, ?)
        ON CONFLICT(guild) DO NOTHING
    `).run(guildId, now());
}

function getState(guildId) {
    ensureState(guildId);
    const row = db.prepare("SELECT * FROM sentient_state WHERE guild = ?").get(guildId);
    return {
        guildId: row.guild,
        active: Boolean(row.active),
        paused: Boolean(row.paused),
        pace: row.pace || "fast",
        startedAt: row.started_at,
        nextScene: Number(row.next_scene || 0),
        lastScene: row.last_scene || null,
        flags: safeJson(row.flags_json),
        snapshot: safeJson(row.snapshot_json),
        updatedAt: row.updated_at,
    };
}

function start(guildId, pace = "fast") {
    ensureState(guildId);
    const timestamp = now();
    db.prepare(`
        UPDATE sentient_state
        SET active = 1,
            paused = 0,
            pace = ?,
            started_at = ?,
            next_scene = 0,
            last_scene = NULL,
            flags_json = '{}',
            snapshot_json = '{}',
            updated_at = ?
        WHERE guild = ?
    `).run(pace, timestamp, timestamp, guildId);
    return getState(guildId);
}

function setPaused(guildId, paused) {
    ensureState(guildId);
    db.prepare("UPDATE sentient_state SET paused = ?, updated_at = ? WHERE guild = ?")
        .run(paused ? 1 : 0, now(), guildId);
    return getState(guildId);
}

function stop(guildId) {
    ensureState(guildId);
    db.prepare(`
        UPDATE sentient_state
        SET active = 0,
            paused = 0,
            updated_at = ?
        WHERE guild = ?
    `).run(now(), guildId);
    return getState(guildId);
}

function advance(guildId, sceneId) {
    ensureState(guildId);
    db.prepare(`
        UPDATE sentient_state
        SET next_scene = next_scene + 1,
            last_scene = ?,
            updated_at = ?
        WHERE guild = ?
    `).run(sceneId, now(), guildId);
    return getState(guildId);
}

function jumpTo(guildId, nextScene, lastScene = null) {
    ensureState(guildId);
    db.prepare(`
        UPDATE sentient_state
        SET next_scene = ?,
            last_scene = ?,
            updated_at = ?
        WHERE guild = ?
    `).run(nextScene, lastScene, now(), guildId);
    return getState(guildId);
}

function setFlag(guildId, key, value) {
    const state = getState(guildId);
    const flags = { ...state.flags, [key]: value };
    db.prepare("UPDATE sentient_state SET flags_json = ?, updated_at = ? WHERE guild = ?")
        .run(JSON.stringify(flags), now(), guildId);
    return flags;
}

function setSnapshot(guildId, snapshot) {
    ensureState(guildId);
    db.prepare("UPDATE sentient_state SET snapshot_json = ?, updated_at = ? WHERE guild = ?")
        .run(JSON.stringify(snapshot || {}), now(), guildId);
}

function clearSnapshot(guildId) {
    setSnapshot(guildId, {});
}

function recordMessage({ messageId, guildId, channelId, kind }) {
    db.prepare(`
        INSERT OR REPLACE INTO sentient_messages(message_id, guild, channel_id, kind, created_at)
        VALUES(?, ?, ?, ?, ?)
    `).run(messageId, guildId, channelId, kind, now());
}

function getRecordedMessage(messageId) {
    return db.prepare("SELECT * FROM sentient_messages WHERE message_id = ?").get(messageId) || null;
}

function isBartenderMessage(messageId) {
    const row = getRecordedMessage(messageId);
    return row?.kind === "bartender";
}

module.exports = {
    getState,
    start,
    setPaused,
    stop,
    advance,
    jumpTo,
    setFlag,
    setSnapshot,
    clearSnapshot,
    recordMessage,
    getRecordedMessage,
    isBartenderMessage,
};
