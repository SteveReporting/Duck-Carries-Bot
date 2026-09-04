const assert = require("assert");
const {
  formatAge,
  pressureFor,
  stageForStatus,
} = require("../platform/carryOpsPolicy");

assert.deepStrictEqual(
  pressureFor({ waiting: 0, oldestMinutes: 0, availableCarriers: 0 }),
  { level: "clear", score: 0, label: "🟢 Clear" },
);

const low = pressureFor({ waiting: 1, oldestMinutes: 5, availableCarriers: 1 });
assert.strictEqual(low.level, "low");
assert.strictEqual(low.score, 3);

const high = pressureFor({ waiting: 4, oldestMinutes: 35, availableCarriers: 1 });
assert.strictEqual(high.level, "high");
assert.strictEqual(high.score, 63);

const criticalByAge = pressureFor({ waiting: 1, oldestMinutes: 50, availableCarriers: 4 });
assert.strictEqual(criticalByAge.level, "critical");

assert.strictEqual(formatAge(30_000), "<1m");
assert.strictEqual(formatAge(35 * 60_000), "35m");
assert.strictEqual(formatAge((2 * 60 + 7) * 60_000), "2h 7m");

assert.strictEqual(stageForStatus("queued").step, 1);
assert.match(stageForStatus("queued").ribbon, /WAITING/);
assert.strictEqual(stageForStatus("claimed", "not_started").step, 2);
assert.strictEqual(stageForStatus("claimed", "stopped").step, 3);
assert.strictEqual(stageForStatus("in_progress", "running").step, 4);
assert.strictEqual(stageForStatus("completed", "completed").step, 5);
assert.match(stageForStatus("completed", "completed").ribbon, /🏆 DONE/);

console.log("✅ carryOpsPolicy tests passed");
