# Project Sentient

Project Sentient is the hidden ARG/event director for The Carry Tavern. Day 1 is assumed to have already happened manually.

## What this first build does

- Persists event progress in the existing SQLite database.
- Runs a FAST remaining timeline in about 5 hours or NORMAL in about 18 hours.
- Lets the server owner secretly force, pause, resume, restore or stop the event.
- Uses a separate Bartender bot when `SENTIENT_BARTENDER_TOKEN` is configured.
- Falls back to bot-owned webhooks/system messages if the separate Bartender bot is unavailable.
- Gives the Bartender heavily limited AI replies with global and per-user cooldowns.
- Watches for one ArcaneAPP level-up and briefly posts `He sees you climbing.`
- Runs the vault echo, ERR_02, breach and `@everyone they're here.` finale scenes.
- Can temporarily rename the Tavern chat channel during the breach, but this is disabled by default and is restored automatically.

## Important account rule

`SENTIENT_BARTENDER_TOKEN` must be a Discord bot/application token. Never place a normal Discord user account token in the bot environment.

## Required environment values

```env
SENTIENT_TAVERN_CHAT_CHANNEL_ID=
SENTIENT_ANNOUNCEMENTS_CHANNEL_ID=
```

`SENTIENT_ANNOUNCEMENTS_CHANNEL_ID` can be omitted when the existing `ANNOUNCEMENT_CHANNEL_ID` already points to the correct public announcements channel.

Recommended:

```env
SENTIENT_OWNER_IDS=
SENTIENT_IMAGES_CHANNEL_ID=
SENTIENT_CARRY_EVENTS_CHANNEL_ID=
SENTIENT_BARTENDER_TOKEN=
SENTIENT_BARTENDER_AVATAR_URL=
SENTIENT_TREASURY_IMAGE_URL=
SENTIENT_ARCANE_BOT_ID=
SENTIENT_AI_REPLIES=true
SENTIENT_ALLOW_CHANNEL_RENAMES=false
SENTIENT_WEBHOOK_FALLBACK=true
```

The main Tavern bot needs Send Messages and Read Message History in the story channels. Webhook fallback additionally needs Manage Webhooks. The optional channel rename effect needs Manage Channels.

The separate Bartender bot only needs View Channel, Send Messages and Read Message History in the public story channels. It needs Mention Everyone in announcements if the final `@everyone` should actually ping.

## Hidden owner controls

These are normal messages, not slash commands. The director immediately tries to delete the control message and sends the result to the owner by DM.

```text
!sentient start fast
!sentient start normal
!sentient status
!sentient next
!sentient scene watching
!sentient scene vault_echo
!sentient scene second_signal
!sentient scene breach
!sentient scene finale
!sentient pause
!sentient resume
!sentient restore
!sentient stop
```

## FAST timeline

From the moment `!sentient start fast` is used:

1. +5 minutes: Bartender posts `You lot went back to talking rather quickly.`
2. +35 minutes: treasury/vault echo.
3. +90 minutes: `[ERR_02] hello?` followed by the Bartender saying `Don't answer it.`
4. +3 hours: breach scene and `THE GATES ARE OPEN.`
5. +5 hours: announcements finale, `@everyone they're here.`

The level-up glitch is opportunistic and fires on the first matching ArcaneAPP level-up while the event is active.

## Finale

After the finale succeeds, the ARG director stops itself and DMs the owner to post the human `PROJECT SENTIENT` reveal. Temporary channel names are restored automatically.

Use `!sentient next` at any point if member reaction is slow and you want to accelerate the next beat manually.
