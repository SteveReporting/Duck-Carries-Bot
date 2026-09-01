"use strict";

// Always prefer the repo's .env file over stale PM2 environment values.
// This matters after Discord token rotations: PM2 can otherwise keep an old
// TOKEN value even after .env has been updated.
require("dotenv").config({ override: true });

const discordToken = String(
  process.env.DISCORD_TOKEN || process.env.TOKEN || "",
).trim();

if (discordToken) {
  process.env.TOKEN = discordToken;
}
