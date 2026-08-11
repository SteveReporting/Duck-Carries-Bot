# Duck Carries Discord Queue Bot

A Discord.js queue-management bot built for a Roblox Dungeon Quest carry community. It turns free-form carry requests into a structured workflow that members and carriers can manage inside Discord.

## What it does

- `/setup` configuration for server queue channels
- Button-driven carry request flow
- Discord modal collecting Roblox username, dungeon, difficulty, run count and availability
- Persistent SQLite queue storage
- Role-gated carrier claiming
- Automatic DM notification when a carrier claims a request
- Completion tracking and per-carrier statistics
- Lightweight Express health endpoint for cloud hosting

## Tech stack

- Node.js
- Discord.js v14
- better-sqlite3
- Express
- dotenv

## Architecture

```text
Duck-Carries-Bot/
├── commands/             Slash commands
├── database/             SQLite initialization and persistence
├── events/               Discord interaction/event handlers
├── deploy-commands.js    Guild command deployment
├── index.js              Bot bootstrap + health endpoint
└── package.json
```

The bot separates command registration, event handling and persistence rather than keeping the entire application in one file.

## Queue flow

1. A member opens the carry-request modal.
2. The request is saved to SQLite.
3. A formatted queue message is posted and the carrier role is notified.
4. An authorized carrier claims the request.
5. The member is notified by DM.
6. Completed carries are removed from the live queue and recorded in carrier stats.

## Environment variables

Copy `.env.example` to `.env` and supply your own values:

```env
TOKEN=
CLIENT_ID=
GUILD_ID=
CARRIER_ROLE=
PORT=3000
```

Never commit the real `.env` file. It is excluded by `.gitignore`.

## Local setup

```bash
npm install
npm run deploy
npm start
```

## Portfolio notes

This project demonstrates Discord API integration, event-driven Node.js code, SQL persistence, role-based permissions, modal/button workflows and deployment-oriented health checking. Community-specific IDs and credentials are kept outside source control.