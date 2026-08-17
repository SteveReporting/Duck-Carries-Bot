const CARRY_TAVERN_ROBLOX_GROUP_ID = 738161741;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Roblox API returned ${response.status}. Try again shortly.`);
  return response.json();
}

async function resolveRobloxUsername(username) {
  const resolved = await fetchJson("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ usernames: [String(username || "").trim()], excludeBannedUsers: true }),
  });
  return resolved?.data?.[0] || null;
}

async function getRobloxAccount(userId) {
  return fetchJson(`https://users.roblox.com/v1/users/${userId}`);
}

function normalizeVerificationText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase();
}

function compactVerificationText(value) {
  return normalizeVerificationText(value).replace(/[^a-z0-9]/g, "");
}

function descriptionHasVerificationCode(description, code) {
  const normalizedCode = normalizeVerificationText(code);
  const compactCode = compactVerificationText(code);
  if (!normalizedCode || !compactCode) return false;

  const normalizedDescription = normalizeVerificationText(description);
  if (normalizedDescription.includes(normalizedCode)) return true;

  // Roblox can occasionally expose profile text with spacing or invisible characters
  // that differ from what the user sees. Compacting both sides keeps an 8-character
  // verification token readable without making the comparison case-sensitive.
  return compactVerificationText(description).includes(compactCode);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkRobloxDescriptionVerification(userId, code, options = {}) {
  const delays = Array.isArray(options.delays) && options.delays.length
    ? options.delays
    : [0, 3_500, 5_000, 6_500];

  let details = null;
  let lastError = null;

  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);

    try {
      details = await getRobloxAccount(userId);
      lastError = null;
      const description = String(details?.description || "");
      if (descriptionHasVerificationCode(description, code)) {
        return {
          found: true,
          details,
          attempts: index + 1,
          descriptionEmpty: !description.trim(),
        };
      }
    } catch (error) {
      lastError = error;
      console.warn(`[ROBLOX VERIFY] Account ${userId} check ${index + 1}/${delays.length} failed:`, error.message);
    }
  }

  // If every request failed, surface the real Roblox API error instead of pretending
  // that the user's code was missing from a profile we never successfully read.
  if (!details && lastError) throw lastError;

  const description = String(details?.description || "");
  return {
    found: false,
    details,
    attempts: delays.length,
    descriptionEmpty: !description.trim(),
  };
}

async function getRobloxAvatar(userId) {
  try {
    const data = await fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
    return data?.data?.[0]?.imageUrl || null;
  } catch {
    return null;
  }
}

async function getCommunityMembership(userId) {
  try {
    const groups = await fetchJson(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
    const membership = (groups?.data || []).find((entry) => Number(entry?.group?.id) === CARRY_TAVERN_ROBLOX_GROUP_ID);
    return {
      communityMember: Boolean(membership),
      communityRole: membership?.role?.name || null,
    };
  } catch {
    return { communityMember: false, communityRole: null };
  }
}

async function applyVerificationRoles(member, verified) {
  if (!member) return;
  const verifiedRole = process.env.VERIFIED_ROLE_ID || null;
  const unverifiedRole = process.env.UNVERIFIED_ROLE_ID || null;
  try {
    if (verified) {
      if (unverifiedRole && member.roles.cache.has(unverifiedRole)) await member.roles.remove(unverifiedRole, "Roblox account verified");
      if (verifiedRole && !member.roles.cache.has(verifiedRole)) await member.roles.add(verifiedRole, "Roblox account verified");
    } else if (unverifiedRole && !member.roles.cache.has(unverifiedRole)) {
      await member.roles.add(unverifiedRole, "Roblox verification required");
    }
  } catch (error) {
    console.warn(`[ROBLOX ROLES] ${member.id}:`, error.message);
  }
}

async function applyRobloxNickname(member, username) {
  if (!member || !username) return false;
  try {
    await member.setNickname(String(username).slice(0, 32), "Verified Roblox username sync");
    return true;
  } catch (error) {
    console.warn(`[ROBLOX NICKNAME] ${member?.id}:`, error.message);
    return false;
  }
}

async function syncVerifiedMember(member, profile) {
  if (!member || !profile) return false;
  const verified = Boolean(profile.roblox_verified_at && profile.roblox_username);
  await applyVerificationRoles(member, verified);
  if (!verified) return false;
  return applyRobloxNickname(member, profile.roblox_username);
}

function joinInstructions() {
  const base = (process.env.MARKETPLACE_URL || "").replace(/\/+$/, "");
  const verifyChannel = process.env.VERIFICATION_CHANNEL_ID ? `<#${process.env.VERIFICATION_CHANNEL_ID}>` : "the server";
  return [
    "🍺 **Welcome to The Carry Tavern!**",
    "",
    "Before using the carry queue, connect and verify your Roblox account. Your server nickname will then automatically become your Roblox username.",
    "",
    base ? `1. Sign in once with Discord: ${base}/auth` : "1. Link your Tavern account with Discord.",
    `2. In ${verifyChannel}, run \`/roblox link username:YOUR_USERNAME\`.`,
    "3. Put the code the bot gives you in your Roblox profile About/description.",
    "4. Run `/roblox verify`.",
    base ? `5. If the About method does not work, log into Roblox through the website: ${base}/roblox-link` : "",
    "",
    "After verification, the bot will sync your nickname automatically.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  applyRobloxNickname,
  applyVerificationRoles,
  checkRobloxDescriptionVerification,
  descriptionHasVerificationCode,
  getCommunityMembership,
  getRobloxAccount,
  getRobloxAvatar,
  joinInstructions,
  normalizeVerificationText,
  resolveRobloxUsername,
  syncVerifiedMember,
};
