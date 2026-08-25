const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, hasAnyPlatformRole } = require("./helpers");

const STAFF_ROLES = ["moderator", "administrator", "owner"];
const ACTIVE_STATUSES = ["claimed", "in_progress"];

async function loadActiveTicketRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,runs_requested,runs_completed,session_runs,status,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(discord_id),carrier:profiles!carry_requests_carrier_id_fkey(discord_id)")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ACTIVE_STATUSES);
  if (error) throw new Error(`Could not verify carry-ticket integrity: ${error.message}`);
  return data || [];
}

function readyCheckFor(requestId) {
  try {
    return db.prepare("SELECT request_id,ticket_channel,requester,carrier,status FROM carry_ready_checks WHERE request_id = ?")
      .get(String(requestId)) || null;
  } catch {
    return null;
  }
}

function deleteReadyCheck(requestId) {
  try {
    db.prepare("DELETE FROM carry_ready_checks WHERE request_id = ?").run(String(requestId));
    return true;
  } catch {
    return false;
  }
}

function clearStaleReadyChecks(channelId, requests) {
  let removed = 0;
  for (const request of requests || []) {
    const current = readyCheckFor(request.id);
    if (!current) continue;

    const expectedRequester = request.requester?.discord_id ? String(request.requester.discord_id) : null;
    const expectedCarrier = request.carrier?.discord_id ? String(request.carrier.discord_id) : null;
    const wrongTicket = String(current.ticket_channel || "") !== String(channelId);
    const wrongRequester = expectedRequester && String(current.requester || "") !== expectedRequester;
    const wrongCarrier = expectedCarrier && String(current.carrier || "") !== expectedCarrier;

    if (wrongTicket || wrongRequester || wrongCarrier) {
      if (deleteReadyCheck(request.id)) removed += 1;
    }
  }
  return removed;
}

async function prepareReadyCheckInteraction(interaction) {
  if (!interaction?.isButton?.() || interaction.customId !== "carry_readycheck_start") return 0;
  const requests = await loadActiveTicketRequests(interaction.channelId);
  const removed = clearStaleReadyChecks(interaction.channelId, requests);
  if (removed) {
    console.log(`[CARRY INTEGRITY] Cleared ${removed} stale ready-check record(s) before a new Ready Check in ${interaction.channelId}.`);
  }
  return removed;
}

async function prepareServiceStartInteraction(interaction) {
  if (!interaction?.isButton?.() || interaction.customId !== "carry_service_start") return 0;
  const requests = await loadActiveTicketRequests(interaction.channelId);
  const removed = clearStaleReadyChecks(interaction.channelId, requests);
  if (removed) {
    console.log(`[CARRY INTEGRITY] Rejected ${removed} stale ready confirmation(s) before Start Carry in ${interaction.channelId}.`);
  }
  return removed;
}

function requestIdsRememberedForTicket(channelId) {
  const ids = new Set();
  try {
    for (const row of db.prepare("SELECT request_id FROM carry_ready_checks WHERE ticket_channel = ? AND status = 'ready'").all(String(channelId))) {
      if (row.request_id) ids.add(String(row.request_id));
    }
  } catch {}
  try {
    for (const row of db.prepare("SELECT request_id FROM carry_service_checkpoint_responses WHERE ticket_channel = ?").all(String(channelId))) {
      if (row.request_id) ids.add(String(row.request_id));
    }
  } catch {}
  return [...ids];
}

function runningServiceSession(channelId) {
  try {
    const row = db.prepare("SELECT * FROM carry_service_sessions WHERE ticket_channel = ?")
      .get(String(channelId));
    if (!row || !["running", "checkpoint"].includes(String(row.status))) return null;
    if (!row.first_started_at || !row.carrier) return null;
    return row;
  } catch {
    return null;
  }
}

async function recoverDetachedCarrySession(interaction) {
  if (!interaction?.isButton?.() || interaction.customId !== "carry_service_complete") return 0;

  const active = await loadActiveTicketRequests(interaction.channelId);
  if (active.length) return 0;

  const session = runningServiceSession(interaction.channelId);
  if (!session) return 0;

  const actorProfile = await getLinkedProfile(interaction.user.id).catch(() => null);
  if (!actorProfile) return 0;

  const actorIsCarrier = String(session.carrier) === String(interaction.user.id);
  const actorIsStaff = await hasAnyPlatformRole(actorProfile.id, STAFF_ROLES).catch(() => false);
  if (!actorIsCarrier && !actorIsStaff) return 0;

  const carrierProfile = actorIsCarrier
    ? actorProfile
    : await getLinkedProfile(String(session.carrier)).catch(() => null);
  if (!carrierProfile) return 0;

  const requestIds = requestIdsRememberedForTicket(interaction.channelId);
  if (!requestIds.length) return 0;

  const supabase = getSupabase();
  const { data: detached, error: loadError } = await supabase
    .from("carry_requests")
    .select("id,runs_requested,runs_completed,status,carrier_id,ticket_channel_id")
    .in("id", requestIds)
    .eq("status", "queued")
    .is("carrier_id", null)
    .is("ticket_channel_id", null);
  if (loadError) throw new Error(`Could not inspect detached carry requests: ${loadError.message}`);

  let recovered = 0;
  const now = new Date().toISOString();
  for (const request of detached || []) {
    const remaining = Math.max(0, Number(request.runs_requested || 0) - Number(request.runs_completed || 0));
    if (remaining <= 0) continue;

    const { data, error } = await supabase
      .from("carry_requests")
      .update({
        carrier_id: carrierProfile.id,
        status: "in_progress",
        claimed_at: now,
        started_at: now,
        ticket_channel_id: String(interaction.channelId),
        session_runs: Math.min(15, remaining),
        carrier_confirmed_at: null,
        requester_confirmed_at: null,
        cancel_reason: null,
        updated_at: now,
      })
      .eq("id", request.id)
      .eq("status", "queued")
      .is("carrier_id", null)
      .is("ticket_channel_id", null)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(`Could not recover detached request ${request.id}: ${error.message}`);
    if (data?.id) recovered += 1;
  }

  if (recovered) {
    console.warn(`[CARRY INTEGRITY] Reattached ${recovered} accidentally detached request(s) to running ticket ${interaction.channelId} before completion.`);
  }
  return recovered;
}

module.exports = {
  clearStaleReadyChecks,
  prepareReadyCheckInteraction,
  prepareServiceStartInteraction,
  recoverDetachedCarrySession,
};
