"use strict";

const db = require("../database/database");

function all(sql, ...params) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function one(sql, ...params) {
  try {
    return db.prepare(sql).get(...params) || {};
  } catch {
    return {};
  }
}

function countBy(rows, key) {
  const result = {};
  for (const row of rows) {
    const value = String(row?.[key] || "unknown");
    result[value] = (result[value] || 0) + Number(row?.count || 1);
  }
  return result;
}

function primaryGuildId() {
  return String(
    process.env.SENTIENT_PRIMARY_GUILD_ID ||
    process.env.PRIMARY_GUILD_ID ||
    process.env.GUILD_ID ||
    "",
  ).trim();
}

function localGuildState(guildId) {
  const cutoff7d = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const carriers = one(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN available = 1 THEN 1 ELSE 0 END) AS available FROM carrier_status WHERE guild = ?",
    guildId,
  );
  const warnings = one("SELECT COUNT(*) AS total FROM warnings WHERE guild = ? AND active = 1", guildId);
  const disputes = one("SELECT COUNT(*) AS total FROM trade_disputes WHERE guild = ? AND status = 'open'", guildId);
  const noShows = one("SELECT COUNT(*) AS total FROM no_shows WHERE guild = ? AND created_at >= ?", guildId, cutoff7d);
  const abuse = one("SELECT COALESCE(SUM(weight), 0) AS score FROM abuse_events WHERE guild = ? AND created_at >= ?", guildId, cutoff7d);
  const legacyQueue = all(
    "SELECT status, COUNT(*) AS count FROM queue WHERE guild = ? GROUP BY status",
    guildId,
  );
  const loans = all(
    "SELECT status, COUNT(*) AS count FROM treasury_loans WHERE guild = ? GROUP BY status",
    guildId,
  );
  const donations = all(
    "SELECT status, COUNT(*) AS count FROM treasury_donations WHERE guild = ? GROUP BY status",
    guildId,
  );
  const treasuryUsers = one(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN banned = 1 THEN 1 ELSE 0 END) AS banned, AVG(trust) AS avgTrust FROM treasury_users WHERE guild = ?",
    guildId,
  );

  return {
    carriers: {
      known: Number(carriers.total || 0),
      available: Number(carriers.available || 0),
    },
    moderation: {
      activeWarnings: Number(warnings.total || 0),
      openTradeDisputes: Number(disputes.total || 0),
      noShows7d: Number(noShows.total || 0),
      abuseWeight7d: Number(abuse.score || 0),
    },
    legacyQueue: countBy(legacyQueue, "status"),
    treasury: {
      loans: countBy(loans, "status"),
      donations: countBy(donations, "status"),
      users: Number(treasuryUsers.total || 0),
      bannedUsers: Number(treasuryUsers.banned || 0),
      averageTrust: treasuryUsers.avgTrust == null ? null : Number(Number(treasuryUsers.avgTrust).toFixed(1)),
    },
  };
}

function aggregateSharedQueue(rows) {
  const statuses = {};
  const groups = new Map();
  let remainingRuns = 0;
  let oldestQueuedAt = null;

  for (const row of rows || []) {
    const status = String(row.status || "unknown");
    statuses[status] = (statuses[status] || 0) + 1;
    remainingRuns += Math.max(0, Number(row.runs_requested || 0) - Number(row.runs_completed || 0));

    if (status === "queued" && row.created_at) {
      if (!oldestQueuedAt || new Date(row.created_at).getTime() < new Date(oldestQueuedAt).getTime()) oldestQueuedAt = row.created_at;
    }

    const key = `${row.dungeon || "Unknown"} • ${row.difficulty || "Unknown"}`;
    const group = groups.get(key) || { activity: key, requests: 0, remainingRuns: 0 };
    group.requests += 1;
    group.remainingRuns += Math.max(0, Number(row.runs_requested || 0) - Number(row.runs_completed || 0));
    groups.set(key, group);
  }

  return {
    total: (rows || []).length,
    statuses,
    remainingRuns,
    oldestQueuedAt,
    topGroups: [...groups.values()]
      .sort((a, b) => b.requests - a.requests || b.remainingRuns - a.remainingRuns)
      .slice(0, 8),
  };
}

async function collectOperationalState(guildId) {
  const local = localGuildState(guildId);
  let sharedCarryQueue = null;
  let sharedCarryQueueError = null;

  // The current Carry Tavern platform queue is shared in Supabase. Never mirror
  // that shared tenant state into unrelated guild twins.
  const primary = primaryGuildId();
  if (primary && String(guildId) === primary) {
    try {
      const { loadPlatformQueue } = require("../platform/carryQueue");
      const rows = await loadPlatformQueue({ limit: 250 });
      sharedCarryQueue = aggregateSharedQueue(rows);
    } catch (error) {
      sharedCarryQueueError = error?.message || String(error);
    }
  }

  return {
    guildId: String(guildId),
    capturedAt: new Date().toISOString(),
    source: "carry-tavern-bot",
    ...local,
    sharedCarryQueue,
    sharedCarryQueueError,
  };
}

async function publishOperationalTwin(control, guildId, state) {
  const writes = [
    control.intelligence("twin_update", guildId, {
      domain: "carry-tavern-operations",
      entityKey: "guild",
      state,
    }),
    control.intelligence("event_ingest", guildId, {
      kind: "carry-tavern.operational.snapshot",
      source: "carry-tavern-bot",
      payload: {
        carriers: state.carriers,
        moderation: state.moderation,
        legacyQueue: state.legacyQueue,
        treasury: state.treasury,
        sharedCarryQueue: state.sharedCarryQueue,
      },
      requiresLanguage: false,
      consequential: false,
      occurredAt: state.capturedAt,
    }),
  ];
  return Promise.allSettled(writes);
}

module.exports = {
  aggregateSharedQueue,
  collectOperationalState,
  localGuildState,
  publishOperationalTwin,
};
