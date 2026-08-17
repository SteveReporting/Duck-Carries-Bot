# Project Sentient - Cloudflare Worker

This is the Cloudflare-native Project Sentient director. It is intentionally isolated from the main Carry Tavern bot.

## Architecture

- Cloudflare Worker: private control panel and API.
- Cloudflare Workflow: durable multi-hour story timeline.
- Discord REST API: sends messages as the dedicated `[ERR_] Th3_B4rt3nd3r` bot.
- No Discord Gateway connection is required for the scripted timeline.
- Passive AI replies and ArcaneAPP message detection are a later Gateway/Durable Object layer.

## Safe test mode

`test` runs the remaining story in about one minute in the configured test channels.

The finale writes `@everyone they're here.` but cannot actually ping everyone unless BOTH:

1. the Workflow is explicitly started with `live: true`, and
2. `SENTIENT_LIVE_ARMED=true` exists in the Worker environment.

The web control panel always starts runs with `live: false`, so it cannot ping everyone.

## Cloudflare project

Create/import a Worker named exactly:

```text
carry-tavern-sentient
```

Connect it to:

```text
Repository: SteveReporting/Duck-Carries-Bot
Branch: agent/project-sentient-cloudflare
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
```

`SENTIENT_ADMIN_SECRET` should be a new random password only the owner knows. Do not use the Discord token as the admin secret.

Variables:

```text
SENTIENT_TAVERN_CHAT_CHANNEL_ID=
SENTIENT_IMAGES_CHANNEL_ID=
SENTIENT_CARRY_EVENTS_CHANNEL_ID=
SENTIENT_ANNOUNCEMENTS_CHANNEL_ID=
SENTIENT_TREASURY_IMAGE_URL=
SENTIENT_ARCANE_BOT_ID=
SENTIENT_ALLOW_CHANNEL_RENAMES=false
SENTIENT_AI_REPLIES=true
SENTIENT_LIVE_ARMED=false
```

For the first test, all channel IDs must point to private Sentient testing channels.

## Bot permissions for the first test

The Bartender bot needs:

- View Channel
- Send Messages
- Read Message History
- Embed Links

`Manage Channels` is only required later if `SENTIENT_ALLOW_CHANNEL_RENAMES=true` is enabled.

`Mention @everyone` is not required for private testing and should remain disabled until the live finale is intentionally armed.

## Control panel

After deployment, open the Worker's `workers.dev` URL. The root page is the Project Sentient control panel.

Enter the `SENTIENT_ADMIN_SECRET` you configured in Cloudflare.

Available controls:

- Start 60s Test
- Start Fast
- Start Normal
- Fire Watching
- Fire Vault
- Fire ERR_02
- Fire Gates
- Fire Finale without pinging
- Check Workflow status
- Pause Workflow
- Resume Workflow
- Stop Workflow

## Current story timing

### Test

- +5 seconds: Watching
- +15 seconds: Vault echo
- +25 seconds: ERR_02 signal
- +31 seconds: Bartender warning
- +46 seconds: Gates
- +66 seconds: Finale

### Fast

- +5 minutes: Watching
- +35 minutes: Vault echo
- +90 minutes: ERR_02 signal
- +~90 minutes: Bartender warning after six seconds
- +3 hours: Gates
- +5 hours: Finale

### Normal

- +30 minutes: Watching
- +3 hours: Vault echo
- +7 hours: ERR_02
- +12 hours: Gates
- +18 hours: Finale

## Not included yet

The first Cloudflare build does not yet listen to every normal Discord message. Therefore these are not active yet:

- Bartender passively noticing members talking about him
- AI improvisation in normal chat
- ArcaneAPP level-up interception

Those require a Discord Gateway listener. The planned Cloudflare-native implementation is a Durable Object/WebSocket gateway layer. The `SENTIENT_ARCANE_BOT_ID` and `SENTIENT_AI_REPLIES` variables can stay configured now for that next layer.
