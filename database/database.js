const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const databaseDir = path.join(__dirname);
const databasePath = path.join(databaseDir, "duck.db");

fs.mkdirSync(databaseDir, { recursive: true });

const db = new Database(databasePath);

// Better defaults for a long-running VM process.
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.prepare(`
    CREATE TABLE IF NOT EXISTS settings(
        guild TEXT PRIMARY KEY,
        queueChannel TEXT,
        requestChannel TEXT,
        completedChannel TEXT
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS queue(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT,
        user TEXT,
        roblox TEXT,
        dungeon TEXT,
        difficulty TEXT,
        runs TEXT,
        availability TEXT,
        notes TEXT,
        carrier TEXT,
        status TEXT DEFAULT 'waiting'
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS stats(
        user TEXT PRIMARY KEY,
        completed INTEGER DEFAULT 0
    )
`).run();

// Bot-only community state. The shared carry queue itself remains in Supabase.
db.prepare(`
    CREATE TABLE IF NOT EXISTS carrier_status(
        guild TEXT NOT NULL,
        user TEXT NOT NULL,
        available INTEGER NOT NULL DEFAULT 0,
        session_dungeon TEXT,
        session_difficulty TEXT,
        session_started_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(guild, user)
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS carrier_permissions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT NOT NULL,
        user TEXT NOT NULL,
        dungeon TEXT NOT NULL,
        difficulty TEXT NOT NULL DEFAULT '*',
        allowed INTEGER NOT NULL DEFAULT 1,
        granted_by TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(guild, user, dungeon, difficulty)
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS carrier_ratings(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT,
        request_id TEXT NOT NULL UNIQUE,
        carrier TEXT NOT NULL,
        requester TEXT NOT NULL,
        score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
        note TEXT,
        created_at INTEGER NOT NULL
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS no_shows(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT NOT NULL,
        request_id TEXT,
        offender TEXT NOT NULL,
        reporter TEXT NOT NULL,
        offender_side TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS warnings(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT NOT NULL,
        user TEXT NOT NULL,
        staff TEXT NOT NULL,
        reason TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        removed_at INTEGER,
        removed_by TEXT
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS trade_ratings(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT NOT NULL,
        rater TEXT NOT NULL,
        target TEXT NOT NULL,
        score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
        reference TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(guild, rater, target, reference)
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS trade_disputes(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT NOT NULL,
        reporter TEXT NOT NULL,
        target TEXT NOT NULL,
        kind TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolved_by TEXT
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS abuse_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild TEXT NOT NULL,
        user TEXT NOT NULL,
        kind TEXT NOT NULL,
        weight INTEGER NOT NULL DEFAULT 1,
        metadata TEXT,
        created_at INTEGER NOT NULL
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS abuse_alerts(
        guild TEXT NOT NULL,
        user TEXT NOT NULL,
        last_alert_at INTEGER NOT NULL,
        last_score INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(guild, user)
    )
`).run();

function addColumn(table, definition) {
    const name = definition.trim().split(/\s+/)[0];
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === name)) {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
    }
}

addColumn("settings", "queueBoardMessage TEXT");

addColumn("queue", "created_at INTEGER");
addColumn("queue", "ticket_channel TEXT");
addColumn("queue", "message_channel TEXT");
addColumn("queue", "message_id TEXT");
addColumn("queue", "carrier_confirmed INTEGER DEFAULT 0");
addColumn("queue", "requester_confirmed INTEGER DEFAULT 0");
addColumn("queue", "notes TEXT");

// Do not refresh unknown-age legacy requests to "now". Rows without a timestamp
// are treated as stale by the queue loader/cleanup instead of being resurrected
// for another 24 hours every time the bot restarts.

// Helpful indexes for leaderboard, moderation and matching reads.
db.prepare("CREATE INDEX IF NOT EXISTS carrier_status_available_idx ON carrier_status(guild, available, updated_at)").run();
db.prepare("CREATE INDEX IF NOT EXISTS carrier_permissions_user_idx ON carrier_permissions(guild, user)").run();
db.prepare("CREATE INDEX IF NOT EXISTS carrier_ratings_carrier_idx ON carrier_ratings(carrier, created_at)").run();
db.prepare("CREATE INDEX IF NOT EXISTS no_shows_offender_idx ON no_shows(guild, offender, created_at)").run();
db.prepare("CREATE INDEX IF NOT EXISTS warnings_user_idx ON warnings(guild, user, active)").run();
db.prepare("CREATE INDEX IF NOT EXISTS trade_ratings_target_idx ON trade_ratings(guild, target, created_at)").run();
db.prepare("CREATE INDEX IF NOT EXISTS trade_disputes_target_idx ON trade_disputes(guild, target, status)").run();
db.prepare("CREATE INDEX IF NOT EXISTS abuse_events_user_idx ON abuse_events(guild, user, created_at)").run();

module.exports = db;
