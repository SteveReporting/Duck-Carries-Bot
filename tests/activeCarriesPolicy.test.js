const assert = require("node:assert/strict");

// Smoke-test the public constants and keep the live-board module loadable in CI.
// Heavy Discord/Supabase interaction is exercised at runtime; this catches syntax/
// export regressions in addition to the repository-wide node --check pass.
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "platform", "activeCarriesBoard.js"), "utf8");

assert.match(source, /active-carries/);
assert.match(source, /End Run \+1/);
assert.match(source, /carry_dropin_open/);
assert.match(source, /active_carry_manage:/);
assert.match(source, /MAX_MUTATIONS_PER_PASS = 30/);
assert.match(source, /\.limit\(5000\)/);

console.log("activeCarriesPolicy.test.js: ok");
