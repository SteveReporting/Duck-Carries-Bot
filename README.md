# The Carry Tavern Discord Bot

A Discord.js bot for The Carry Tavern Dungeon Quest community. It includes the carry queue, carrier statistics, automated carry voice sessions, weapon potential calculation, Treasury loans/trust tracking, private Treasury tickets, Project Sentient, integrated security, and a locally hosted AI server manager.

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
