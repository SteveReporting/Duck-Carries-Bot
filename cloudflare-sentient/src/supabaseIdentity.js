const CACHE_TTL_MS = 10 * 60 * 1000;

let cacheExpiresAt = 0;
let identityCache = new Map();
let refreshPromise = null;

function titleCaseName(value) {
  const cleaned = String(value || "").trim();
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'’-]{2,32}$/.test(cleaned)) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function envConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

function metadataFirstName(user) {
  const app = user?.app_metadata || {};
  const meta = user?.user_metadata || {};

  const explicit =
    app.sentient_first_name ||
    app.preferred_first_name ||
    meta.sentient_first_name ||
    meta.preferred_first_name ||
    meta.first_name;

  return titleCaseName(explicit);
}

function inferConsentedEmailFirstName(user) {
  const meta = user?.user_metadata || {};
  const app = user?.app_metadata || {};
  const allowed = meta.sentient_allow_email_name === true || app.sentient_allow_email_name === true;
  if (!allowed) return null;

  const email = String(user?.email || "").trim();
  const at = email.indexOf("@");
  if (at <= 0) return null;

  const local = email.slice(0, at).toLowerCase();
  const firstChunk = local.split(/[._-]+/)[0].replace(/\d+$/g, "");
  if (!/^[a-z]{3,20}$/.test(firstChunk)) return null;

  return titleCaseName(firstChunk);
}

function firstNameForUser(user) {
  return metadataFirstName(user) || inferConsentedEmailFirstName(user);
}

function discordProviderId(user) {
  for (const identity of user?.identities || []) {
    if (identity?.provider === "discord" && identity?.provider_id) {
      return String(identity.provider_id);
    }
  }
  return null;
}

async function fetchUsers(env) {
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SECRET_KEY || "");
  if (!base || !key) return [];

  const response = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Supabase Auth ${response.status}: ${body?.message || body?.error || "failed to list users"}`);
  }

  return Array.isArray(body?.users) ? body.users : [];
}

async function refreshIdentityCache(env) {
  if (!envConfigured(env)) {
    identityCache = new Map();
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return identityCache;
  }

  const users = await fetchUsers(env);
  const next = new Map();

  for (const user of users) {
    const discordId = discordProviderId(user);
    if (!discordId) continue;

    const firstName = firstNameForUser(user);
    if (!firstName) continue;

    next.set(discordId, {
      firstName,
      source: metadataFirstName(user) ? "profile" : "consented_email",
    });
  }

  identityCache = next;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return identityCache;
}

async function ensureCache(env) {
  if (Date.now() < cacheExpiresAt) return identityCache;
  if (!refreshPromise) {
    refreshPromise = refreshIdentityCache(env).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export function supabaseIdentityConfigured(env) {
  return envConfigured(env);
}

export async function getSupabaseFirstName(env, discordUserId) {
  if (!discordUserId || !envConfigured(env)) return null;

  try {
    const cache = await ensureCache(env);
    return cache.get(String(discordUserId))?.firstName || null;
  } catch (error) {
    console.error("[SENTIENT SUPABASE] identity lookup failed:", error);
    return null;
  }
}
