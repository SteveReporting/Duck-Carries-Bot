const assert = require("node:assert/strict");

const previousGuild = process.env.GUILD_ID;
delete process.env.GUILD_ID;
delete require.cache[require.resolve("../security/config")];

const { createSecurityConfig } = require("../security/config");

const first = createSecurityConfig("111111111111111111");
const second = createSecurityConfig("222222222222222222");

assert.equal(first.discord.guildId, "111111111111111111");
assert.equal(second.discord.guildId, "222222222222222222");
assert.notEqual(first.stateFile, second.stateFile);
assert.match(first.stateFile, /security-state-111111111111111111\.json$/);
assert.match(second.stateFile, /security-state-222222222222222222\.json$/);

if (previousGuild == null) delete process.env.GUILD_ID;
else process.env.GUILD_ID = previousGuild;

console.log("securityConfig.test.js passed");
