const assert = require("node:assert/strict");
const {
  calculatePotential,
  parsePower,
  parseUpgradeSpec,
} = require("../platform/potCalculator");

// Clean weapon: 100 remaining upgrades at +10 each.
{
  const result = calculatePotential({ currentPower: 25_000, remaining: 100 });
  assert.equal(result.potential, 26_000);
  assert.equal(result.basePower, null);
}

// Partially upgraded weapon: 34 of 120 already applied.
{
  const upgrades = parseUpgradeSpec("34/120");
  const result = calculatePotential({ currentPower: 25_340, ...upgrades });
  assert.equal(result.appliedUpgrades, 34);
  assert.equal(result.remainingUpgrades, 86);
  assert.equal(result.basePower, 25_000);
  assert.equal(result.potential, 26_200);
}

// A simple number means upgrades remaining.
{
  const upgrades = parseUpgradeSpec("86");
  const result = calculatePotential({ currentPower: 25_340, ...upgrades });
  assert.equal(result.remainingUpgrades, 86);
  assert.equal(result.potential, 26_200);
}

// Friendly number parsing for Discord input.
assert.equal(parsePower("1.25m"), 1_250_000);
assert.equal(parsePower("25,340"), 25_340);

console.log("✅ Pot calculator tests passed.");
