// ── STATE ────────────────────────────────────────────────
let sel = null;
let hist = [];
let liveData = {};

// ── MATH ─────────────────────────────────────────────────
function Phi(z) {
  const s=z<0?-1:1,az=Math.abs(z),t=1/(1+0.3275911*az);
  const p=t*(0.254829592+t*(-0.284496736+t*(1.421413741+t*(-1.453152027+t*1.061405429))));
  return 0.5*(1+s*(1-p*Math.exp(-az*az)));
}

function cltProb(oevk, pctRep, marginPP) {
  const N=oevk.n, k=Math.max(1,Math.round(N*pctRep/100)), rem=N-k;
  if(rem<=0) return {prob:marginPP>=0?1:0, z:Infinity, k, rem, se:0};
  const M=marginPP/100, se=2*oevk.sd*Math.sqrt(rem)/N;
  const z=(M*k/N)/se;
  return {prob:Phi(z), z, k, rem, se:se*100};
}

function seAtPct(oevk, pct) {
  const N=oevk.n, k=Math.max(1,Math.round(N*pct/100)), rem=N-k;
  if(rem<=0) return 0;
  return 2*oevk.sd*Math.sqrt(rem)/N*100;
}


// ── COLOR HELPER ──────────────────────────────────────────
// prob = P(Fidesz wins), always 0..1
// Fidesz leads (prob > 0.5): 50-70% red, 70-90% amber, 90%+ green
// Tisza leads (prob < 0.5):  50-30% red, 30-10% amber, 10%- green
function probColor(prob) {
  const p = prob * 100;
  if(p >= 90) return 'var(--green)';
  if(p >= 70) return 'var(--amber)';
  if(p >= 30) return 'var(--red)';
  if(p >= 10) return 'var(--amber)';
  return 'var(--green)';
}

