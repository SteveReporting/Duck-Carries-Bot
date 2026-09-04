const assert = require("assert");
const { chooseConfiguredGuildId, cleanIds } = require("../platform/guildSelectionPolicy");

assert.deepStrictEqual(cleanIds(["1", " 1 ", "", null, "2"]), ["1", "2"]);

assert.strictEqual(chooseConfiguredGuildId({
  configuredIds: ["prod", "test"],
  visibleIds: ["test"],
  preferredIds: ["prod", "test"],
}), "test");

assert.strictEqual(chooseConfiguredGuildId({
  configuredIds: ["a", "b"],
  visibleIds: ["a", "b"],
  preferredIds: ["b"],
}), "b");

assert.strictEqual(chooseConfiguredGuildId({
  configuredIds: ["a", "b"],
  visibleIds: ["b"],
  preferredIds: ["missing"],
}), "b");

assert.strictEqual(chooseConfiguredGuildId({
  configuredIds: ["a"],
  visibleIds: ["x"],
  preferredIds: ["a"],
}), null);

console.log("guildSelectionPolicy tests passed");
