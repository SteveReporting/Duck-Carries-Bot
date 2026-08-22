const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");

const DEFAULT_RETENTION_HOURS = 24;
const SWEEP_INTERVAL_MS = 60 * 1000;

function retentionHours() {
  const configured = Number.parseInt(process.env.CARRY_REQUEST_RETENTION_HOURS || "", 10);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_RETENTION_HOURS;
  return Math.min(configured, 24 * 30);
}

function purgeLegacySqlite(beforeMs) {
  try {
    const result = db
      .prepare("DELETE FROM queue WHERE created_at IS NOT NULL AND created_at < ?")
      .run(beforeMs);
    return Number(result.changes || 0);
  } catch (error) {
    console.warn(`[CARRY CLEANUP] Could not purge legacy SQLite requests: ${error.message}`);
    return 0;
  }
}

async function fallbackSupabaseCleanup(supabase, before) {
  let requestsRemoved = 0;
  let legacyRemoved = 0;

  const legacy = await supabase
    .from("discord_carry_queue")
    .delete()
    .lt("created_at", before)
    .select("id");
  if (!legacy.error) {
    legacyRemoved = legacy.data?.length || 0;
  } else if (!/does not exist|schema cache|relation/i.test(legacy.error.message || "")) {
    console.warn(`[CARRY CLEANUP] Legacy mirror cleanup failed: ${legacy.error.message}`);
  }

  // Cancelled rows should never hang around, even when the newest migration/RPC
  // has not been applied yet.
  const cancelled = await supabase
    .from("carry_requests")
    .delete()
    .eq("status", "cancelled")
    .select("id");
  if (cancelled.error) {
    console.warn(`[CARRY CLEANUP] Cancelled-request cleanup failed: ${cancelled.error.message}`);
  } else {
    requestsRemoved += cancelled.data?.length || 0;
  }

  const stale = await supabase
    .from("carry_requests")
    .delete()
    .lt("created_at", before)
    .select("id");
  if (stale.error) {
    console.warn(`[CARRY CLEANUP] Stale-request cleanup failed: ${stale.error.message}`);
  } else {
    requestsRemoved += stale.data?.length || 0;
  }

  return { requestsRemoved, legacyRemoved, actionsRemoved: 0, auditRemoved: 0 };
}

async function purgeStaleCarries() {
  const hours = retentionHours();
  const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
  const before = new Date(cutoffMs).toISOString();
  const supabase = getSupabase();

  // Remove the original SQLite source first. Otherwise platform/sync.js can put an
  // old legacy request straight back into the Supabase mirror on the next sync.
  const legacySqliteRemoved = purgeLegacySqlite(cutoffMs);

  let result;
  const rpc = await supabase.rpc("bot_purge_stale_carry_data", { _before: before });
  if (!rpc.error) {
    result = {
      requestsRemoved: Number(rpc.data?.requests_removed || 0),
      legacyRemoved: Number(rpc.data?.legacy_removed || 0),
      actionsRemoved: Number(rpc.data?.actions_removed || 0),
      auditRemoved: Number(rpc.data?.audit_removed || 0),
    };
  } else {
    // Older deployments may not have the newest migration yet. Keep the bot
    // usable and clean what can safely be cleaned directly.
    if (!/does not exist|schema cache|function/i.test(rpc.error.message || "")) {
      console.warn(`[CARRY CLEANUP] Stale cleanup RPC failed: ${rpc.error.message}`);
    }
    result = await fallbackSupabaseCleanup(supabase, before);
  }

  if (
    legacySqliteRemoved > 0 ||
    result.requestsRemoved > 0 ||
    result.legacyRemoved > 0 ||
    result.actionsRemoved > 0 ||
    result.auditRemoved > 0
  ) {
    console.log(
      `[CARRY CLEANUP] ${hours}h reset removed ${result.requestsRemoved} platform request(s), ${legacySqliteRemoved} legacy SQLite request(s), ${result.legacyRemoved} legacy mirror row(s), ${result.actionsRemoved} website action log(s), and ${result.auditRemoved} carry audit log(s). Permanent carry_activity stats are preserved.`,
    );
  }

  return { ...result, legacySqliteRemoved };
}

let timer = null;

function startCarryCleanup() {
  if (timer) return;

  void purgeStaleCarries().catch((error) => {
    console.warn("[CARRY CLEANUP] Initial sweep failed:", error.message);
  });

  timer = setInterval(() => {
    void purgeStaleCarries().catch((error) => {
      console.warn("[CARRY CLEANUP] Sweep failed:", error.message);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

module.exports = {
  purgeStaleCarries,
  startCarryCleanup,
};
