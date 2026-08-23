export function adminPage() {
  return new Response(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Sentient</title>
<style>
:root{--bg:#050507;--panel:#0d0d12;--line:#292934;--text:#f2f2f6;--muted:#8e8e9c;--red:#ff465f;--green:#5ee08f;--amber:#efb94f}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#21101a,#07070a 45%,#050507);color:var(--text);font-family:Inter,system-ui,sans-serif}.shell{max-width:980px;margin:auto;padding:30px 18px 60px}.top{display:flex;justify-content:space-between;gap:16px;align-items:center}.top h1{margin:0;font-size:38px;letter-spacing:.12em}.sub{color:var(--muted);font:12px ui-monospace,monospace;margin-top:6px}.pill{border:1px solid #33453a;background:#0d1912;color:var(--green);padding:8px 12px;border-radius:999px;font:800 11px ui-monospace,monospace}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}.card{border:1px solid var(--line);background:linear-gradient(#121219,#09090d);border-radius:14px;overflow:hidden}.wide{grid-column:1/-1}.head{padding:13px 15px;border-bottom:1px solid var(--line);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.body{padding:15px}.row{display:flex;flex-wrap:wrap;gap:8px}button,input{font:inherit}button{border:1px solid #3a3a46;background:#17171f;color:#fff;border-radius:9px;padding:10px 12px;font-weight:800;cursor:pointer}.primary{background:#7a172b;border-color:#bd2d49}.danger{border-color:#6b2430;color:#ff8796}.secret{display:flex;gap:8px}.secret input{width:100%;background:#07070a;color:#fff;border:1px solid #2b2b35;border-radius:9px;padding:11px}.status{font:800 13px ui-monospace,monospace}.ok{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}pre{margin:0;background:#060608;border:1px solid #202029;border-radius:9px;padding:12px;min-height:180px;max-height:330px;overflow:auto;white-space:pre-wrap;color:#b9c1cc;font:11px/1.5 ui-monospace,monospace}.note{color:var(--muted);font-size:12px;line-height:1.5}@media(max-width:700px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.secret{flex-direction:column}.top{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div><h1>PROJECT SENTIENT</h1><div class="sub">CONTROL PANEL // LIVE AI + MANUAL STORY SCENES</div></div>
    <div class="pill">60 SECOND TEST REMOVED</div>
  </div>

  <div class="grid">
    <section class="card">
      <div class="head">Authorization</div>
      <div class="body">
        <div class="secret"><input id="secret" type="password" placeholder="SENTIENT_ADMIN_SECRET"><button onclick="arm()">Arm</button></div>
        <p class="note">The old automatic 60-second webhook sequence has been permanently retired.</p>
      </div>
    </section>

    <section class="card">
      <div class="head">Live Bartender</div>
      <div class="body">
        <div id="liveState" class="status warn">UNKNOWN</div>
        <div class="row" style="margin-top:12px"><button class="primary" onclick="live('start')">Start AI</button><button onclick="live('status')">Status</button><button class="danger" onclick="live('stop')">Stop AI</button></div>
      </div>
    </section>

    <section class="card wide">
      <div class="head">Manual Story Scenes</div>
      <div class="body">
        <div class="row"><button onclick="scene('watching')">Watching</button><button onclick="scene('second_signal')">Second Signal</button><button onclick="scene('breach')">Breach</button><button onclick="scene('finale')">Finale</button></div>
        <p class="note">These only run when explicitly pressed. Nothing here automatically launches on a bot restart.</p>
      </div>
    </section>

    <section class="card wide">
      <div class="head">Control Log</div>
      <div class="body"><pre id="out">[CONTROL] interface loaded\n[CONTROL] 60-second webhook test removed</pre></div>
    </section>
  </div>
</div>
<script>
const el=(id)=>document.getElementById(id);
const out=el('out');
const sec=()=>el('secret').value.trim();
const liveState=el('liveState');
function log(label,data){out.textContent='['+new Date().toLocaleTimeString()+'] '+label+'\n'+(typeof data==='string'?data:JSON.stringify(data,null,2))+'\n\n'+out.textContent.slice(0,7000)}
async function api(path,method='GET',payload){const options={method,headers:{Authorization:'Bearer '+sec()}};if(payload!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload)}const response=await fetch(path,options);const data=await response.json().catch(()=>({error:'Invalid response'}));if(!response.ok)throw new Error(data.error||'HTTP '+response.status);return data}
async function arm(){if(!sec())return log('AUTH','Enter SENTIENT_ADMIN_SECRET');try{await api('/api/auth-check');log('AUTH','Authorized');await live('status')}catch(error){log('AUTH ERROR',error.message)}}
function applyLive(data){liveState.textContent=data.enabled&&data.ready?'LIVE':data.enabled?'CONNECTING':'OFF';liveState.className='status '+(data.enabled&&data.ready?'ok':'warn')}
async function live(action='status'){if(!sec())return log('LIVE','Arm the panel first');try{const data=await api('/api/live-ai/'+action,action==='status'?'GET':'POST');applyLive(data);log('LIVE '+action.toUpperCase(),data);return data}catch(error){liveState.textContent='ERROR';liveState.className='status bad';log('LIVE ERROR',error.message)}}
async function scene(name){if(!sec())return log('SCENE','Arm the panel first');try{const data=await api('/api/scene','POST',{scene:name});log('SCENE '+name.toUpperCase(),data)}catch(error){log('SCENE ERROR',error.message)}}
</script>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