// ── CHART ─────────────────────────────────────────────────
function drawChart(oevk, marginPP) {
  const cv=document.getElementById('cv');
  const ctx=cv.getContext('2d');
  const W=cv.offsetWidth, H=cv.offsetHeight||300;
  cv.width=W; cv.height=H;
  const PAD={t:14,r:14,b:34,l:50};
  const pw=W-PAD.l-PAD.r, ph=H-PAD.t-PAD.b;

  ctx.fillStyle='#0f1117'; ctx.fillRect(0,0,W,H);

  // grid
  ctx.font='10px Share Tech Mono';
  [0,25,50,75,100].forEach(y=>{
    const py=PAD.t+ph*(1-y/100);
    ctx.strokeStyle='#1e2330';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(PAD.l,py);ctx.lineTo(PAD.l+pw,py);ctx.stroke();
    ctx.fillStyle='#5a6070';ctx.textAlign='right';ctx.fillText(y+'%',PAD.l-5,py+3);
  });
  [0,20,40,60,80,100].forEach(x=>{
    const px=PAD.l+pw*x/100;
    ctx.strokeStyle='#1e2330';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(px,PAD.t);ctx.lineTo(px,PAD.t+ph);ctx.stroke();
    ctx.fillStyle='#5a6070';ctx.textAlign='center';ctx.fillText(x+'%',px,H-5);
  });

  ctx.setLineDash([3,4]);
  [{v:50,lbl:'VÉLETLEN'},{v:90,lbl:'VALÓSZÍNŰ'},{v:99,lbl:'BIZTOS'}].forEach(({v,lbl})=>{
    const py=PAD.t+ph*(1-v/100);
    ctx.strokeStyle='rgba(90,96,112,0.5)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(PAD.l,py);ctx.lineTo(PAD.l+pw,py);ctx.stroke();
    ctx.fillStyle='#5a6070';ctx.font='9px Share Tech Mono';ctx.textAlign='left';
    ctx.fillText(lbl,PAD.l+3,py-3);
  });
  ctx.setLineDash([]);

  const xs=Array.from({length:99},(_,i)=>i+1);
  const PX=x=>PAD.l+pw*x/100;
  const PY=p=>PAD.t+ph*(1-Math.min(100,Math.max(0,p))/100);

  function drawLine(pts, color, lw) {
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=lw;
    pts.forEach((d,i)=>i?ctx.lineTo(PX(d.x),PY(d.p)):ctx.moveTo(PX(d.x),PY(d.p)));
    ctx.stroke();
  }
  function drawBand(hi,lo,fill) {
    ctx.beginPath();
    hi.forEach((d,i)=>i?ctx.lineTo(PX(d.x),PY(d.p)):ctx.moveTo(PX(d.x),PY(d.p)));
    lo.slice().reverse().forEach(d=>ctx.lineTo(PX(d.x),PY(d.p)));
    ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  }
  function drawEdge(pts,col){
    ctx.beginPath();ctx.strokeStyle=col;ctx.lineWidth=1;
    pts.forEach((d,i)=>i?ctx.lineTo(PX(d.x),PY(d.p)):ctx.moveTo(PX(d.x),PY(d.p)));
    ctx.stroke();
  }

  // CLT curves
  const cltMain=xs.map(x=>({x,p:cltProb(oevk,x,marginPP).prob*100}));
  const hi1=xs.map(x=>({x,p:cltProb(oevk,x,marginPP+seAtPct(oevk,x)).prob*100}));
  const lo1=xs.map(x=>({x,p:cltProb(oevk,x,marginPP-seAtPct(oevk,x)).prob*100}));
  const hi2=xs.map(x=>({x,p:cltProb(oevk,x,marginPP+2*seAtPct(oevk,x)).prob*100}));
  const lo2=xs.map(x=>({x,p:cltProb(oevk,x,marginPP-2*seAtPct(oevk,x)).prob*100}));
  const hi3=xs.map(x=>({x,p:cltProb(oevk,x,marginPP+3*seAtPct(oevk,x)).prob*100}));
  const lo3=xs.map(x=>({x,p:cltProb(oevk,x,marginPP-3*seAtPct(oevk,x)).prob*100}));
  drawBand(hi3,lo3,'rgba(232,160,32,0.04)');
  drawBand(hi2,lo2,'rgba(232,160,32,0.08)');
  drawBand(hi1,lo1,'rgba(232,160,32,0.14)');
  drawEdge(hi1,'rgba(232,160,32,0.35)');drawEdge(lo1,'rgba(232,160,32,0.35)');
  drawEdge(hi2,'rgba(232,160,32,0.22)');drawEdge(lo2,'rgba(232,160,32,0.22)');
  drawEdge(hi3,'rgba(232,160,32,0.14)');drawEdge(lo3,'rgba(232,160,32,0.14)');
  drawLine(cltMain,'#e8a020',2.5);

}

// ── STATS ─────────────────────────────────────────────────
function refreshStats(marginPP) {
  if(!sel) return;
  const pct=parseFloat(document.getElementById('sliderPct').value);
  const {prob:cP,z,k,rem,se}=cltProb(sel,pct,marginPP);
  document.getElementById('sN').textContent=sel.n;
  document.getElementById('sSigma').textContent=(sel.sd*100).toFixed(2)+'pp';
  document.getElementById('sK').textContent=k;
  document.getElementById('sRem').textContent=rem;
  document.getElementById('sCLT').textContent=(cP*100).toFixed(1)+'%';
  document.getElementById('sFlip').textContent=((1-cP)*100).toFixed(2)+'%';
  document.getElementById('sSE').textContent=se.toFixed(3)+'pp';
  document.getElementById('sZ').textContent=isFinite(z)?z.toFixed(3):'∞';
}

