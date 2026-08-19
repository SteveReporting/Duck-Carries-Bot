# Carry Tavern Sentient Worker

This directory is the Cloudflare Worker project used by the `carry-tavern-sentient` Workers Builds integration.

The Discord bot itself remains a long-running Node.js process and is not hosted inside Cloudflare Workers.

Endpoints:

- `/` - Project Sentient edge landing page
- `/health` - plain-text health check
- `/api/status` - JSON edge status

Production deploy command: `npx wrangler deploy`
Preview/non-production deploy command: `npx wrangler versions upload`
