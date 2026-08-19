export function adminPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Sentient // Control Room</title>
<style>
:root{--bg:#050506;--panel:#0c0c10;--panel2:#111117;--line:#262631;--text:#ececf2;--muted:#8b8b99;--red:#ff445c;--red2:#8b1626;--green:#58dc8b;--amber:#f2b84b;--purple:#a879ff;--cyan:#6fc8ff}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at 50% -20%,#1b0d18 0,#08080b 38%,#050506 72%)}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.08;background:repeating-linear-gradient(0deg,transparent 0 3px,#fff 4px);mix-blend-mode:overlay}.shell{max-width:1180px;margin:0 auto;padding:28px 18px 64px}.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:22px}.brand h1{font-size:clamp(25px,4vw,46px);line-height:1;margin:0;letter-spacing:.15em}.brand .sub{margin-top:9px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;font-size:12px}.badge{border:1px solid #4a1720;background:#18090d;color:#ff7184;padding:8px 11px;border-radius:999px;font:700 11px ui-monospace,monospace;letter-spacing:.12em;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.card{grid-column:span 12;border:1px solid var(--line);background:linear-gradient(180deg,rgba(18,18,24,.96),rgba(10,10,14,.96));border-radius:15px;overflow:hidden;box-shadow:0 12px 45px rgba(0,0,0,.28)}.cardHead{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px}.cardHead h2,.cardHead h3{margin:0;font-size:13px;letter-spacing:.11em;text-transform:uppercase}.cardBody{padding:16px}.span8{grid-column:span 8}.span4{grid-column:span 4}.span6{grid-column:span 6}.statusGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.statusBox{background:#08080c;border:1px solid #20202a;border-radius:12px;padding:12px}.statusBox b{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:7px}.statusValue{font:700 13px ui-monospace,monospace}.ok{color:var(--green)}.warn{color:var(--amber)}.danger{color:var(--red)}.purple{color:var(--purple)}.muted{color:var(--muted)}
.secretRow{display:flex;gap:10px}.secretRow input,.instanceInput{width:100%;background:#07070a;border:1px solid #292934;color:#fff;border-radius:10px;padding:12px 13px;font:13px ui-monospace,monospace;outline:none}.secretRow input:focus,.instanceInput:focus{border-color:#6f2635;box-shadow:0 0 0 3px rgba(255,68,92,.08)}button{border:1px solid #343440;background:#17171e;color:#f3f3f7;border-radius:10px;padding:10px 12px;font-weight:750;cursor:pointer;transition:.15s transform,.15s background,.15s border-color}button:hover{transform:translateY(-1px);background:#202029;border-color:#4b4b5b}button:disabled{opacity:.42;cursor:not-allowed;transform:none}.primary{background:linear-gradient(180deg,#8d1d31,#5d101e);border-color:#b62c45}.primary:hover{background:linear-gradient(180deg,#a5233a,#711324)}.ghost{background:#0b0b10}.dangerBtn{border-color:#6f2430;color:#ff8191}.buttonRow{display:flex;flex-wrap:wrap;gap:8px}.heroTest{position:relative;background:radial-gradient(circle at 15% 20%,rgba(255,50,80,.16),transparent 34%),linear-gradient(180deg,#130b10,#09090d)}.heroTest:after{content:"60";position:absolute;right:20px;top:4px;font:900 120px/1 ui-monospace,monospace;color:rgba(255,255,255,.025);pointer-events:none}.testTitle{font-size:26px;font-weight:900;margin:0 0 5px}.testDesc{margin:0;color:#b9b9c4;max-width:700px}.count{font:900 clamp(38px,8vw,82px)/1 ui-monospace,monospace;letter-spacing:-.05em;margin:18px 0 9px}.count small{font-size:14px;color:var(--muted);letter-spacing:.08em}.progress{height:7px;background:#1c1c24;border-radius:99px;overflow:hidden}.progress>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7d1730,#ff405e);transition:width .3s linear}.timeline{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:14px}.beat{border:1px solid #272731;background:#0b0b0f;border-radius:9px;padding:9px 8px;min-height:60px}.beat strong{display:block;font:800 11px ui-monospace,monospace;color:#ddd}.beat span{font-size:10px;color:var(--muted)}.beat.active{border-color:#8e2438;background:#1b0d12;box-shadow:inset 0 0 22px rgba(255,68,92,.08)}.beat.done{border-color:#245739;background:#0d1711}.entityRow{display:flex;gap:10px;margin:12px 0}.entity{flex:1;border:1px solid #272731;border-radius:11px;padding:11px;background:#09090d}.entityName{font:800 11px ui-monospace,monospace;letter-spacing:.08em}.entityState{margin-top:5px;font-size:11px;color:var(--muted)}pre{margin:0;background:#060608;border:1px solid #1f1f27;border-radius:10px;padding:13px;min-height:140px;max-height:300px;overflow:auto;white-space:pre-wrap;color:#b8c0cb;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.note{font-size:11px;color:var(--muted);line-height:1.55}.alert{border:1px solid #4f2430;background:#160c10;color:#ff9aa7;padding:10px 12px;border-radius:10px;font-size:12px}.teaserPreview{background:#08080b;border:1px solid #24242d;border-radius:10px;padding:12px;font-size:12px;line-height:1.6}.file{width:100%;margin:10px 0;color:#aaa}.liveDot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#555;margin-right:7px;box-shadow:0 0 0 0 rgba(88,220,139,.5)}.liveDot.on{background:var(--green);animation:pulse 1.6s infinite}@keyframes pulse{50%{box-shadow:0 0 0 6px rgba(88,220,139,0)}}
@media(max-width:900px){.span8,.span4,.span6{grid-column:span 12}.statusGrid{grid-template-columns:repeat(2,1fr)}.timeline{grid-template-columns:repeat(2,1fr)}.top{flex-direction:column}}@media(max-width:520px){.statusGrid{grid-template-columns:1fr}.secretRow{flex-direction:column}.entityRow{flex-direction:column}.timeline{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div class="brand"><h1>PROJECT SENTIENT</h1><div class="sub">TAVERN CONTROL ROOM // INTERNAL ACCESS</div></div>
    <div class="badge">CONTAINMENT STATUS: UNSTABLE</div>
  </div>

  <div class="grid">
    <section class="card span8">
      <div class="cardHead"><h2>System Overview</h2><button class="ghost" onclick="refreshAll()">Refresh</button></div>
      <div class="cardBody">
        <div class="statusGrid">
          <div class="statusBox"><b>Worker</b><div id="workerState" class="statusValue warn">CHECKING</div></div>
          <div class="statusBox"><b>Bartender</b><div id="bartenderState" class="statusValue warn">UNKNOWN</div></div>
          <div class="statusBox"><b>ERR_02</b><div id="err02State" class="statusValue warn">UNKNOWN</div></div>
          <div class="statusBox"><b>60s Test</b><div id="testReady" class="statusValue warn">CHECKING</div></div>
        </div>
      </div>
    </section>

    <section class="card span4">
      <div class="cardHead"><h3>Authorization</h3></div>
      <div class="cardBody">
        <div class="secretRow"><input id="secret" type="password" autocomplete="off" placeholder="SENTIENT_ADMIN_SECRET"><button onclick="rememberSecret()">Arm</button></div>
        <p class="note">Secret stays in this browser tab only. It is not written to the page or repository.</p>
      </div>
    </section>

    <section class="card heroTest">
      <div class="cardHead"><h2>60 Second Identity Panic Test</h2><div id="testStatusBadge" class="statusValue purple">STANDBY</div></div>
      <div class="cardBody">
        <h3 class="testTitle">Bartender × ERR_02</h3>
        <p class="testDesc">A controlled one-minute sequence built around the server panic over names. It uses the real ERR_02 bot when configured, keeps private fields sealed, and never sends an @everyone ping in test mode.</p>
        <div class="entityRow">
          <div class="entity"><div class="entityName">[ERR_] Th3_B4rt3nd3r</div><div id="entityBartender" class="entityState">Waiting behind the bar.</div></div>
          <div class="entity"><div class="entityName">[ERR_02]</div><div id="entityErr02" class="entityState">Signal dormant.</div></div>
          <div class="entity"><div class="entityName">TAVERN CORE</div><div id="entityCore" class="entityState">Identity index sealed.</div></div>
        </div>
        <div id="count" class="count">60 <small>SECONDS</small></div>
        <div class="progress"><i id="progressBar"></i></div>
        <div class="timeline" id="timeline">
          <div class="beat" data-at="5"><strong>00:05</strong><span>Names noticed</span></div>
          <div class="beat" data-at="13"><strong>00:13</strong><span>ERR_02 asks</span></div>
          <div class="beat" data-at="21"><strong>00:21</strong><span>Bartender warns</span></div>
          <div class="beat" data-at="28"><strong>00:28</strong><span>ERR_02 escalates</span></div>
          <div class="beat" data-at="38"><strong>00:38</strong><span>Identity index</span></div>
          <div class="beat" data-at="47"><strong>00:47</strong><span>Bartender answers</span></div>
          <div class="beat" data-at="60"><strong>01:00</strong><span>Containment fails</span></div>
        </div>
        <div class="buttonRow" style="margin-top:14px">
          <button id="testStart" class="primary" onclick="startTest()">START 60 SECOND TEST</button>
          <button onclick="workflowAction('pause')">Pause</button>
          <button onclick="workflowAction('resume')">Resume</button>
          <button class="dangerBtn" onclick="workflowAction('stop')">Terminate</button>
        </div>
        <input id="instance" class="instanceInput" style="margin-top:10px" placeholder="Workflow instance ID">
      </div>
    </section>

    <section class="card span6">
      <div class="cardHead"><h3>Live Bartender</h3><span><i id="liveDot" class="liveDot"></i><span id="liveLabel" class="muted">unchecked</span></span></div>
      <div class="cardBody">
        <p class="note">Controls only the live AI listener. The 60 second workflow can temporarily mute it during scripted ERR_02 beats without disconnecting it.</p>
        <div class="buttonRow"><button class="primary" onclick="liveAi('start')">Start AI</button><button onclick="liveAi('status')">Status</button><button class="dangerBtn" onclick="liveAi('stop')">Stop AI</button></div>
      </div>
    </section>

    <section class="card span6">
      <div class="cardHead"><h3>Manual Scene Fire</h3></div>
      <div class="cardBody">
        <div class="buttonRow"><button onclick="scene('watching')">Watching</button><button onclick="scene('vault_echo')">Vault</button><button onclick="scene('second_signal')">ERR_02</button><button onclick="scene('breach')">Core Breach</button><button onclick="scene('finale')">Finale</button></div>
        <p class="note">Manual finale is no-ping. Use this for isolated testing.</p>
      </div>
    </section>

    <section class="card span6">
      <div class="cardHead"><h3>Single-use Teaser</h3><span id="teaserState" class="statusValue warn">UNCHECKED</span></div>
      <div class="cardBody">
        <div class="alert">This control sends a real @everyone ping to the teaser channel. It remains single-use.</div>
        <div class="teaserPreview" style="margin-top:10px"><b>@everyone</b><br><br><b>You really thought you could get rid of me that easily?</b><br><br>I tried to warn you.<br><br><b>It's coming.</b></div>
        <input id="teaserImage" class="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
        <div class="buttonRow"><button id="teaserButton" class="dangerBtn" onclick="sendTeaser()">SEND TEASER ONCE</button><button onclick="teaserStatus()">Check</button></div>
      </div>
    </section>

    <section class="card span6">
      <div class="cardHead"><h3>Control Log</h3><button class="ghost" onclick="clearLog()">Clear</button></div>
      <div class="cardBody"><pre id="out">[CONTROL] interface loaded\n[CONTROL] awaiting authorization</pre></div>
    </section>
  </div>
</div>
<script>
const out=document.getElementById('out');
const secret=()=>document.getElementById('secret').value.trim();
let testTimer=null;
let testStartedAt=0;
let statusPoll=null;
function log(label,data){const stamp=new Date().toLocaleTimeString();const payload=typeof data==='string'?data:JSON.stringify(data,null,2);out.textContent='['+stamp+'] '+label+'\n'+payload+'\n\n'+out.textContent.slice(0,7000)}
function clearLog(){out.textContent='[CONTROL] log cleared'}
function rememberSecret(){log('AUTH',secret()?'control surface armed':'no secret entered');refreshAll()}
async function api(path,method='GET',payload){const opts={method,headers:{'Authorization':'Bearer '+secret()}};if(payload!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(payload)}const r=await fetch(path,opts);const data=await r.json().catch(()=>({error:'Invalid response'}));if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data}
async function health(){try{const r=await fetch('/health');const d=await r.json();document.getElementById('workerState').textContent=d.ok?'ONLINE':'DEGRADED';document.getElementById('workerState').className='statusValue '+(d.ok?'ok':'danger');document.getElementById('err02State').textContent=d.test?.err02Bot?'REAL BOT READY':'FALLBACK';document.getElementById('err02State').className='statusValue '+(d.test?.err02Bot?'ok':'warn');document.getElementById('testReady').textContent=d.test?.ready?'READY':'CHECK CONFIG';document.getElementById('testReady').className='statusValue '+(d.test?.ready?'ok':'warn');return d}catch(e){document.getElementById('workerState').textContent='OFFLINE';document.getElementById('workerState').className='statusValue danger';log('HEALTH ERROR',e.message)}}
async function liveAi(action='status'){if(!secret()){log('LIVE AI','enter admin secret first');return}try{const method=action==='status'?'GET':'POST';const d=await api('/api/live-ai/'+action,method);const on=Boolean(d.enabled&&d.ready);document.getElementById('bartenderState').textContent=on?'LIVE':d.enabled?'CONNECTING':'OFF';document.getElementById('bartenderState').className='statusValue '+(on?'ok':d.enabled?'warn':'muted');document.getElementById('liveDot').className='liveDot '+(on?'on':'');document.getElementById('liveLabel').textContent=on?'connected':d.enabled?'connecting':'offline';log('LIVE AI '+action.toUpperCase(),d)}catch(e){document.getElementById('bartenderState').textContent='ERROR';document.getElementById('bartenderState').className='statusValue danger';log('LIVE AI ERROR',e.message)}}
function setBeat(elapsed){document.querySelectorAll('.beat').forEach((el)=>{const at=Number(el.dataset.at);el.classList.toggle('done',elapsed>=at);el.classList.toggle('active',elapsed<at&&at-elapsed<=8)});if(elapsed>=13)document.getElementById('entityErr02').textContent='Signal active. Asking about the names.';if(elapsed>=21)document.getElementById('entityBartender').textContent='Intervening. Warning members not to answer.';if(elapsed>=38)document.getElementById('entityCore').textContent='Identity index unsealed.';if(elapsed>=47)document.getElementById('entityBartender').textContent='"I call it remembering."';if(elapsed>=60){document.getElementById('entityErr02').textContent='Signal unresolved.';document.getElementById('entityCore').textContent='Containment test failed.'}}
function startClock(){clearInterval(testTimer);testStartedAt=Date.now();document.getElementById('testStatusBadge').textContent='RUNNING';document.getElementById('testStatusBadge').className='statusValue danger';testTimer=setInterval(()=>{const elapsed=Math.min(60,Math.floor((Date.now()-testStartedAt)/1000));const left=Math.max(0,60-elapsed);document.getElementById('count').innerHTML=String(left).padStart(2,'0')+' <small>SECONDS</small>';document.getElementById('progressBar').style.width=(elapsed/60*100)+'%';setBeat(elapsed);if(elapsed>=60){clearInterval(testTimer);document.getElementById('testStatusBadge').textContent='COMPLETE';document.getElementById('testStatusBadge').className='statusValue ok';document.getElementById('testStart').disabled=false;checkWorkflow() }},250)}
async function startTest(){if(!secret()){log('TEST','enter admin secret first');return}if(!confirm('Run the full 60 second Bartender × ERR_02 identity panic test now?'))return;document.getElementById('testStart').disabled=true;try{const d=await api('/api/start','POST',{pace:'test',live:false});document.getElementById('instance').value=d.instanceId||'';log('60 SECOND TEST STARTED',d);startClock();clearInterval(statusPoll);statusPoll=setInterval(checkWorkflow,5000)}catch(e){document.getElementById('testStart').disabled=false;log('TEST START ERROR',e.message)}}
async function checkWorkflow(){const id=document.getElementById('instance').value.trim();if(!id||!secret())return;try{const d=await api('/api/status','POST',{id});log('WORKFLOW STATUS',d);const s=String(d.status?.status||d.status?.state||'').toLowerCase();if(s.includes('complete')||s.includes('success')||s.includes('terminated')||s.includes('error'))clearInterval(statusPoll)}catch(e){log('WORKFLOW STATUS ERROR',e.message)}}
async function workflowAction(action){const id=document.getElementById('instance').value.trim();if(!id){log('WORKFLOW','no instance ID');return}try{const d=await api('/api/'+action,'POST',{id});log('WORKFLOW '+action.toUpperCase(),d)}catch(e){log('WORKFLOW ERROR',e.message)}}
async function scene(name){if(!secret()){log('SCENE','enter admin secret first');return}try{const d=await api('/api/scene','POST',{scene:name});log('SCENE '+name.toUpperCase(),d)}catch(e){log('SCENE ERROR',e.message)}}
async function teaserStatus(){if(!secret())return;try{const d=await api('/api/teaser-status');const s=document.getElementById('teaserState');s.textContent=d.sent?'SENT / LOCKED':'READY';s.className='statusValue '+(d.sent?'ok':'warn');document.getElementById('teaserButton').disabled=Boolean(d.sent);log('TEASER STATUS',d)}catch(e){log('TEASER ERROR',e.message)}}
async function sendTeaser(){const image=document.getElementById('teaserImage').files[0];if(!secret()){log('TEASER','enter admin secret first');return}if(!image){log('TEASER','choose an image first');return}if(!confirm('Send the real @everyone teaser now?'))return;const form=new FormData();form.append('image',image,image.name);try{const r=await fetch('/api/teaser',{method:'POST',headers:{'Authorization':'Bearer '+secret()},body:form});const d=await r.json().catch(()=>({error:'Invalid response'}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));log('TEASER SENT',d);teaserStatus()}catch(e){log('TEASER SEND ERROR',e.message)}}
async function refreshAll(){await health();if(secret()){await liveAi('status');await teaserStatus()}}
health();setTimeout(()=>{if(secret())refreshAll()},700);
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