// ── CALCULATE ─────────────────────────────────────────────
function calculate() {
  if(!sel){alert('Kérjük válasszon OEVK-t!');return;}
  const pct=parseFloat(document.getElementById('sliderPct').value);
  const marginPP=parseFloat(document.getElementById('margin').value);
  if(isNaN(marginPP)){alert('Adja meg az előnyt!');return;}

  const {prob:cP,z,k,rem,se}=cltProb(sel,pct,marginPP);
  const p100=cP*100;
  const color=probColor(cP);
  const verdict=p100>=90?'ELDŐLT':p100>=70?'VALÓSZÍNŰ':p100>=30?'BIZONYTALAN':p100>=10?'VALÓSZÍNŰ':'ELDŐLT';

  document.getElementById('bigConf').textContent=p100.toFixed(1)+'%';
  document.getElementById('bigConf').style.color=color;
  document.getElementById('bigConfSub').textContent='CLT VALÓSZÍNŰSÉG';

  document.getElementById('resBox').style.display='block';
  document.getElementById('rCLT').textContent=p100.toFixed(1)+'%';
  document.getElementById('rRep').textContent=`${pct}% (${k}/${sel.n})`;
  const live=liveData[sel.id];
  const dispM=live?live.displayMarginPP:marginPP;
  document.getElementById('rMargin').textContent=(dispM>=0?'+':'')+dispM.toFixed(2)+' pp';
  document.getElementById('rZ').textContent=isFinite(z)?z.toFixed(4):'∞';
  document.getElementById('rFlipCLT').textContent=((1-cP)*100).toFixed(2)+'%';
  document.getElementById('rVerdict').textContent=verdict;
  document.getElementById('rVerdict').style.color=color;

  refreshStats(marginPP);
  drawChart(sel,marginPP);
  hist.unshift({id:sel.id,name:sel.name,pct,marginPP,cP:p100});
  renderHist();
}

// ── LIST & SELECTION ──────────────────────────────────────
// ── JSON IMPORT ─────────────────────────────────────────────

// maz code → county prefix used in OEVK_DATA keys
const MAZ_TO_COUNTY = {
  '01':'BUDAPEST','02':'BARANYA','03':'BÁCS','04':'BÉKÉS','05':'BORSOD',
  '06':'CSONGRÁD','07':'FEJÉR','08':'GYŐR','09':'HAJDÚ','10':'HEVES',
  '11':'JÁSZ','12':'KOMÁROM','13':'NÓGRÁD','14':'PEST','15':'SOMOGY',
  '16':'SZABOLCS','17':'TOLNA','18':'VAS','19':'VESZPRÉM','20':'ZALA'
};

// ej_id → party name, populated from candidates JSON
let ejPartyMap = {};
let candidatesLoaded = false;

async function fetchJsonWithCorsproxy(link) {
  const corsproxyPrefix = 'https://corsproxy.io/?key=cb711b4a&url=';
  const json = await fetch(`${corsproxyPrefix}${link}`).then(r => r.json());
  console.log(`Fetching JSON from ${link} returned:`);
  console.log(json);
  return json;
}

// ── Load last available date ─────────────────────────────────
async function loadLastAvailableDate() {
  const config = await fetchJsonWithCorsproxy("https://vtr.valasztas.hu/ogy2026/data/config.json")
  return config["ver"];
}

// ── Candidates JSON ──────────────────────────────────────────
async function loadCandidatesFromURL() {
  const date = await loadLastAvailableDate();
  const candidatesURL = `https://vtr.valasztas.hu/ogy2026/data/${date}/ver/EgyeniJeloltek.json`;
  const candidatesJson = await fetchJsonWithCorsproxy(candidatesURL);

  processCandidatesJSON(candidatesJson);
}

let fakeDataIndex = 0;
async function fetchFakeData() {
  const dataArray = [
    result_1000,
    result_1100,
    result_1200,
    result_1300,
    result_1400,
    result_1500,
    result_1600,
    result_1700,
    result_1800,
    result_1900,
  ];
  const data = dataArray[fakeDataIndex];
  fakeDataIndex = (fakeDataIndex + 1) % dataArray.length;
  return data;
}

async function fetchResultsFromServer() {
  // For testing:
  if (new URLSearchParams(document.location.search).get("test"))
    return await fetchFakeData();

  // For production:
  const date = await loadLastAvailableDate();
  const resultsURL = `https://vtr.valasztas.hu/ogy2026/data/${date}/szavossz/OevkJkv.json`;
  return await fetchJsonWithCorsproxy(resultsURL);
}

