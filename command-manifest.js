// Only commands in this manifest are loaded and registered in production.
// Legacy/setup/demo command modules may remain in /commands for internal reuse.
module.exports = [
  "botfix-owner.js",
  "carrier-admin.js",
  "carrier.js",
  "help.js",
  "leaderboard.js",
  "marketplace.js",
  "queue3.js",
  "report.js",
  "tavern.js",
  "treasury-combined.js",
  "warn.js",
];
