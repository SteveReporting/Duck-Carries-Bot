const assert = require("assert");
const db = require("../database/database");
const {
  applyLegacyEnvironment,
  getGuildConfig,
  isGuildConfigured,
  saveGuildConfig,
} = require("../platform/guildConfig");

const guildA = "999000000000000001";
const guildB = "999000000000000002";

function cleanup() {
  db.prepare("DELETE FROM guild_config WHERE guild IN (?,?)").run(guildA, guildB);
  db.prepare("DELETE FROM settings WHERE guild IN (?,?)").run(guildA, guildB);
}

cleanup();

const a = saveGuildConfig(guildA, {
  guild_name: "Alpha",
  queue_channel_id: "111",
  completed_channel_id: "112",
  ticket_category_id: "113",
  carrier_role_id: "114",
  staff_role_id: "115",
  mod_log_channel_id: "116",
  operations_channel_id: "117",
  waiting_voice_id: "118",
});
const b = saveGuildConfig(guildB, {
  guild_name: "Beta",
  queue_channel_id: "211",
  completed_channel_id: "212",
  ticket_category_id: "213",
  carrier_role_id: "214",
  staff_role_id: "215",
});

assert.strictEqual(isGuildConfigured(guildA), true);
assert.strictEqual(isGuildConfigured(guildB), true);
assert.strictEqual(getGuildConfig(guildA).queue_channel_id, "111");
assert.strictEqual(getGuildConfig(guildB).queue_channel_id, "211");
assert.notStrictEqual(a.carrier_role_id, b.carrier_role_id);

applyLegacyEnvironment(a);
assert.strictEqual(process.env.GUILD_ID, guildA);
assert.strictEqual(process.env.CARRY_QUEUE_CHANNEL_ID, "111");
assert.strictEqual(process.env.CARRY_CLAIM_ROLE_ID, "114");

applyLegacyEnvironment(b);
assert.strictEqual(process.env.GUILD_ID, guildB);
assert.strictEqual(process.env.CARRY_QUEUE_CHANNEL_ID, "211");
assert.strictEqual(process.env.CARRY_CLAIM_ROLE_ID, "214");
assert.strictEqual(process.env.MOD_LOG_CHANNEL_ID, undefined);

cleanup();
console.log("guildConfig tests passed");
