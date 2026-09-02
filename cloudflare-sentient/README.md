# Project Sentient - Cloudflare Worker

This is the Cloudflare-native Project Sentient director and live Discord layer. The Bartender and ERR_02 are independent of the main Carry Tavern bot.

## Architecture

- Cloudflare Worker: private control panel and API.
- Cloudflare Workflow: durable multi-hour story timeline.
- Bartender Durable Object + Discord Gateway: listens to server messages and handles live conversation/owner controls using `SENTIENT_BARTENDER_TOKEN`.
- ERR_02: does **not** need its own Gateway listener or Message Content intent. The Bartender gateway is its control plane and Cloudflare sends ERR_02 messages directly through Discord REST using `SENTIENT_ERR02_TOKEN`.
- Local Ollama on the AI host: free AI inference for Bartender replies.
- Authenticated local-AI proxy + Cloudflare Tunnel/HTTPS route: connects the Worker back to Ollama without exposing Ollama itself.

`Duck Carries Bot#4530` is not required for either character to remain in the server or send their messages.

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
SENTIENT_ERR02_TOKEN
SENTIENT_ADMIN_SECRET
LOCAL_AI_API_KEY
```

`SENTIENT_BARTENDER_TOKEN` is the token for the standalone Bartender application. `SENTIENT_ERR02_TOKEN` is the token for the standalone ERR_02 application. Both applications must themselves be members of the Discord server.

`SENTIENT_ADMIN_SECRET` should be a new random password only the owner knows. `LOCAL_AI_API_KEY` must match `LOCAL_AI_PROXY_SECRET` on the AI host. Do not reuse a Discord token for either of those secrets.

Variables:

```text
SENTIENT_GUILD_ID=
SENTIENT_TAVERN_CHAT_CHANNEL_ID=
SENTIENT_SIGNAL_02_CHANNEL_ID=
SENTIENT_CORE_CHANNEL_ID=
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

The `LOCAL_AI_BASE_URL` hostname should route to the authenticated proxy on the AI host, not directly to Ollama port `11434`. See `../docs/free-local-ai.md`.

## Independent owner controls

The Bartender gateway listens for both character control syntaxes. Only the configured owner Discord account can use them.

Bartender:

```text
bartender /ownerlogin Toothless
bartender /off
bartender /on
bartender /status
```

ERR_02:

```text
err02 /ownerlogin Toothless
err02 /off
err02 /on
err02 /status
```

The ERR_02 switch is persisted inside the same Durable Object used by the Bartender gateway. Every Cloudflare ERR_02 scene checks this switch before sending. If the switch cannot be read, ERR_02 fails closed and does not send.

Messages that look like owner-control commands from anybody other than the owner are swallowed rather than treated as character prompts.

## Live Bartender behavior

The live Bartender retains its public-conversation personality and owner controls. Toothless is established as its creator, with a deliberate recurring memory fault: it emotionally expects Toothless to still be around, periodically asks where he is, can be told that he left/is gone, briefly processes that answer, and later forgets it again.

## Safe story controls

ERR_02 scenes require `SENTIENT_ERR02_TOKEN`; there is no webhook impersonation fallback for ERR_02. Story startup refuses to begin when the dedicated ERR_02 token or required story channels are missing.

The finale writes `@everyone they're here.` but cannot actually ping everyone unless BOTH:

1. the Workflow is explicitly started with `live: true`, and
2. `SENTIENT_LIVE_ARMED=true` exists in the Worker environment.

The control panel starts ordinary runs without silently arming an everyone ping.

## Bot permissions

The Bartender application needs:

- View Channel
- Send Messages
- Read Message History
- Embed Links

The ERR_02 application only needs access to the channels where its scenes are sent:

- View Channel
- Send Messages
- Read Message History

ERR_02 does not need Message Content intent because it does not listen to Discord messages.

`Manage Channels` is only required for the Bartender if `SENTIENT_ALLOW_CHANNEL_RENAMES=true` is enabled.

## Deploy

From the repository root on a machine with Wrangler authenticated:

```bash
cd cloudflare-sentient
npm install
npx wrangler deploy
```

If Cloudflare Git deployment is configured for `main`, merging the change to `main` can deploy automatically instead.

After deployment, check:

```text
https://<your-worker>/health
```

The health response should show the Bartender token, ERR_02 token, Durable Object binding, story channels, and local AI route as configured.

## Control panel

After deployment, open the Worker's URL and enter `SENTIENT_ADMIN_SECRET`.

Available controls include:

- Start / stop / inspect live Bartender AI
- Start Fast / Normal story workflows
- Fire manual story scenes
- Check Workflow status
- Pause / resume / stop a Workflow

The live AI health endpoint checks the local AI route rather than requiring an OpenAI API key.