function handleCandDrop(e) {
  console.log("Obsolete function");
}

function handleCandFileInput(e) {
  const file = e.target.files[0];
  if(file) parseCandidatesFile(file);
  e.target.value = '';
}

function parseCandidatesFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const json = JSON.parse(e.target.result);
      processCandidatesJSON(json);
    } catch(err) {
      showCandStatus('Hiba: ' + err.message, false);
    }
  };
  reader.readAsText(file, 'UTF-8');
}
function processCandidatesJSON(json) {
  const list = json.list || [];
  ejPartyMap = {};
  for(const cand of list) {
    if(cand.ej_id && cand.jlcs_nev) {
      ejPartyMap[cand.ej_id] = cand.jlcs_nev;
    }
  }
  const count = Object.keys(ejPartyMap).length;
  candidatesLoaded = count > 0;
  showCandStatus('✓ ' + count + ' jelölt betöltve', candidatesLoaded);
  // Re-process results if already loaded
  // if(lastResultsJSON) processResultsJSON(lastResultsJSON);
}
function showCandStatus(msg, ok) {
  const el = document.getElementById('candStatus');
  el.textContent = msg;
  el.className = 'csv-status ' + (ok === true ? 'ok' : ok === false ? 'err' : '');
  el.style.display = 'block';
}

