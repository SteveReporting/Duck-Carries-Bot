# Westy — standalone Discord AI

Westy is a second standalone deployment of the live Bartender gateway architecture for Discord application `1545579363754451005`.

It deliberately does **not** include the old Saellie/sleepless/owner-love-interest priority system. No member receives romantic or lover-specific commands, ignore powers, cooldown bypasses, or relationship-context injection.

## What was copied

- Direct replies when Westy is mentioned or replied to
- Spontaneous in-channel replies
- Public channel conversation memory
- Discord nickname-aware responses
- Typing indicator
- Global and per-user cooldowns
- Persistent Discord Gateway session/resume state
- Automatic reconnect handling
- Owner-only `/off`, `/on`, `/status`, and owner-login controls
- Web control panel
- Health/diagnostics endpoints
- The same standalone free-AI route as Bartender: Cloudflare Workers AI first, with an optional OpenAI-compatible local endpoint fallback

## Required Discord settings

In the Discord Developer Portal for application `1545579363754451005`, enable **Message Content Intent**. The bot also needs permission to view the chosen channel(s), read message history, and send messages.

## Cloudflare secrets / variables

Set these before starting Westy:

```bash
cd cloudflare-westy
npm install
npx wrangler secret put WESTY_BOT_TOKEN
npx wrangler secret put WESTY_ADMIN_SECRET
npx wrangler secret put WESTY_GUILD_ID
npx wrangler secret put WESTY_AI_CHANNEL_IDS
```

`WESTY_AI_CHANNEL_IDS` is a comma-separated list of Discord channel IDs.

Optional:

```bash
npx wrangler secret put WESTY_OWNER_IDS
npx wrangler secret put WESTY_OWNER_PASSWORD
```

If `WESTY_OWNER_IDS` is omitted, the existing primary owner ID used by Bartender is the fallback. The default owner-login password is `Toothless` unless overridden.

## Deploy

```bash
cd cloudflare-westy
npm install
npm run deploy
```

Open the Worker URL, enter `WESTY_ADMIN_SECRET`, then press **Start**.

## Owner controls in Discord

```text
westy /ownerlogin Toothless
westy /off
westy /on
westy /status
```

## Cost model

No OpenAI API key is required. The Worker is bound to Cloudflare Workers AI in `wrangler.jsonc`, matching the current standalone Bartender architecture. A local Ollama/OpenAI-compatible endpoint can also be supplied with `LOCAL_AI_BASE_URL` if desired.
