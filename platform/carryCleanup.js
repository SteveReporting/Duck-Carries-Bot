const { getSupabase } = require("../marketplace/supabase");

const DEFAULT_RETENTION_HOURS = 24;
const SWEEP_INTERVAL_MS = 60 * 1000;

function retentionHours() {
  const configured = Number.parseInt(process.env.CARRY_COMPLETED_RETENTION_HOURS || "", 10);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_RETENTION_HOURS;
  return Math.min(configured, 24 * 30);
}

async function purgeCancelledDirectly(supabase) {
  const { data, error } = await supabase
    .from("carry_requests")
    .delete()
    .eq("status", "cancelled")
    .select("id");

  if (error) {
    console.warn(`[CARRY CLEANUP] Could not remove cancelled requests: ${error.message}`);
    return 0;
  }

  return data?.length || 0;
}

async function purgeClosedCarries() {
  const hours = retentionHours();
  const before = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const supabase = getSupabase();

  // This direct delete intentionally does not depend on carry_web_actions existing.
  // On deployments with the website bridge its FK is ON DELETE CASCADE; on older
  // deployments there is simply no action table to clean.
  let cancelledRemoved = await purgeCancelledDirectly(supabase);
  let completedRemoved = 0;

  const { data, error } = await supabase.rpc("bot_purge_stale_carries", {
    _completed_before: before,
  });

  if (!error) {
    cancelledRemoved += Number(data?.cancelled_removed || 0);
    completedRemoved += Number(data?.completed_removed || 0);
  } else {
    // Backwards-compatible fallback while the newest migration is being applied.
    const fallback = await supabase.rpc("bot_purge_completed_carries", {
      _before: before,
    });
    if (fallback.error) {
      console.warn(`[CARRY CLEANUP] Completed-request cleanup unavailable: ${fallback.error.message}`);
    } else {
      completedRemoved += Number(fallback.data || 0);
    }
  }

  if (cancelledRemoved > 0 || completedRemoved > 0) {
    console.log(
      `[CARRY CLEANUP] Removed ${cancelledRemoved} cancelled and ${completedRemoved} completed request(s). Completed retention: ${hours}h. Carry activity/stats were preserved.`,
    );
  }

  return { cancelledRemoved, completedRemoved };
}

let timer = null;

function startCarryCleanup() {
  if (timer) return;

  void purgeClosedCarries().catch((error) => {
    console.warn("[CARRY CLEANUP] Initial sweep failed:", error.message);
  });

  timer = setInterval(() => {
    void purgeClosedCarries().catch((error) => {
      console.warn("[CARRY CLEANUP] Sweep failed:", error.message);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

module.exports = {
  purgeClosedCarries,
  startCarryCleanup,
};
