const { getSupabase } = require("../marketplace/supabase");

const DEFAULT_RETENTION_HOURS = 24;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function retentionHours() {
  const configured = Number.parseInt(process.env.CARRY_COMPLETED_RETENTION_HOURS || "", 10);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_RETENTION_HOURS;
  return Math.min(configured, 24 * 30);
}

async function purgeCompletedCarries() {
  const hours = retentionHours();
  const before = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc("bot_purge_completed_carries", {
    _before: before,
  });

  if (error) {
    // Safe failure mode: if the matching migration has not been applied yet,
    // leave every request untouched rather than risking carry/stat history.
    console.warn(`[CARRY CLEANUP] Could not purge completed requests: ${error.message}`);
    return 0;
  }

  const removed = Number(data || 0);
  if (removed > 0) {
    console.log(`[CARRY CLEANUP] Removed ${removed} completed request(s) older than ${hours}h. Carry activity/stats were preserved.`);
  }
  return removed;
}

let timer = null;

function startCarryCleanup() {
  if (timer) return;

  void purgeCompletedCarries().catch((error) => {
    console.warn("[CARRY CLEANUP] Initial sweep failed:", error.message);
  });

  timer = setInterval(() => {
    void purgeCompletedCarries().catch((error) => {
      console.warn("[CARRY CLEANUP] Sweep failed:", error.message);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

module.exports = {
  purgeCompletedCarries,
  startCarryCleanup,
};
