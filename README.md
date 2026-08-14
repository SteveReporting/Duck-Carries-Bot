# The Carry Tavern Discord Queue Bot

A Discord.js bot built for The Carry Tavern, a Roblox Dungeon Quest carry community. It combines the existing carry queue with an optional AI server-management layer that can inspect the guild and perform tightly controlled Discord changes.

## What it does

- `/setup` configuration for server queue channels
- Button-driven carry request flow
- Discord modal collecting Roblox username, dungeon, difficulty, run count and availability
- Persistent SQLite queue storage
- Role-gated carrier claiming
- Automatic DM notification when a carrier claims a request
- Completion tracking and per-carrier statistics
- Lightweight Express health endpoint for cloud hosting
- `/ai ask` for server-aware AI help without making changes
- `/ai audit` for read-only inspection of channels, roles, permission overwrites and webhooks
- `/ai fix` for safe, non-destructive Discord changes
- Optional AI action logging to a staff channel

## AI manager safeguards

The AI manager does not receive a Discord user token and cannot execute arbitrary Discord API calls. It only receives the specific functions exposed in `ai/discordTools.js`.

Current write tools can:

- create categories and text channels
- rename and move channels
- create and rename manageable roles
- update a safe subset of channel/role permission overwrites
- create webhooks
- send messages through webhooks owned/visible to the bot

The tool layer intentionally does **not** expose channel deletion, role deletion, kick, ban, mass DM, Administrator assignment, Manage Server assignment, Manage Roles assignment, token retrieval or arbitrary code execution.

`/ai fix` is restricted to the server owner, Discord administrators, or members with `AI_MANAGER_ROLE_ID`.

## Tech stack

- Node.js 18+
- Discord.js v14
- better-sqlite3
- Express
- dotenv
- OpenAI Responses API

## Architecture

```text
Carry-Tavern-Bot/
├── ai/
│   ├── agent.js          OpenAI Responses API + tool loop
│   └── discordTools.js   Allow-listed Discord read/write actions
├── commands/             Slash commands, including /ai
├── database/             SQLite initialization and persistence
├── events/               Discord interaction/event handlers
├── deploy-commands.js    Guild command deployment
├── index.js              Bot bootstrap + health endpoint
└── package.json
```

## Queue flow

1. A member opens the carry-request modal.
2. The request is saved to SQLite.
3. A formatted queue message is posted and the carrier role is notified.
4. An authorized carrier claims the request.
5. The member is notified by DM.
6. Completed carries are removed from the live queue and recorded in carrier stats.

## AI commands

```text
/ai ask prompt:<question>
/ai audit focus:<optional area>
/ai fix prompt:<requested change>
```

Examples:

```text
/ai ask prompt:Which roles can manage channels?
/ai audit focus:staff permissions and webhooks
/ai fix prompt:Create a Carry Logs category with a completed-carries text channel
/ai fix prompt:Rename the old duck-announcements channel to tavern-announcements
```

## Environment variables

Copy `.env.example` to `.env` and supply your own values:

```env
TOKEN=
CLIENT_ID=
GUILD_ID=
CARRIER_ROLE=
PORT=3000

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6
OPENAI_REASONING_EFFORT=low
AI_MANAGER_ROLE_ID=
AI_AUDIT_CHANNEL_ID=
AI_MAX_TOOL_ROUNDS=8
```

`AI_MANAGER_ROLE_ID` is optional if only the server owner/Administrators should use AI management. `AI_AUDIT_CHANNEL_ID` is optional; when set, successful AI write actions are logged there.

Never commit the real `.env` file. It is excluded by `.gitignore`.

## Required Discord bot permissions

The bot only needs permissions for actions you want the AI manager to perform. Typical permissions are:

- View Channels
- Send Messages
- Read Message History
- Manage Channels
- Manage Roles
- Manage Webhooks

Do not give the bot Administrator unless you independently need it for something else. Its highest role must still sit above any role you expect `/ai fix` to rename or edit.

## Local setup

```bash
npm install
npm run deploy
npm start
```

Run `npm run deploy` after pulling the AI branch so Discord receives the new `/ai` command.

## Hosting setup

Add the same environment variables to the hosting provider that currently runs the bot. The OpenAI key belongs in the host's secret/environment settings, not in GitHub.

## Portfolio notes

This project demonstrates Discord API integration, event-driven Node.js code, SQL persistence, role-based permissions, modal/button workflows, OpenAI tool calling, controlled external actions and deployment-oriented health checking. Community-specific IDs and credentials are kept outside source control.
