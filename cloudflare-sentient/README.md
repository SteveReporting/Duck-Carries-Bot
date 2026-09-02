# Project Sentient - Cloudflare Worker

This is the Cloudflare-native Project Sentient director and optional live Discord Gateway layer.

## Architecture

- Cloudflare Worker: private control panel and API.
- Cloudflare Workflow: durable multi-hour story timeline.
- Discord REST API: sends messages as the dedicated `[ERR_] Th3_B4rt3nd3r` bot.
- Durable Object + Discord Gateway: optional live Bartender conversation layer.
- Local Ollama on the Carry Tavern bot host: free AI inference for live replies.
- Authenticated local-AI proxy + Cloudflare Tunnel/HTTPS route: connects the Worker back to Ollama without exposing Ollama itself.

## Cloudflare project

Create/import a Worker named exactly:

```text
carry-tavern-sentient
```

Use:

```text
Repository: SteveReporting/Duck-Carries-Bot
Branch: main
Root directory: cloudflare-sentient
Deploy command: npx wrangler deploy
```

Cloudflare requires the dashboard Worker name to match the `name` in `wrangler.jsonc` for Git-connected deployments.

## Runtime secrets

Add these under Worker > Settings > Variables and Secrets.

Secrets:

```text
SENTIENT_BARTENDER_TOKEN
SENTIENT_ADMIN_SECRET
LOCAL_AI_API_KEY
```

`SENTIENT_ADMIN_SECRET` should be a new random password only the owner knows. `LOCAL_AI_API_KEY` must match `LOCAL_AI_PROXY_SECRET` on the bot host. Do not reuse a Discord token for either secret.

Variables:

```text
SENTIENT_GUILD_ID=
SENTIENT_TAVERN_CHAT_CHANNEL_ID=
SENTIENT_AI_CHANNEL_IDS=
SENTIENT_IMAGES_CHANNEL_ID=
SENTIENT_CARRY_EVENTS_CHANNEL_ID=
SENTIENT_ANNOUNCEMENTS_CHANNEL_ID=
SENTIENT_TREASURY_IMAGE_URL=
SENTIENT_ARCANE_BOT_ID=
SENTIENT_ALLOW_CHANNEL_RENAMES=false
SENTIENT_AI_REPLIES=true
SENTIENT_SPONTANEOUS_REPLIES=true
SENTIENT_LIVE_ARMED=false
LOCAL_AI_BASE_URL=https://<your-ai-hostname>/v1
SENTIENT_AI_MODEL=qwen3:8b
```

The `LOCAL_AI_BASE_URL` hostname should route to the authenticated proxy on the bot VM, not directly to Ollama port `11434`. See `../docs/free-local-ai.md`.

## Live Bartender behavior

The live Bartender retains its existing public-conversation personality and owner controls. Toothless is established as its creator, with a deliberate recurring memory fault: it emotionally expects Toothless to still be around, periodically asks where he is, can be told that he left/is gone, briefly processes that answer, and later forgets it again.

## Safe story controls

The finale writes `@everyone they're here.` but cannot actually ping everyone unless BOTH:

1. the Workflow is explicitly started with `live: true`, and
2. `SENTIENT_LIVE_ARMED=true` exists in the Worker environment.

The control panel starts ordinary runs without silently arming an everyone ping.

## Bot permissions

The Bartender bot needs:

- View Channel
- Send Messages
- Read Message History
- Embed Links

`Manage Channels` is only required if `SENTIENT_ALLOW_CHANNEL_RENAMES=true` is enabled.

## Control panel

After deployment, open the Worker's URL and enter `SENTIENT_ADMIN_SECRET`.

Available controls include:

- Start / stop / inspect live Bartender AI
- Start Fast / Normal story workflows
- Fire manual story scenes
- Check Workflow status
- Pause / resume / stop a Workflow

The live AI health endpoint now checks `LOCAL_AI_BASE_URL` rather than requiring an OpenAI API key.
