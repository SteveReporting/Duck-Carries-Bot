# Carry Tavern × Project SENTIENT integration

The active Carry Tavern Discord bot now acts as a native Discord/perception surface for the existing Project SENTIENT control plane.

## Safety snapshot

Before this integration, the exact pre-SENTIENT `main` state was preserved as:

```text
backup/pre-sentient-2026-09-05
```

That branch should remain frozen as the rollback point.

## Architecture

```text
Discord members / staff
        |
        v
The Carry Tavern bot (existing Discord identity)
        |
        +-- existing queue / Carrier / Treasury / ticket / marketplace / security systems
        |
        +-- native SENTIENT bridge
                |
                v
      private sentient-control
        127.0.0.1:3000
          /      |       \
         /       |        \
   databank  intelligence  governance / CITADEL
      |          |             |
      |          |             +-- approval-gated recovery
      |          +-- memory / archive / knowledge / simulation / local AI
      +-- tenant-scoped Supabase state
                |
                +-- existing autonomy + recovery workers
                +-- Cloudflare Project Sentient / Bartender control proxy
```

The bridge deliberately **does not launch a second Discord gateway**. The existing Carry Tavern bot stays the Discord identity, while `sentient-control` remains the private source of truth for intelligence, memory, governance and recovery.

## What is integrated

The native bridge sends tenant-scoped operational observations into Project SENTIENT and exposes the backend through `/sentient`.

Available command surface:

- `/sentient ask` — tenant-scoped SENTIENT/local intelligence
- `/sentient status` — reports and deterministic carry-dispatch suggestions
- `/sentient health` — Carry bot bridge, private control plane and Cloudflare Sentient health
- `/sentient capabilities` — integration/capability map
- `/sentient memory` — durable guild memory search
- `/sentient archive` — archive search
- `/sentient knowledge` — guild/shared knowledge search
- `/sentient simulate` — deterministic what-if simulation
- `/sentient citadel` — CITADEL policy and live governed-action/incident counts
- `/sentient remember` — explicit staff memory write (Manage Server)
- `/sentient snapshot` — Discord structure snapshot (Manage Server)
- `/sentient autonomy` — autonomic analysis (Manage Server)
- `/sentient incidents` — open incidents (Manage Server)
- `/sentient actions` — pending governed actions (Manage Server)
- `/sentient decide` — submit an approval/denial to the existing CITADEL quorum (Manage Server)
- `/sentient setup` — safe create-only SENTIENT bootstrap (Manage Server)

Existing Carry Tavern carry queues, tickets, Treasury, marketplace, carrier systems and security remain authoritative. SENTIENT coordinates and learns from those systems rather than replacing working production flows with duplicate implementations.

## Passive event perception

The runtime can observe:

- command/button/modal/select interactions (metadata, not option values)
- member joins/leaves
- role/channel/guild structure changes
- sampled message metadata
- member mention graph edges
- startup/periodic health
- Discord structure snapshots

Message content capture is disabled by default. With `SENTIENT_CAPTURE_MESSAGE_CONTENT=false`, SENTIENT receives message identifiers, author/channel IDs, attachment count and mentions but not the message text.

## Activation

Copy the variables from `.env.sentient.example` into the existing Carry Tavern bot host `.env`.

At minimum:

```text
SENTIENT_INTEGRATION_ENABLED=true
SENTIENT_CONTROL_BASE_URL=http://127.0.0.1:3000
SENTIENT_ADMIN_SECRET=<same private secret used by sentient-control>
```

Do **not** commit the real admin secret. If the bot and control plane are on the same VM, keep the control plane on loopback rather than exposing port 3000 publicly.

Then refresh the bot and slash-command registration:

```bash
cd ~/Duck-Carries-Bot
git pull
npm install
npm run deploy
pm2 restart carry-tavern
```

Useful checks in Discord:

```text
/sentient health
/sentient capabilities
/sentient status
```

## Failure behaviour

The integration is fail-open for ordinary Tavern features: if SENTIENT is disabled, the admin secret is missing, or the private control plane is temporarily unavailable, queue/Treasury/marketplace/tickets/moderation continue to operate.

The SENTIENT side remains fail-closed for consequential governed actions. CITADEL approval/quorum rules and the recovery allowlist remain enforced by the private control plane; the Discord command cannot bypass them.

## Rollback

The repository can be compared or restored against:

```text
backup/pre-sentient-2026-09-05
```

Do not delete that branch while the integration is being validated in production.
