# Free Local AI Setup

The Carry Tavern bot no longer needs paid OpenAI API calls. AI features run against a local Ollama server by default.

This keeps the existing AI surfaces available:

- `/ai ask`, `/ai audit`, `/ai fix`
- `/botfix` diagnosis, tool use, source editing, validation and push flow
- Integrated anti-raid AI analysis
- Project Sentient / Bartender live replies
- Best-effort free web context for repair-agent error research

## 1. Install Ollama on the bot host

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
ollama -v
```

## 2. Pull the local models

Default text/tool model:

```bash
ollama pull qwen3:8b
```

Vision model used by the security analyst for image attachments:

```bash
ollama pull qwen3-vl:8b
```

If the host is short on RAM, you can use smaller tags such as `qwen3:4b` and `qwen3-vl:4b`, then change the matching environment values. Larger models can improve `/botfix` reasoning but need substantially more memory.

## 3. Configure the bot

Add/update these values in `.env`:

```env
LOCAL_AI_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_AI_MODEL=qwen3:8b
LOCAL_AI_API_KEY=ollama
LOCAL_AI_TIMEOUT_MS=120000
AI_MANAGER_MODEL=qwen3:8b
SENTIENT_AI_MODEL=qwen3:8b
SECURITY_AI_MODEL=qwen3-vl:8b
```

`OPENAI_API_KEY` is not required. Legacy modules that still use the old OpenAI Responses shape are intercepted inside the bot process and translated to Ollama locally.

## 4. Optional: Cloudflare-hosted Sentient live gateway

The normal Node bot can use Ollama directly on localhost. The Cloudflare Worker cannot reach the VM's localhost, so the repo includes an authenticated loopback proxy for the Worker.

Generate a dedicated secret:

```bash
openssl rand -hex 32
```

Set it on the bot host:

```env
LOCAL_AI_PROXY_SECRET=<generated-secret>
LOCAL_AI_PROXY_HOST=127.0.0.1
LOCAL_AI_PROXY_PORT=11435
```

Restart the bot. The proxy will listen only on `127.0.0.1:11435`.

Publish that loopback service through a Cloudflare Tunnel or another HTTPS route. Point the route to:

```text
http://127.0.0.1:11435
```

Then set these Worker variables/secrets:

```text
LOCAL_AI_BASE_URL=https://<your-private-ai-hostname>/v1
LOCAL_AI_API_KEY=<same generated secret>
SENTIENT_AI_MODEL=qwen3:8b
```

The proxy rejects requests without the exact bearer secret and only exposes the local chat-completions route plus an authenticated health endpoint. Do not expose Ollama's native port `11434` directly to the public Internet.

## 5. Restart and verify

```bash
cd ~/Duck-Carries-Bot
npm install
pm2 restart carry-tavern
pm2 logs carry-tavern --lines 100
```

Expected startup lines include:

```text
OpenAI Responses compatibility redirected to local Ollama.
Local AI proxy listening on http://127.0.0.1:11435
```

The proxy line only appears when `LOCAL_AI_PROXY_SECRET` is configured.

Quick local model check:

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3:8b","messages":[{"role":"user","content":"Reply with: Tavern local AI online"}],"stream":false}'
```

## Bartender creator-memory behavior

Toothless remains established as the Bartender's creator, but the Bartender has a deliberate recurring memory fault around his departure. It can be told that Toothless left or is gone, briefly react to that information, and later behave as though it has forgotten again. Some spontaneous interruptions are specifically biased toward asking where Toothless is so the behavior continues over time instead of appearing only once.
