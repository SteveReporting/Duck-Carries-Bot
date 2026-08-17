const { createClient } = require("@supabase/supabase-js");

const { getSupabase } = require("../marketplace/supabase");
const { loadLiveLegacyQueue } = require("./legacyQueue");
const { canonicalizeDungeon, canonicalizeDifficulty } = require("./dungeons");

const DEFAULT_PUBLIC_QUEUE_URL = "https://ewqsffciglcadazxzvhr.supabase.co";
const ACTIVE_PUBLIC_STATUSES = ["waiting", "claimed", "in_progress"];

let publicClient = null;
let timer = null;
let warnedMissingSecret = false;

function publicQueueClient() {
  const secretKey = process.env.PUBLIC_QUEUE_SUPABASE_SECRET_KEY;
  if (!secretKey) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn("[PUBLIC QUEUE] PUBLIC_QUEUE_SUPABASE_SECRET_KEY is not configured, so the /queue website snapshot cannot be updated yet.");
    }
    return null;
  }

  if (!publicClient) {
    publicClient = createClient(
      process.env.PUBLIC_QUEUE_SUPABASE_URL || DEFAULT_PUBLIC_QUEUE_URL,
      secretKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return publicClient;
}

function profileName(profile, fallback = "Tavern member") {
  return profile?.roblox_username || profile?.discord_display_name || profile?.discord_username || fallback;
}

function publicStatus(status) {
  if (status === "queued" || status === "waiting") return "waiting";
  if (status === "claimed") return "claimed";
  if (status === "in_progress") return "in_progress";
  return "waiting";
}

function priorityForCreatedAt(createdAt) {
  const age = Date.now() - new Date(createdAt || Date.now()).getTime();
  if (age >= 60 * 60 * 1000) return "urgent";
  if (age >= 30 * 60 * 1000) return "high";
  return "normal";
}

function normalizeRuns(value) {
  const parsed = Number.parseInt(String(value ?? "1"), 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 15) : 1;
}

async function loadPlatformRequests() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select(`
      id,
      dungeon,
      difficulty,
      runs_requested,
      status,
      created_at,
      requester:profiles!carry_requests_requester_id_fkey(discord_id,discord_username,discord_display_name,roblox_username),
      carrier:profiles!carry_requests_carrier_id_fkey(discord_id,discord_username,discord_display_name,roblox_username)
    `)
    .in("status", ["queued", "claimed", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(`Could not load shared carry_requests: ${error.message}`);
  return data || [];
}

async function buildPublicSnapshot(client) {
  const guildId = process.env.GUILD_ID;
  const [platformRows, legacyRows] = await Promise.all([
    loadPlatformRequests(),
    guildId ? loadLiveLegacyQueue(client, guildId, { maxMessages: 500 }).catch((error) => {
      console.warn("[PUBLIC QUEUE] Could not read legacy queue messages:", error.message);
      return [];
    }) : Promise.resolve([]),
  ]);

  const snapshot = [];

  for (const row of platformRows) {
    const createdAt = row.created_at || new Date().toISOString();
    snapshot.push({
      dungeon: canonicalizeDungeon(row.dungeon),
      difficulty: canonicalizeDifficulty(row.difficulty),
      // Hardcore is deliberately ignored for public queue grouping. INS HC and INS
      // are one Insane queue; NM HC and NM are one Nightmare queue.
      hardcore: false,
      runs: normalizeRuns(row.runs_requested),
      requester_name: profileName(row.requester),
      requester_discord_id: row.requester?.discord_id || null,
      priority: priorityForCreatedAt(createdAt),
      estimated_wait_minutes: null,
      status: publicStatus(row.status),
      carrier_name: row.carrier ? profileName(row.carrier, "Carrier") : null,
      carrier_discord_id: row.carrier?.discord_id || null,
      claimed_at: row.status === "claimed" || row.status === "in_progress" ? createdAt : null,
      completed_at: null,
      created_at: createdAt,
      updated_at: new Date().toISOString(),
    });
  }

  // Keep older SQLite/Discord-panel requests visible until everybody is using the
  // shared carry_requests flow.
  for (const row of legacyRows) {
    const createdAt = new Date().toISOString();
    snapshot.push({
      dungeon: canonicalizeDungeon(row.dungeon),
      difficulty: canonicalizeDifficulty(row.difficulty),
      hardcore: false,
      runs: normalizeRuns(row.runs),
      requester_name: row.roblox || "Discord member",
      requester_discord_id: row.user ? String(row.user) : null,
      priority: "normal",
      estimated_wait_minutes: null,
      status: publicStatus(row.status),
      carrier_name: row.carrier ? "Carrier" : null,
      carrier_discord_id: row.carrier ? String(row.carrier) : null,
      claimed_at: row.status === "claimed" ? createdAt : null,
      completed_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  snapshot.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return snapshot.map((row, index) => ({ ...row, queue_position: index + 1 }));
}

async function syncPublicCarryQueue(client) {
  const target = publicQueueClient();
  if (!target) return;

  const snapshot = await buildPublicSnapshot(client);

  // carry_queue on the public website is a read-only snapshot. Preserve historical
  // completed/cancelled records if they ever exist, but replace all active rows with
  // the bot's authoritative live queue on each sync.
  const { error: deleteError } = await target
    .from("carry_queue")
    .delete()
    .in("status", ACTIVE_PUBLIC_STATUSES);
  if (deleteError) throw new Error(`Public queue clear failed: ${deleteError.message}`);

  if (snapshot.length) {
    const { error: insertError } = await target.from("carry_queue").insert(snapshot);
    if (insertError) throw new Error(`Public queue insert failed: ${insertError.message}`);
  }

  console.log(`[PUBLIC QUEUE] Mirrored ${snapshot.length} active carry request(s) to the /queue website.`);
}

function startPublicQueueSync(client) {
  if (timer) return;

  const run = async () => {
    try {
      await syncPublicCarryQueue(client);
    } catch (error) {
      console.error("[PUBLIC QUEUE]", error);
    }
  };

  void run();
  timer = setInterval(() => void run(), 30_000);
  timer.unref?.();
}

module.exports = { startPublicQueueSync, syncPublicCarryQueue };
