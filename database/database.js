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

// Existing live legacy rows predate timestamps. Give them a safe migration timestamp
// so the new timeout system does not instantly remove them on first boot.
db.prepare("UPDATE queue SET created_at = ? WHERE created_at IS NULL").run(Date.now());

module.exports = db;
