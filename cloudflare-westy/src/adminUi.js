export function adminPage() {
  return new Response(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Westy Control</title>
<style>
:root{--bg:#07090d;--panel:#10141c;--line:#293241;--text:#f5f7fb;--muted:#93a0b4;--green:#65e6a5;--amber:#f0c060;--red:#ff7386}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#17243a,#080b11 48%,#05070a);color:var(--text);font-family:Inter,system-ui,sans-serif}.shell{max-width:820px;margin:auto;padding:34px 18px 60px}.top h1{margin:0;font-size:42px;letter-spacing:.08em}.sub{color:var(--muted);font:12px ui-monospace,monospace;margin-top:7px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}.card{border:1px solid var(--line);background:linear-gradient(#121823,#0b0f16);border-radius:15px;overflow:hidden}.wide{grid-column:1/-1}.head{padding:13px 15px;border-bottom:1px solid var(--line);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.body{padding:15px}.row,.secret{display:flex;flex-wrap:wrap;gap:8px}button,input{font:inherit}button{border:1px solid #3b4658;background:#17202d;color:#fff;border-radius:9px;padding:10px 12px;font-weight:800;cursor:pointer}.primary{background:#164e3b;border-color:#2b8769}.danger{border-color:#7a3441;color:#ff9baa}.secret input{flex:1;min-width:180px;background:#080b10;color:#fff;border:1px solid #303a49;border-radius:9px;padding:11px}.status{font:800 13px ui-monospace,monospace}.ok{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}pre{margin:0;background:#07090d;border:1px solid #202936;border-radius:9px;padding:12px;min-height:180px;max-height:340px;overflow:auto;white-space:pre-wrap;color:#c4cede;font:11px/1.5 ui-monospace,monospace}.note{color:var(--muted);font-size:12px;line-height:1.5}@media(max-width:700px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.secret{flex-direction:column}}
</style>
</head>
<body>
<div class="shell">
  <div class="top"><h1>WESTY</h1><div class="sub">STANDALONE DISCORD AI // BARTENDER RUNTIME CLONE</div></div>
  <div class="grid">
    <section class="card">
      <div class="head">Authorization</div>
      <div class="body"><div class="secret"><input id="secret" type="password" placeholder="WESTY_ADMIN_SECRET"><button onclick="arm()">Arm</button></div></div>
    </section>
    <section class="card">
      <div class="head">Live Westy</div>
      <div class="body"><div id="liveState" class="status warn">UNKNOWN</div><div class="row" style="margin-top:12px"><button class="primary" onclick="live('start')">Start</button><button onclick="live('status')">Status</button><button class="danger" onclick="live('stop')">Stop</button></div></div>
    </section>
    <section class="card wide"><div class="head">Control Log</div><div class="body"><pre id="out">[WESTY] control panel loaded</pre></div></section>
  </div>
</div>
<script>
const el=(id)=>document.getElementById(id);const out=el('out');const sec=()=>el('secret').value.trim();const liveState=el('liveState');
function log(label,data){out.textContent='['+new Date().toLocaleTimeString()+'] '+label+'\n'+(typeof data==='string'?data:JSON.stringify(data,null,2))+'\n\n'+out.textContent.slice(0,7000)}
async function api(path,method='GET'){const response=await fetch(path,{method,headers:{Authorization:'Bearer '+sec()}});const data=await response.json().catch(()=>({error:'Invalid response'}));if(!response.ok)throw new Error(data.error||'HTTP '+response.status);return data}
async function arm(){if(!sec())return log('AUTH','Enter WESTY_ADMIN_SECRET');try{await api('/api/auth-check');log('AUTH','Authorized');await live('status')}catch(error){log('AUTH ERROR',error.message)}}
function applyLive(data){liveState.textContent=data.enabled&&data.ready?'LIVE':data.enabled?'CONNECTING':'OFF';liveState.className='status '+(data.enabled&&data.ready?'ok':'warn')}
async function live(action='status'){if(!sec())return log('LIVE','Arm the panel first');try{const data=await api('/api/live-ai/'+action,action==='status'?'GET':'POST');applyLive(data);log('LIVE '+action.toUpperCase(),data);return data}catch(error){liveState.textContent='ERROR';liveState.className='status bad';log('LIVE ERROR',error.message)}}
</script>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
