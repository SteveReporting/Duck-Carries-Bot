const UPGRADE_GAIN = 10;

const SUFFIXES = new Map([
  ["k", 1_000],
  ["m", 1_000_000],
  ["b", 1_000_000_000],
  ["t", 1_000_000_000_000],
  ["q", 1_000_000_000_000_000],
]);

function parsePower(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value);
  }

  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/physical|spell|power|damage|dmg|stat|:/g, "")
    .replace(/[,_\s]/g, "");

  if (!raw) return null;
  const match = /^(\d+(?:\.\d+)?)([kmbtq])?$/.exec(raw);
  if (!match) return null;

  const base = Number.parseFloat(match[1]);
  const multiplier = match[2] ? SUFFIXES.get(match[2]) : 1;
  const result = Math.round(base * multiplier);
  if (!Number.isSafeInteger(result) || result < 0) return null;
  return result;
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value).replace(/[,\s]/g, ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseUpgradeSpec(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return { used: null, total: null, remaining: null };

  // The easiest manual format: 34/120 means 34 upgrades already applied out of 120 total.
  const fraction = raw.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
  if (fraction) {
    const used = integerOrNull(fraction[1]);
    const total = integerOrNull(fraction[2]);
    if (used === null || total === null || used > total) {
      throw new Error("Upgrade progress must look like `used/total`, for example `34/120`.");
    }
    return { used, total, remaining: total - used };
  }

  const usedMatch = raw.match(/(\d[\d,]*)\s*(?:used|applied|current)/);
  const totalMatch = raw.match(/(\d[\d,]*)\s*(?:total|max|maximum)/);
  const remainingMatch = raw.match(/(\d[\d,]*)\s*(?:remaining|left|remain)/);

  const used = usedMatch ? integerOrNull(usedMatch[1]) : null;
  const total = totalMatch ? integerOrNull(totalMatch[1]) : null;
  let remaining = remainingMatch ? integerOrNull(remainingMatch[1]) : null;

  if (used !== null && total !== null) {
    if (used > total) throw new Error("Applied upgrades cannot be greater than total upgrades.");
    remaining = total - used;
  }

  if (remaining !== null) return { used, total, remaining };

  // A single number is intentionally interpreted as remaining upgrades because
  // pot = current power + (remaining upgrades × 10) is the fastest common workflow.
  const single = raw.match(/^\d[\d,]*$/);
  if (single) return { used: null, total: null, remaining: integerOrNull(single[0]) };

  throw new Error("Use `34/120`, `86 remaining`, or just `86` for the upgrade figure.");
}

function normalizeUpgradeData({ used = null, total = null, remaining = null } = {}) {
  used = integerOrNull(used);
  total = integerOrNull(total);
  remaining = integerOrNull(remaining);

  if (used !== null && total !== null) {
    if (used > total) throw new Error("Applied upgrades cannot exceed total upgrades.");
    const derivedRemaining = total - used;
    if (remaining !== null && remaining !== derivedRemaining) {
      throw new Error("The upgrade figures conflict with each other.");
    }
    remaining = derivedRemaining;
  } else if (total !== null && remaining !== null) {
    if (remaining > total) throw new Error("Remaining upgrades cannot exceed total upgrades.");
    used = total - remaining;
  } else if (used !== null && remaining !== null) {
    total = used + remaining;
  }

  return { used, total, remaining };
}

function calculatePotential({ currentPower, used = null, total = null, remaining = null }) {
  const current = parsePower(currentPower);
  if (current === null) throw new Error("Current weapon power is missing or invalid.");

  const upgrades = normalizeUpgradeData({ used, total, remaining });
  if (upgrades.remaining === null) {
    throw new Error("I need the upgrades remaining, or both applied and total upgrades.");
  }

  const potential = current + (upgrades.remaining * UPGRADE_GAIN);
  const basePower = upgrades.used === null ? null : current - (upgrades.used * UPGRADE_GAIN);

  if (basePower !== null && basePower < 0) {
    throw new Error("Those figures would produce a negative clean weapon power, so at least one input is wrong.");
  }

  return {
    currentPower: current,
    appliedUpgrades: upgrades.used,
    totalUpgrades: upgrades.total,
    remainingUpgrades: upgrades.remaining,
    basePower,
    potential,
    gainPerUpgrade: UPGRADE_GAIN,
  };
}

function formatPower(value) {
  return Number(value || 0).toLocaleString("en-US");
}

module.exports = {
  UPGRADE_GAIN,
  calculatePotential,
  formatPower,
  normalizeUpgradeData,
  parsePower,
  parseUpgradeSpec,
};
