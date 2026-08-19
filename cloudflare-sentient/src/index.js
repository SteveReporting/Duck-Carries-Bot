export { SentientWorkflow } from "./workflow.js";
export { SentientGateway } from "./gateway.js";

import { sendMessageWithAttachment } from "./discord.js";
import { runManualScene } from "./scenes.js";

const TEASER_CHANNEL_ID = "1538734137391849613";
const TEASER_NONCE = "sentient-teaser-20260818";
const TEASER_TEXT = "@everyone\n\n**You really thought you could get rid of me that easily?**\n\nI tried to warn you.\n\n**It's coming.**";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function authorized(request, env) {
  if (!env.SENTIENT_ADMIN_SECRET) return false;
  return request.headers.get("Authorization") === `Bearer ${env.SENTIENT_ADMIN_SECRET}`;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function gatewayStub(env) {
  if (!env.SENTIENT_GATEWAY) throw new Error("SENTIENT_GATEWAY Durable Object binding is missing.");
  const id = env.SENTIENT_GATEWAY.idFromName("bartender-live");
  return env.SENTIENT_GATEWAY.get(id);
}

async function gatewayAction(env, action) {
  const stub = gatewayStub(env);
  const response = await stub.fetch(`https://sentient-gateway/${action}`, {
    method: action === "status" ? "GET" : "POST",
  });
  const data = await response.json().catch(() => ({ error: "Invalid gateway response" }));
  return { response, data };
}

function teaserMarkerRequest(origin) {
  return new Request(`${origin}/__sentient/teaser-sent-v1`, { method: "GET" });
}

async function readTeaserMarker(origin) {
  const cached = await caches.default.match(teaserMarkerRequest(origin));
  if (!cached) return null;
  try {
    return await cached.json();
  } catch {
    return { sent: true };
  }
}

async function writeTeaserMarker(origin, data) {
  const response = Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  await caches.default.put(teaserMarkerRequest(origin), response);
}

function adminPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Sentient</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee;max-width:760px;margin:40px auto;padding:0 18px}h1{letter-spacing:.08em}section{border:1px solid #333;border-radius:12px;padding:16px;margin:14px 0;background:#111}button,input,select{font:inherit;padding:10px 12px;margin:5px;border-radius:8px;border:1px solid #444;background:#171717;color:#eee}button{cursor:pointer}button:hover{background:#242424}button:disabled{cursor:not-allowed;opacity:.45}input{min-width:320px}input[type=file]{min-width:0;max-width:100%}pre{white-space:pre-wrap;background:#050505;padding:14px;border-radius:8px;min-height:80px}.warn{color:#ffcc66;font-weight:600}.danger{color:#ff6b6b;font-weight:700}.ok{color:#85e89d}.live{border-color:#335c42;background:#0d1711}</style>
</head>
<body>
<h1>PROJECT SENTIENT</h1>
<p class="warn">Private control surface. Live Bartender AI is separate from the vault/story timeline.</p>
<section>
<label>Admin secret<br><input id="secret" type="password" autocomplete="off" placeholder="SENTIENT_ADMIN_SECRET"></label>
</section>
<section class="live">
<h3>Live Bartender AI</h3>
<p>This only lets <strong>[ERR_] Th3_B4rt3nd3r</strong> read configured public Tavern channels, reply as a live AI character, and occasionally enter normal conversation. It does <strong>not</strong> start the vault, breach, ERR_02, finale or any timeline scene.</p>
<button onclick="liveAi('start')">START BARTENDER AI</button>
<button onclick="liveAi('stop')">STOP BARTENDER AI</button>
<button onclick="liveAi('status')">LIVE AI STATUS</button>
<p id="liveState" class="warn">Not checked.</p>
</section>
<section>
<h3>Single-use Bartender Teaser</h3>
<p>Target: <code>#something-is-coming</code> // <code>${TEASER_CHANNEL_ID}</code></p>
<p class="danger">This sends a real @everyone ping.</p>
<p>Message:</p>
<pre style="min-height:0">@everyone

You really thought you could get rid of me that easily?

I tried to warn you.

It's coming.</pre>
<label>Attach the corrupted CONTAINMENT FAILURE image<br><input id="teaserImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
<br>
<button id="teaserButton" onclick="sendTeaser()">SEND TEASER ONCE</button>
<button onclick="teaserStatus()">Check teaser status</button>
<p id="teaserState" class="warn">Not checked.</p>
</section>
<section>
<h3>Timeline</h3>
<button onclick="start('test')">Start 60s Test</button>
<button onclick="start('fast')">Start Fast</button>
<button onclick="start('normal')">Start Normal</button>
</section>
<section>
<h3>Fire One Scene</h3>
<button onclick="scene('watching')">Watching</button>
<button onclick="scene('vault_echo')">Vault</button>
<button onclick="scene('second_signal')">ERR_02</button>
<button onclick="scene('breach')">Tavern Core</button>
<button onclick="scene('finale')">Finale (no ping)</button>
</section>
<section>
<h3>Workflow Control</h3>
<input id="instance" placeholder="Workflow instance ID">
<br>
<button onclick="status()">Status</button>
<button onclick="manage('pause')">Pause</button>
<button onclick="manage('resume')">Resume</button>
<button onclick="manage('stop')">Stop</button>
</section>
<pre id="out">Ready.</pre>
<script>
const out=document.getElementById('out');
const secret=()=>document.getElementById('secret').value;
async function call(path,method='POST',payload={}){
  out.textContent='Working...';
  const r=await fetch(path,{method,headers:{'Authorization':'Bearer '+secret(),'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(payload)});
  const t=await r.text();
  try{out.textContent=JSON.stringify(JSON.parse(t),null,2)}catch{out.textContent=t}
  return r.ok;
}
async function start(pace){
  const r=await fetch('/api/start',{method:'POST',headers:{'Authorization':'Bearer '+secret(),'Content-Type':'application/json'},body:JSON.stringify({pace,live:false})});
  const data=await r.json().catch(()=>({error:'Invalid response'}));
  out.textContent=JSON.stringify(data,null,2);
  if(data.instanceId) document.getElementById('instance').value=data.instanceId;
}
function scene(name){return call('/api/scene','POST',{scene:name})}
function status(){return call('/api/status','POST',{id:document.getElementById('instance').value})}
function manage(action){return call('/api/'+action,'POST',{id:document.getElementById('instance').value})}
async function liveAi(action){
  const state=document.getElementById('liveState');
  if(!secret()){state.textContent='Enter the admin secret first.';state.className='danger';return}
  state.textContent=action==='start'?'Connecting Bartender to Discord Gateway...':action==='stop'?'Stopping live AI...':'Checking...';
  state.className='warn';
  const method=action==='status'?'GET':'POST';
  const r=await fetch('/api/live-ai/'+action,{method,headers:{'Authorization':'Bearer '+secret()}});
  const data=await r.json().catch(()=>({error:'Invalid response'}));
  out.textContent=JSON.stringify(data,null,2);
  if(!r.ok){state.textContent=data.error||'Live AI action failed.';state.className='danger';return}
  if(data.enabled){
    state.textContent=data.ready?'LIVE. Bartender is connected and listening.':'STARTED. Gateway is connecting; check status again in a few seconds.';
    state.className='ok';
  }else{
    state.textContent='OFF. Bartender live AI is silent.';
    state.className='warn';
  }
}
async function teaserStatus(){
  const state=document.getElementById('teaserState');
  const button=document.getElementById('teaserButton');
  state.textContent='Checking...';
  const r=await fetch('/api/teaser-status',{headers:{'Authorization':'Bearer '+secret()}});
  const data=await r.json().catch(()=>({error:'Invalid response'}));
  out.textContent=JSON.stringify(data,null,2);
  if(r.ok&&data.sent){
    state.textContent='SENT. This control is locked.';
    state.className='ok';
    button.disabled=true;
  }else if(r.ok){
    state.textContent='READY. Teaser has not been sent from this control.';
    state.className='warn';
    button.disabled=false;
  }else{
    state.textContent=data.error||'Could not check status.';
    state.className='danger';
  }
}
async function sendTeaser(){
  const image=document.getElementById('teaserImage').files[0];
  const state=document.getElementById('teaserState');
  const button=document.getElementById('teaserButton');
  if(!secret()){state.textContent='Enter the admin secret first.';state.className='danger';return}
  if(!image){state.textContent='Choose the CONTAINMENT FAILURE image first.';state.className='danger';return}
  if(!confirm('Send the Bartender teaser to #something-is-coming and ping @everyone RIGHT NOW?'))return;
  button.disabled=true;
  state.textContent='Sending...';
  state.className='warn';
  const form=new FormData();
  form.append('image',image,image.name);
  const r=await fetch('/api/teaser',{method:'POST',headers:{'Authorization':'Bearer '+secret()},body:form});
  const data=await r.json().catch(()=>({error:'Invalid response'}));
  out.textContent=JSON.stringify(data,null,2);
  if(r.ok){state.textContent='SENT. Teaser control locked.';state.className='ok';button.disabled=true}
  else{state.textContent=data.error||'Send failed.';state.className='danger';button.disabled=data.alreadySent===true}
}
</script>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function requiredConfig() {
  return [
    "SENTIENT_BARTENDER_TOKEN",
    "SENTIENT_ADMIN_SECRET",
    "SENTIENT_TAVERN_CHAT_CHANNEL_ID",
    "SENTIENT_TREASURY_CHANNEL_ID",
    "SENTIENT_SIGNAL_02_CHANNEL_ID",
    "SENTIENT_CORE_CHANNEL_ID",
    "SENTIENT_GATE_CHANNEL_ID",
    "SENTIENT_EVENTS_CHANNEL_ID",
    "SENTIENT_ANNOUNCEMENTS_CHANNEL_ID",
    "SENTIENT_DEBUG_CHANNEL_ID",
  ];
}

function missingConfig(env) {
  return requiredConfig().filter((key) => !env[key]);
}

function routingStatus(env) {
  return {
    chat: Boolean(env.SENTIENT_TAVERN_CHAT_CHANNEL_ID),
    treasury: Boolean(env.SENTIENT_TREASURY_CHANNEL_ID),
    signal02: Boolean(env.SENTIENT_SIGNAL_02_CHANNEL_ID),
    core: Boolean(env.SENTIENT_CORE_CHANNEL_ID),
    gate: Boolean(env.SENTIENT_GATE_CHANNEL_ID),
    events: Boolean(env.SENTIENT_EVENTS_CHANNEL_ID),
    finale: Boolean(env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID),
    debug: Boolean(env.SENTIENT_DEBUG_CHANNEL_ID),
  };
}

async function getInstance(env, id) {
  if (!id) throw new Error("Missing workflow instance ID.");
  return env.SENTIENT_WORKFLOW.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/admin") {
      return adminPage();
    }

    if (url.pathname === "/health") {
      const missing = missingConfig(env);
      return json({
        ok: missing.length === 0,
        service: "carry-tavern-sentient",
        missing,
        routing: routingStatus(env),
        channelEditing: false,
        liveArmed: String(env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true",
        liveAiConfigured: Boolean(env.SENTIENT_GATEWAY && env.OPENAI_API_KEY && (env.SENTIENT_GUILD_ID || env.GUILD_ID)),
      }, missing.length ? 503 : 200);
    }

    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    if (!authorized(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      if (url.pathname === "/api/live-ai/status" && request.method === "GET") {
        const { response, data } = await gatewayAction(env, "status");
        return json(data, response.status);
      }

      if (url.pathname === "/api/live-ai/start" && request.method === "POST") {
        const { response, data } = await gatewayAction(env, "start");
        return json(data, response.status);
      }

      if (url.pathname === "/api/live-ai/stop" && request.method === "POST") {
        const { response, data } = await gatewayAction(env, "stop");
        return json(data, response.status);
      }

      if (url.pathname === "/api/teaser-status" && request.method === "GET") {
        const marker = await readTeaserMarker(url.origin);
        return json({
          ok: true,
          sent: Boolean(marker?.sent),
          channelId: TEASER_CHANNEL_ID,
          marker: marker || undefined,
        });
      }

      if (url.pathname === "/api/teaser" && request.method === "POST") {
        const existing = await readTeaserMarker(url.origin);
        if (existing?.sent) {
          return json({
            error: "The single-use teaser has already been sent.",
            alreadySent: true,
            marker: existing,
          }, 409);
        }

        const form = await request.formData();
        const image = form.get("image");
        if (!(image instanceof File) || image.size === 0) {
          return json({ error: "Attach the teaser image first." }, 400);
        }
        if (!image.type.startsWith("image/")) {
          return json({ error: "The teaser attachment must be an image." }, 400);
        }
        if (image.size > 10 * 1024 * 1024) {
          return json({ error: "The teaser image must be under 10 MB." }, 400);
        }

        const sent = await sendMessageWithAttachment(env, TEASER_CHANNEL_ID, {
          content: TEASER_TEXT,
          file: image,
          filename: image.name || "containment-failure.png",
          allowEveryone: true,
          nonce: TEASER_NONCE,
        });

        const marker = {
          sent: true,
          channelId: TEASER_CHANNEL_ID,
          messageId: sent?.id || null,
          sentAt: new Date().toISOString(),
        };
        await writeTeaserMarker(url.origin, marker);

        return json({
          ok: true,
          ...marker,
          pingedEveryone: true,
        });
      }

      const payload = await body(request);

      if (url.pathname === "/api/start" && request.method === "POST") {
        const pace = ["test", "fast", "normal"].includes(payload.pace) ? payload.pace : "test";
        const live = payload.live === true;
        const instanceId = `sentient-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
        const instance = await env.SENTIENT_WORKFLOW.create({
          id: instanceId,
          params: { pace, live },
          retention: {
            successRetention: "1 day",
            errorRetention: "3 days",
          },
        });

        return json({
          ok: true,
          instanceId: instance.id,
          pace,
          liveRequested: live,
          channelEditing: false,
          status: await instance.status(),
        });
      }

      if (url.pathname === "/api/scene" && request.method === "POST") {
        const allowed = ["watching", "vault_echo", "second_signal", "breach", "finale"];
        if (!allowed.includes(payload.scene)) return json({ error: "Unknown scene" }, 400);
        const result = await runManualScene(env, payload.scene);
        return json({ ok: true, result });
      }

      if (url.pathname === "/api/status" && request.method === "POST") {
        const instance = await getInstance(env, payload.id);
        return json({ ok: true, id: instance.id, status: await instance.status() });
      }

      if (["/api/pause", "/api/resume", "/api/stop"].includes(url.pathname) && request.method === "POST") {
        const instance = await getInstance(env, payload.id);
        if (url.pathname.endsWith("pause")) await instance.pause();
        if (url.pathname.endsWith("resume")) await instance.resume();
        if (url.pathname.endsWith("stop")) await instance.terminate();
        return json({ ok: true, id: instance.id, status: await instance.status() });
      }

      return json({ error: "Unknown API action" }, 404);
    } catch (error) {
      console.error("[SENTIENT]", error);
      return json({ error: error?.message || String(error) }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    try {
      const stub = gatewayStub(env);
      ctx.waitUntil(stub.fetch("https://sentient-gateway/ensure", { method: "POST" }));
    } catch (error) {
      console.error("[SENTIENT] Gateway keepalive failed:", error);
    }
  },
};
