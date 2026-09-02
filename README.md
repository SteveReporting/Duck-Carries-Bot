# The Carry Tavern Discord Bot

A Discord.js bot for The Carry Tavern Dungeon Quest community. It includes the carry queue, carrier statistics, Treasury loans/trust tracking, private Treasury tickets, Project Sentient, integrated security, and a locally hosted AI server manager.

## Features

- `/setup` carry queue configuration
- Button + modal carry requests
- Carrier claiming and completion tracking
- Persistent SQLite storage
- `/leaderboard`, `/queue`, `/stats`, `/panel`
- Treasury borrowing, donations, Trust Scores and overdue monitoring
- `/treasury-setup` and `/treasury-admin`
- `/ai ask`, `/ai audit`, `/ai fix`
- `/botfix` runtime diagnosis and guarded source repair
- Integrated anti-raid AI analysis
- Project Sentient / Bartender live replies
- Controlled AI Discord tools for channels, roles, permissions and webhooks

## Runtime

- Node.js 20+
- Discord.js v14
- better-sqlite3
- Ollama local AI by default
- PM2 recommended on Oracle Cloud

The normal bot runs as a long-lived Discord process. The optional Project Sentient Cloudflare Worker can connect back to the same local AI through the authenticated proxy included in this repository.

## Structure

```text
Carry-Tavern-Bot/
├── ai/
│   ├── agent.js
│   ├── localChat.js
│   ├── localResponses.js
│   ├── openAiCompatPreload.js
│   └── discordTools.js
├── cloudflare-sentient/
├── commands/
├── database/
│   └── database.js
├── docs/
│   └── free-local-ai.md
├── events/
├── platform/
│   └── localAiProxy.js
├── sentient/
├── treasury/
├── deploy-commands.js
├── ecosystem.config.js
├── index.js
└── package.json
```

## Environment

Copy `.env.example` to `.env` and fill in the values on the host. AI now defaults to Ollama on localhost:

```env
TOKEN=
CLIENT_ID=
GUILD_ID=
CARRIER_ROLE=

LOCAL_AI_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_AI_MODEL=qwen3:8b
LOCAL_AI_API_KEY=ollama
AI_MANAGER_MODEL=qwen3:8b
SENTIENT_AI_MODEL=qwen3:8b
SECURITY_AI_MODEL=qwen3-vl:8b
AI_MANAGER_ROLE_ID=
AI_AUDIT_CHANNEL_ID=
```

`OPENAI_API_KEY` is not required for the bot's AI features. See [`docs/free-local-ai.md`](docs/free-local-ai.md) for the Ollama and optional Cloudflare Tunnel setup.

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

Install Ollama and pull the default models:

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
ollama pull qwen3:8b
ollama pull qwen3-vl:8b
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

## Local AI compatibility

The main AI manager talks directly to Ollama. Older modules that were originally written against the OpenAI Responses API are intercepted by `ai/openAiCompatPreload.js` and translated to the local OpenAI-compatible Ollama API without sending the request to OpenAI.

The compatibility layer retains multi-round function/tool calls, generates stable tool-call IDs when a local model omits them, supports vision input for the security analyst, and provides best-effort free web context for repair-agent error research.

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
