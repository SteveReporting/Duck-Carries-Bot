require("dotenv").config();

const path = require("path");
const Database = require("better-sqlite3");
const { getSupabase } = require("../marketplace/supabase");

const SERVICE_TIME_RESET_AT = Date.parse("2026-08-24T03:53:00+01:00");
const MATCH_WINDOW_MS = 3 * 60 * 1000;
const GROUP_WINDOW_MS = 15 * 1000;
const apply = process.argv.includes("--apply");

function argumentValue(name) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return null;
}

const sourceDbArg = argumentValue("--db");
const sourceDbPath = sourceDbArg ? path.resolve(process.cwd(), sourceDbArg) : null;
const db = sourceDbPath
  ? new Database(sourceDbPath, { readonly: true, fileMustExist: true })
  : require("../database/database");

function iso(ms) {
  return new Date(Number(ms)).toISOString();
}

function hasHistoryTable() {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='carry_service_history'").get();
  return Boolean(row);
}

function localHistory() {
  if (!hasHistoryTable()) return [];
  return db.prepare(`
    SELECT ticket_channel,guild,carrier,service_seconds,service_minutes,
           runs_completed,request_count,completed_at
    FROM carry_service_history
    WHERE completed_at >= ?
      AND service_minutes > 0
    ORDER BY completed_at ASC
  `).all(SERVICE_TIME_RESET_AT);
}

async function profileForDiscord(supabase, discordId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,discord_id,discord_username,discord_display_name")
    .eq("discord_id", String(discordId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function candidateActivity(supabase, profileId, completedAt) {
  const from = new Date(Number(completedAt) - MATCH_WINDOW_MS).toISOString();
  const to = new Date(Number(completedAt) + MATCH_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("carry_activity")
    .select("id,carry_request_id,carrier_id,runs,service_minutes,completed_at,dungeon")
    .eq("carrier_id", profileId)
    .gte("completed_at", from)
    .lte("completed_at", to)
    .order("completed_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function nearestGroup(rows, completedAt, usedIds) {
  const unused = rows
    .filter((row) => !usedIds.has(String(row.id)))
    .map((row) => ({
      ...row,
      stamp: Date.parse(row.completed_at || ""),
    }))
    .filter((row) => Number.isFinite(row.stamp))
    .sort((a, b) => Math.abs(a.stamp - completedAt) - Math.abs(b.stamp - completedAt));

  if (!unused.length) return [];
  const nearest = unused[0];
  if (Math.abs(nearest.stamp - completedAt) > MATCH_WINDOW_MS) return [];

  return unused.filter((row) => Math.abs(row.stamp - nearest.stamp) <= GROUP_WINDOW_MS);
}

async function writeGroup(supabase, group, minutes) {
  const amount = Math.max(0, Math.floor(Number(minutes || 0)));
  if (!group.length || amount <= 0) return;

  const primary = group[0];
  const otherIds = group.slice(1).map((row) => row.id);

  if (otherIds.length) {
    const { error } = await supabase
      .from("carry_activity")
      .update({ service_minutes: 0 })
      .in("id", otherIds);
    if (error) throw new Error(`Could not clear grouped duplicate time: ${error.message}`);
  }

  const { error } = await supabase
    .from("carry_activity")
    .update({ service_minutes: amount })
    .eq("id", primary.id);
  if (error) throw new Error(`Could not write verified time: ${error.message}`);
}

async function main() {
  const histories = localHistory();
  const supabase = getSupabase();
  const usedIds = new Set();

  console.log(`Verified-time backfill mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Source database: ${sourceDbPath || "live database/duck.db"}`);
  console.log(`Local verified sessions since reset: ${histories.length}`);

  if (!hasHistoryTable()) {
    console.log("Source database has no carry_service_history table.");
  }

  let matched = 0;
  let alreadyPresent = 0;
  let skipped = 0;
  let wouldWriteMinutes = 0;

  for (const history of histories) {
    const profile = await profileForDiscord(supabase, history.carrier);
    if (!profile) {
      console.log(`[SKIP] ${history.ticket_channel} carrier ${history.carrier}: no Supabase profile.`);
      skipped += 1;
      continue;
    }

    const rows = await candidateActivity(supabase, profile.id, Number(history.completed_at));
    const group = nearestGroup(rows, Number(history.completed_at), usedIds);
    if (!group.length) {
      console.log(`[SKIP] ${history.ticket_channel} ${profile.discord_display_name || profile.discord_username || history.carrier}: no unambiguous carry_activity match near ${iso(history.completed_at)}.`);
      skipped += 1;
      continue;
    }

    group.forEach((row) => usedIds.add(String(row.id)));
    const currentMinutes = group.reduce((sum, row) => sum + Math.max(0, Number(row.service_minutes || 0)), 0);
    const wanted = Math.max(0, Number(history.service_minutes || 0));
    const label = profile.discord_display_name || profile.discord_username || history.carrier;

    if (currentMinutes === wanted) {
      console.log(`[OK] ${label} ${history.ticket_channel}: ${wanted}m already present across ${group.length} activity row(s).`);
      alreadyPresent += 1;
      continue;
    }

    console.log(`[MATCH] ${label} ${history.ticket_channel}: local=${wanted}m, website=${currentMinutes}m, activityRows=${group.length}, completed=${iso(history.completed_at)}.`);
    matched += 1;
    wouldWriteMinutes += wanted;

    if (apply) {
      await writeGroup(supabase, group, wanted);
      console.log(`        -> applied ${wanted}m once for this grouped session.`);
    }
  }

  console.log("");
  console.log(`Matched needing repair: ${matched}`);
  console.log(`Already correct: ${alreadyPresent}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`${apply ? "Written" : "Would write"}: ${wouldWriteMinutes} verified minute(s)`);

  if (!apply && matched > 0) {
    console.log("");
    const dbPart = sourceDbArg ? ` --db ${JSON.stringify(sourceDbArg)}` : "";
    console.log(`Review the matches above. If they look correct, rerun with: node scripts/backfill-verified-service-time.js${dbPart} --apply`);
  }
}

main()
  .catch((error) => {
    console.error("Verified-time backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    try { db.close(); } catch {}
  });
