# The Carry Tavern Discord Bot

A Discord.js bot for Dungeon Quest communities. It includes the carry queue, carrier statistics, automated carry voice sessions, weapon potential calculation, Treasury loans/trust tracking, private Treasury tickets, Project Sentient, integrated security, and a locally hosted AI server manager.

## Multi-server installation

The bot is no longer tied to one Discord guild. Its slash commands are registered globally, so it can be invited to any server supported by the Discord application settings.

After inviting it, a server manager runs:

`/setup`

Setup stores that guild's own configuration and can automatically create/reuse:

- carry queue
- completed carries channel
- carry ticket category
- Waiting for Carrier voice channel
- Carrier role
- Tavern Staff role
- private staff logs
- private operations channel

`GUILD_ID` is optional and only acts as a preferred compatibility guild for older background modules. It is not required for the bot to start or for another server to run `/setup`.

## Features

- Button-first carry request and Carrier workflows
- Smart grouped carry queue and private carry tickets
- Optional Waiting VC with automatic transfer into claimed carry sessions
- Automatic private Carry VCs, start pings and mid-run voice drop-ins
- Verified Carrier service-time tracking, ready checks and progress preservation
- `/pot calculate` weapon potential calculator using either manual figures or local vision screenshot reading
- Carrier profiles, ratings, permissions and leaderboard
- Marketplace, trade reputation, reports and disputes
- Treasury loans, donations, trust and stock management
- Staff Operations Hub and integrated moderation/security tooling
- Local AI support through Ollama so core AI features do not require paid OpenAI usage

### Weapon Pot Calculator

`/pot calculate` uses the Tavern rule:

`potential = current power + (remaining upgrades × 10)`

Manual examples:

- `current:25340 upgrades:34/120` — 34 upgrades applied out of 120 total
- `current:25340 upgrades:86` — 86 upgrades remaining
- `current:1.25m upgrades:100 remaining`

If applied and total upgrades are known, the bot also reconstructs the clean/base weapon power and cross-checks the final result. A screenshot can be attached instead; the bot uses `POT_VISION_MODEL` (falling back to the configured local vision model) and refuses low-confidence image reads instead of guessing.