// ── Results JSON ─────────────────────────────────────────────
function handleResDrop(e) {
  e.preventDefault();
  document.getElementById('resDrop').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if(file) parseResultsFile(file);
}
function handleResFileInput(e) {
  const file = e.target.files[0];
  if(file) parseResultsFile(file);
  e.target.value = '';
}
function parseResultsFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const json = JSON.parse(e.target.result);
      processResultsJSON(json);
    } catch(err) {
      showCSVStatus('Hiba: ' + err.message, false);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function isPartyFidesz(name) {
  const u = name ? name.toUpperCase() : '';
  return u.includes('FIDESZ');
}
function isPartyTisza(name) {
  const u = name ? name.toUpperCase() : '';
  // 2026: TISZA
  // 2022: exact jlcs_nev = "DK-JOBBIK-MOMENTUM-MSZP-LMP-PÁRBESZÉD"
  return u.includes('TISZA');
}

function processResultsJSON(json) {
  if(!candidatesLoaded) {
    showCSVStatus('⚠ Előbb töltse be a jelöltek JSON-t!', false);
    return;
  }
  const list = json.list || [];
  let loaded = 0, errors = 0;
  const newData = {};

  for(const oevkData of list) {
    const maz = oevkData.maz;
    const evk = oevkData.evk;
    const jkv = oevkData.egyeni_jkv;
    if(!maz || !evk || !jkv) { errors++; continue; }

    const county = MAZ_TO_COUNTY[maz];
    if(!county) { errors++; continue; }

    // Build the OEVK_DATA key e.g. "01-03", "14-07"
    const mazPad = maz.padStart(2,'0');
    const evkPad = evk.padStart(2,'0');
    // Find the matching key: county prefix + evk number
    // OEVK_DATA keys are like "01-01" where first part is maz, second is evk
    const matchKey = mazPad + '-' + evkPad;
    if(!OEVK_DATA[matchKey]) { errors++; continue; }

    const feldar = (jkv.feldar != null) ? jkv.feldar : 0;  // 0-100
    const tetelek = jkv.tetelek || [];

    // Sum votes by party
    let fideszVotes = 0, tiszaVotes = 0;
    for(const t of tetelek) {
      const partyName = ejPartyMap[t.ej_id] || '';
      if(isPartyFidesz(partyName)) fideszVotes += (t.szavazat || 0);
      else if(isPartyTisza(partyName)) tiszaVotes += (t.szavazat || 0);
    }

    const total = fideszVotes + tiszaVotes;
    if(total === 0) {
      const parties = tetelek.map(t => ejPartyMap[t.ej_id] || ('?ej'+t.ej_id)).join(', ');
      if(errors < 3) console.warn(`OEVK ${matchKey}: nincs Fidesz/Tisza szavazat. Pártok: ${parties}`);
      errors++;
      continue;
    }

    const fidP   = fideszVotes / total;  // two-party share, same as historical σ basis
    const tiszaP = tiszaVotes  / total;
    const modelMarginPP  = (fidP - 0.5) * 200;
    const displayMarginPP = (fidP - tiszaP) * 100;
    const pct = feldar;  // already 0-100

    newData[matchKey] = {pct, modelMarginPP, displayMarginPP, twoPartyFid: fidP, fidP, tiszaP};
    loaded++;
  }

  liveData = newData;
  showCSVStatus('✓ ' + loaded + ' OEVK betöltve' + (errors > 0 ? ' (' + errors + ' hiba)' : ''), loaded > 0);
  document.getElementById('liveBadge').style.display = loaded > 0 ? '' : 'none';
  updateSummaryBar();
  renderList(document.getElementById('searchInput').value);
  if(sel && liveData[sel.id]) selectOevk(sel);
}

function showCSVStatus(msg, ok) {
  const el = document.getElementById('csvStatus');
  el.textContent = msg;
  el.className = 'csv-status ' + (ok ? 'ok' : 'err');
  el.style.display = 'block';
}
function updateSummaryBar() {
  const keys=Object.keys(liveData);
  if(!keys.length){document.getElementById('summaryBar').style.display='none';return;}
  document.getElementById('summaryBar').style.display='grid';
  let fCalled=0,fLikely=0,fUncertain=0,tCalled=0,tLikely=0,tUncertain=0;
  let totalRep=0,count=0;
  for(const key of keys){
    const live=liveData[key]; const oevk=OEVK_DATA[key]; if(!oevk) continue;
    const {prob}=cltProb(oevk,live.pct,live.modelMarginPP);
    const pFidesz=prob*100;        // P(Fidesz wins) — always
    const pTisza=(1-prob)*100;     // P(Tisza wins) — always
    if(live.modelMarginPP>=0){
      if(pFidesz>=90)fCalled++; else if(pFidesz>=70)fLikely++; else fUncertain++;
    } else {
      if(pTisza>=90)tCalled++; else if(pTisza>=70)tLikely++; else tUncertain++;
    }
    totalRep+=live.pct; count++;
  }
  document.getElementById('sbLoaded').textContent=keys.length;
  document.getElementById('sbFCalled').textContent=fCalled;
  document.getElementById('sbFLikely').textContent=fLikely;
  document.getElementById('sbFUncertain').textContent=fUncertain;
  document.getElementById('sbTCalled').textContent=tCalled;
  document.getElementById('sbTLikely').textContent=tLikely;
  document.getElementById('sbTUncertain').textContent=tUncertain;
  document.getElementById('sbAvgRep').textContent=count>0?(totalRep/count).toFixed(1)+'%':'—';
  document.getElementById('sbMissing').textContent=106-keys.length;

  // Poisson binomial DP for Tisza seat probability
  // All 106 OEVKs must be included:
  //   - Reported OEVKs: use CLT probability from live data
  //   - Unreported OEVKs: use historical mu as prior P(Fidesz wins)
  const tiszaProbs = [];
  for(const key of Object.keys(OEVK_DATA)){
    const oevk=OEVK_DATA[key];
    const live=liveData[key];
    let tiszaWinProb;
    if(live){
      // Reported: CLT-based probability
      const {prob}=cltProb(oevk,live.pct,live.modelMarginPP);
      tiszaWinProb = 1 - prob;
    } else {
      // Unreported: use historical mu as P(Fidesz wins two-party),
      // so P(Tisza wins) = 1 - mu
      tiszaWinProb = 1 - oevk.mu;
    }
    tiszaProbs.push(tiszaWinProb);
  }
  if(tiszaProbs.length > 0) {
    // DP: dp[i] = probability of exactly i Tisza wins
    let dp = new Float64Array(tiszaProbs.length + 1);
    dp[0] = 1.0;
    for(let i = 0; i < tiszaProbs.length; i++){
      const p = tiszaProbs[i];
      // Update in reverse to avoid using updated values
      for(let j = i+1; j >= 1; j--){
        dp[j] = dp[j]*(1-p) + dp[j-1]*p;
      }
      dp[0] *= (1-p);
    }
    // P(Tisza >= 57) — note: we only have data for reported OEVKs
    // This is the conditional probability given reported results
    let pAtLeast57 = 0, pAtLeast88 = 0, expectedSeats = 0;
    for(let i = 0; i <= tiszaProbs.length; i++){
      if(i >= 57) pAtLeast57 += dp[i];
      if(i >= 88) pAtLeast88 += dp[i];
      expectedSeats += i * dp[i];
    }
    const el57 = document.getElementById('sbTiszaSeat57');
    el57.textContent = (pAtLeast57*100).toFixed(1)+'%';
    el57.style.color = probColor(1-pAtLeast57);
    const el88 = document.getElementById('sbTiszaSeat88');
    el88.textContent = (pAtLeast88*100).toFixed(1)+'%';
    el88.style.color = probColor(1-pAtLeast88);
    document.getElementById('sbTiszaExp').textContent = expectedSeats.toFixed(1)+' szk.';
  } else {
    document.getElementById('sbTiszaSeat57').textContent='—';
    document.getElementById('sbTiszaSeat88').textContent='—';
    document.getElementById('sbTiszaExp').textContent='—';
  }
}

function renderList(filter='') {
  const el=document.getElementById('oevkList');
  el.innerHTML='';
  const lc=filter.toLowerCase();
  const filtered=Object.values(OEVK_DATA).filter(o=>o.name.toLowerCase().includes(lc)||o.id.includes(lc));
  document.getElementById('cnt').textContent=filtered.length;
  filtered.sort((a,b)=>a.name.localeCompare(b.name)).forEach(o=>{
    const div=document.createElement('div');
    div.className='oevk-item'+(sel&&sel.id===o.id?' active':'');
    const live=liveData[o.id];
    let scoreHTML='';
    if(live){
      const {prob}=cltProb(o,live.pct,live.modelMarginPP);
      const p=prob*100;
      const sc=probColor(prob);
      const lc=live.displayMarginPP>=0?'var(--red)':'var(--blue)';
      const ldr=live.displayMarginPP>=0?'F':'T';
      // Background: distance from 50% mapped to opacity 30%→80%
      const dist=Math.abs(prob-0.5)*2; // 0 at 50/50, 1 at certainty
      const opacity=(0.30+0.50*dist).toFixed(2);
      const bgColor=prob>=0.5
        ? `rgba(220,100,30,${opacity})`   // orange for Fidesz
        : `rgba(52,152,219,${opacity})`;  // blue for Tisza
      div.style.background=bgColor;
      div.style.borderLeft=prob>=0.5?'2px solid rgba(220,100,30,0.6)':'2px solid rgba(52,152,219,0.6)';
      div.style.paddingLeft='10px';
      scoreHTML=`<div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0">
        <span class="oevk-score" style="color:${sc}">${p>99.9?'100':p.toFixed(1)}%</span>
        <span class="oevk-rep" style="color:${lc}">${ldr} ${live.pct.toFixed(0)}%✓</span></div>`;
    }
    div.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:4px;width:100%">
      <div><div class="name">${o.name}</div><div class="meta">N=${o.n} · σ=${(o.sd*100).toFixed(2)}pp</div></div>${scoreHTML}</div>`;
    div.addEventListener('click',()=>selectOevk(o));
    el.appendChild(div);
  });
}

function selectOevk(o) {
  sel=o;
  renderList(document.getElementById('searchInput').value);
  document.getElementById('conName').textContent=o.name;
  document.getElementById('bigConf').textContent='—';
  document.getElementById('bigConf').style.color='var(--text-dim)';
  document.getElementById('resBox').style.display='none';
  const live=liveData[o.id];
  if(live){
    const pct=live.pct;
    const modelMPP=live.modelMarginPP;      // two-party margin → fed to CLT/bootstrap
    const dispMPP=live.displayMarginPP;     // raw Fidesz−Tisza pp → shown to user
    document.getElementById('sliderPct').value=Math.round(pct);
    document.getElementById('sliderVal').textContent=Math.round(pct);
    document.getElementById('margin').value=modelMPP.toFixed(2);
    const k=Math.round(o.n*pct/100);
    document.getElementById('stationLabel').textContent=`${k} / ${o.n} szk.`;
    const leader=dispMPP>=0?'Fidesz':'Tisza';
    document.getElementById('conMeta').textContent=`${o.n} szk. · σ=${(o.sd*100).toFixed(2)}pp · ${pct.toFixed(1)}% feldolg. · ${leader} +${Math.abs(dispMPP).toFixed(2)}pp`;
    drawChart(o,modelMPP); refreshStats(modelMPP);
    const {prob:cP}=cltProb(o,pct,modelMPP);
    const p100=cP*100;
    const color=probColor(cP);
    document.getElementById('bigConf').textContent=p100.toFixed(1)+'%';
    document.getElementById('bigConf').style.color=color;
    document.getElementById('bigConfSub').textContent='CLT · AUTOMATIKUS';
  } else {
    const pct=parseFloat(document.getElementById('sliderPct').value);
    const k=Math.round(o.n*pct/100);
    document.getElementById('stationLabel').textContent=`${k} / ${o.n} szk.`;
    document.getElementById('conMeta').textContent=`${o.n} szavazókör · σ=${(o.sd*100).toFixed(2)}pp · ferdeség=${o.skew.toFixed(3)}`;
    const m=parseFloat(document.getElementById('margin').value)||0;
    drawChart(o,m); refreshStats(m);
  }
}

function onSlider() {
  const v=document.getElementById('sliderPct').value;
  document.getElementById('sliderVal').textContent=v;
  if(sel){
    const k=Math.round(sel.n*v/100);
    document.getElementById('stationLabel').textContent=`${k} / ${sel.n} szk.`;
    const m=parseFloat(document.getElementById('margin').value)||0;
    drawChart(sel,m); refreshStats(m);
  }
}

function renderHist() {
  const el=document.getElementById('histList');
  if(!hist.length){el.innerHTML='<div style="font-size:11px;color:var(--text-dim);padding:5px 0">Nincs még számítás.</div>';return;}
  el.innerHTML=hist.slice(0,8).map(h=>{
    const c=probColor(h.cP/100);
    return `<div class="hist-row">
      <span style="color:var(--text-dim);font-size:10px">${h.name} · ${h.pct}% · ${h.marginPP>=0?'+':''}${h.marginPP.toFixed(1)}pp</span>
      <span style="color:${c};font-family:var(--cond);font-size:14px;font-weight:700">${h.cP.toFixed(1)}%</span>
    </div>`;
  }).join('');
}

document.getElementById('searchInput').addEventListener('input',e=>renderList(e.target.value));
document.getElementById('margin').addEventListener('input',()=>{
  if(sel){const m=parseFloat(document.getElementById('margin').value)||0;drawChart(sel,m);refreshStats(m);}
});

setInterval(()=>{
  document.getElementById('clock').textContent=new Date().toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
},1000);

const ro=new ResizeObserver(()=>{
  if(sel){const m=parseFloat(document.getElementById('margin').value)||0;drawChart(sel,m);}
});
ro.observe(document.getElementById('cv').parentElement);

renderList();
loadCandidatesFromURL();
setTimeout(()=>selectOevk(Object.values(OEVK_DATA)[0]),80);

setInterval(async ()=>{
  processResultsJSON(await fetchResultsFromServer());
}, 5000);
