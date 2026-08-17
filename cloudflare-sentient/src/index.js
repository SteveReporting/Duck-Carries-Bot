export { SentientWorkflow } from "./workflow.js";

import { runManualScene } from "./scenes.js";

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

function adminPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Sentient</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee;max-width:760px;margin:40px auto;padding:0 18px}h1{letter-spacing:.08em}section{border:1px solid #333;border-radius:12px;padding:16px;margin:14px 0;background:#111}button,input,select{font:inherit;padding:10px 12px;margin:5px;border-radius:8px;border:1px solid #444;background:#171717;color:#eee}button{cursor:pointer}button:hover{background:#242424}input{min-width:320px}pre{white-space:pre-wrap;background:#050505;padding:14px;border-radius:8px;min-height:80px}.warn{color:#ffcc66;font-weight:600}</style>
</head>
<body>
<h1>PROJECT SENTIENT</h1>
<p class="warn">Private control surface. Test mode never pings @everyone.</p>
<section>
<label>Admin secret<br><input id="secret" type="password" autocomplete="off" placeholder="SENTIENT_ADMIN_SECRET"></label>
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
<button onclick="scene('breach')">Gates</button>
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

function missingConfig(env) {
  const required = [
    "SENTIENT_BARTENDER_TOKEN",
    "SENTIENT_TAVERN_CHAT_CHANNEL_ID",
    "SENTIENT_ANNOUNCEMENTS_CHANNEL_ID",
    "SENTIENT_ADMIN_SECRET",
  ];
  return required.filter((key) => !env[key]);
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
        liveArmed: String(env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true",
      }, missing.length ? 503 : 200);
    }

    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    if (!authorized(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const payload = await body(request);

    try {
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
};
