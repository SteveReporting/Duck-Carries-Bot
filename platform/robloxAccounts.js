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
    "",
    "After verification, the bot will sync your nickname automatically.",
  ].join("\n");
}

module.exports = {
  applyRobloxNickname,
  applyVerificationRoles,
  getCommunityMembership,
  getRobloxAccount,
  getRobloxAvatar,
  joinInstructions,
  resolveRobloxUsername,
  syncVerifiedMember,
};
