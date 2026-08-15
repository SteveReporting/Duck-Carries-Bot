# The Carry Tavern Discord Bot

A Discord.js bot for The Carry Tavern Dungeon Quest community. It includes the carry queue, carrier statistics, Treasury loans/trust tracking, private Treasury tickets, and an OpenAI-powered Discord server manager.

## Features

- `/setup` carry queue configuration
- Button + modal carry requests
- Carrier claiming and completion tracking
- Persistent SQLite storage
- `/leaderboard`, `/queue`, `/stats`, `/panel`
- Treasury borrowing, donations, Trust Scores and overdue monitoring
- `/treasury-setup` and `/treasury-admin`
- `/ai ask`, `/ai audit`, `/ai fix`
- Controlled AI Discord tools for channels, roles, permissions and webhooks

## Runtime

- Node.js 20+
- Discord.js v14
- better-sqlite3
- OpenAI Responses API
- PM2 recommended on Oracle Cloud

There is no web server or health endpoint. The bot runs as a normal long-lived Discord process.

## Structure

```text
Carry-Tavern-Bot/
├── ai/
│   ├── agent.js
│   └── discordTools.js
├── commands/
├── database/
│   └── database.js
├── events/
├── treasury/
├── deploy-commands.js
├── ecosystem.config.js
├── index.js
└── package.json
```

## Environment

Copy `.env.example` to `.env` and fill in the values on the host:

```env
TOKEN=
CLIENT_ID=
GUILD_ID=
CARRIER_ROLE=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6
OPENAI_REASONING_EFFORT=low
AI_MANAGER_ROLE_ID=
AI_AUDIT_CHANNEL_ID=
AI_MAX_TOOL_ROUNDS=3
```

Never commit the real `.env` file.

## Oracle Cloud setup

On the VM:

```bash
git clone https://github.com/SteveReporting/Duck-Carries-Bot.git
cd Duck-Carries-Bot
npm install
cp .env.example .env
nano .env
```

Deploy slash commands once after command structure changes:

```bash
npm run deploy
```

Install PM2 and start the bot:

```bash
sudo npm install -g pm2
npm run pm2:start
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then run:

```bash
pm2 save
```

Useful commands:

```bash
pm2 status
pm2 logs carry-tavern
pm2 restart carry-tavern
```

## Updating the bot on Oracle

```bash
cd Duck-Carries-Bot
git pull
npm install
pm2 restart carry-tavern
```

Only run `npm run deploy` again when slash-command definitions change.

## SQLite

Runtime data is stored in `database/duck.db`. The database uses WAL mode and a busy timeout for safer long-running VM use. Database files are ignored by Git so server data is not overwritten by `git pull`.

Back up `database/duck.db` before major changes.

## AI manager safeguards

`/ai fix` can only perform actions exposed by `ai/discordTools.js`. The tool layer intentionally does not expose arbitrary code execution, token retrieval, kick/ban, mass DMs, deletion, Administrator assignment, Manage Server assignment or Manage Roles assignment.

AI tool calls have timeouts so one stalled Discord operation does not leave the whole command hanging indefinitely. Failed tool actions are reported back to the AI so independent safe actions can continue.

## Discord permissions

Give the bot only the permissions required for the features you use, normally including:

- View Channels
- Send Messages
- Read Message History
- Manage Channels
- Manage Roles
- Manage Webhooks

The bot's Discord role must sit above roles it needs to manage.
