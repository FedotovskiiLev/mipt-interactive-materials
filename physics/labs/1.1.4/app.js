(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const fileInput = $('fileInput');
  const dataText = $('dataText');
  const analyzeBtn = $('analyzeBtn');
  const sampleBtn = $('sampleBtn');
  const baseTauInput = $('baseTau');
  const tauInput = $('tau');
  const tauListInput = $('tauList');
  const dataStatus = $('dataStatus');
  const statsEl = $('stats');
  const sigmaCheck = $('sigmaCheck');
  const compareBody = $('compareBody');

  let rawData = [];
  let current = [];
  let currentStats = null;

  const COLORS = { bars:'#b7c9d9', poisson:'#315f8f', gaussian:'#8b5b70', data:'#315f8f', theory:'#806b37', grid:'#e4e8ec', text:'#5f6a74' };

  function parseData(text) {
    const values = [];
    for (const original of String(text).split(/\r?\n/)) {
      const line = original.split('#')[0].trim();
      if (!line) continue;
      const matches = line.match(/[-+]?\d+(?:[.,]\d+)?/g) || [];
      for (const token of matches) {
        const value = Number(token.replace(',', '.'));
        if (Number.isFinite(value)) values.push(value);
      }
    }
    return values;
  }

  function groupData(data, factor) {
    const grouped = [];
    for (let i = 0; i + factor <= data.length; i += factor) {
      let sum = 0;
      for (let j = 0; j < factor; j++) sum += data[i + j];
      grouped.push(sum);
    }
    return grouped;
  }

  function stats(data, tau) {
    const N = data.length;
    if (!N) return null;
    let sum = 0, sum2 = 0;
    for (const x of data) { sum += x; sum2 += x * x; }
    const mean = sum / N;
    const variance = Math.max(0, sum2 / N - mean * mean);
    const sigma = Math.sqrt(variance);
    const sem = sigma / Math.sqrt(N);
    return {
      N, sum, mean, variance, sigma, sem, tau,
      intensity: mean / tau,
      intensitySem: sem / tau,
      rel: mean !== 0 ? sem / Math.abs(mean) : 0,
      sqrtMean: mean >= 0 ? Math.sqrt(mean) : NaN,
      within1: fractionWithin(data, mean, sigma),
      within2: fractionWithin(data, mean, 2 * sigma),
      within3: fractionWithin(data, mean, 3 * sigma)
    };
  }

  function fractionWithin(data, center, radius) {
    if (!data.length) return 0;
    return data.filter(x => Math.abs(x - center) <= radius + 1e-12).length / data.length;
  }

  function format(x, digits=4) {
    if (!Number.isFinite(x)) return '—';
    const ax = Math.abs(x);
    if (ax !== 0 && (ax >= 1e5 || ax < 1e-3)) return x.toExponential(2);
    return Number(x.toFixed(digits)).toString();
  }

  function getGroupedForTau(tau) {
    const base = Number(baseTauInput.value);
    if (!(base > 0) || !(tau > 0)) throw new Error('τ и τ₀ должны быть положительными.');
    const ratio = tau / base;
    const factor = Math.round(ratio);
    if (factor < 1 || Math.abs(ratio - factor) > 1e-8) throw new Error('Анализируемый τ должен быть целым кратным базового τ₀.');
    return { data: groupData(rawData, factor), factor };
  }

  function updateAnalysis() {
    try {
      if (!rawData.length) throw new Error('Сначала загрузите данные.');
      const tau = Number(tauInput.value);
      const { data, factor } = getGroupedForTau(tau);
      if (data.length < 2) throw new Error('После группировки осталось слишком мало точек.');
      current = data;
      currentStats = stats(data, tau);
      const dropped = rawData.length % factor;
      dataStatus.className = 'status';
      dataStatus.textContent = `Исходных значений: ${rawData.length}. Для τ=${tau} с получено ${data.length} интервалов${dropped ? `; отброшено ${dropped} знач.` : ''}.`;
      renderStats();
      renderSigma();
      renderComparison();
      drawAll();
    } catch (error) {
      dataStatus.className = 'status error';
      dataStatus.textContent = error.message;
    }
  }

  function renderStats() {
    const s = currentStats;
    const items = [
      ['N', s.N], ['Σn', format(s.sum,2)], ['⟨n⟩', format(s.mean)], ['σₙ', format(s.sigma)],
      ['σ⟨n⟩', format(s.sem)], ['√⟨n⟩', format(s.sqrtMean)], ['j, с⁻¹', format(s.intensity)], ['ε', `${format(100*s.rel,3)}%`]
    ];
    statsEl.innerHTML = '';
    for (const [label, value] of items) {
      const box = document.createElement('div'); box.className = 'stat';
      const small = document.createElement('small'); small.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = value;
      box.append(small, strong); statsEl.append(box);
    }
  }

  function renderSigma() {
    const rows = [[1,currentStats.within1,.6827],[2,currentStats.within2,.9545],[3,currentStats.within3,.9973]];
    sigmaCheck.innerHTML = '';
    for (const [k, actual, normal] of rows) {
      const box = document.createElement('div'); box.className = 'sigma-box';
      const small = document.createElement('small'); small.textContent = `|n−⟨n⟩| ≤ ${k}σ`;
      const strong = document.createElement('strong'); strong.textContent = `${(actual*100).toFixed(1)}%`;
      const ref = document.createElement('small'); ref.textContent = `Гаусс: ${(normal*100).toFixed(1)}%`;
      box.append(small,strong,ref); sigmaCheck.append(box);
    }
  }

  function parseTauList() {
    const vals = tauListInput.value.split(/[;,\s]+/).map(Number).filter(x => Number.isFinite(x) && x > 0);
    return [...new Set(vals)].slice(0, 12);
  }

  function renderComparison() {
    compareBody.innerHTML = '';
    for (const tau of parseTauList()) {
      try {
        const { data } = getGroupedForTau(tau);
        if (!data.length) continue;
        const s = stats(data, tau);
        const tr = document.createElement('tr');
        for (const value of [format(tau,3), s.N, format(s.mean), format(s.sigma), format(s.sqrtMean), format(s.sem), format(s.intensity), format(s.intensitySem), `${format(100*s.rel,3)}%`]) {
          const td = document.createElement('td'); td.textContent = value; tr.append(td);
        }
        compareBody.append(tr);
      } catch (_) {}
    }
  }

  function canvasSetup(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(280, rect.width), h = Math.max(220, rect.height);
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    return {ctx,w,h};
  }

  function axes(ctx,w,h, pad, xLabel='', yLabel='') {
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,h-pad.b); ctx.lineTo(w-pad.r,h-pad.b); ctx.stroke();
    ctx.fillStyle = COLORS.text; ctx.font = '12px system-ui';
    if (xLabel) { ctx.textAlign='right'; ctx.fillText(xLabel,w-pad.r,h-8); }
    if (yLabel) { ctx.save(); ctx.translate(13,pad.t); ctx.rotate(-Math.PI/2); ctx.textAlign='right'; ctx.fillText(yLabel,0,0); ctx.restore(); }
  }

  function histogramDiscrete(data) {
    const map = new Map();
    for (const x of data) {
      const k = Math.round(x);
      map.set(k,(map.get(k)||0)+1);
    }
    const keys = [...map.keys()].sort((a,b)=>a-b);
    return { map, min:keys[0], max:keys[keys.length-1] };
  }

  function logGamma(z) {
    const p=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.984369578019571e-6,1.5056327351493116e-7];
    if(z<.5) return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
    z-=1; let x=.9999999999998099; for(let i=0;i<p.length;i++) x+=p[i]/(z+i+1);
    const t=z+p.length-.5; return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);
  }
  function poissonPMF(k,mu){ if(k<0||mu<0)return 0; if(mu===0)return k===0?1:0; return Math.exp(k*Math.log(mu)-mu-logGamma(k+1)); }
  function erf(x){ const s=Math.sign(x); x=Math.abs(x); const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911; const t=1/(1+p*x); const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x); return s*y; }
  function normalCDF(x,mu,s){ if(s<=0)return x<mu?0:1; return .5*(1+erf((x-mu)/(s*Math.SQRT2))); }
  function normalBin(k,mu,s){ return Math.max(0, normalCDF(k+.5,mu,s)-normalCDF(k-.5,mu,s)); }

  function drawHistogram() {
    const canvas=$('histChart'), {ctx,w,h}=canvasSetup(canvas), pad={l:48,r:18,t:16,b:42};
    axes(ctx,w,h,pad,'n','частота'); if(!current.length)return;
    const hist=histogramDiscrete(current); const min=Math.max(0,hist.min-1), max=hist.max+1, count=max-min+1;
    const empirical=[]; let ymax=0;
    for(let k=min;k<=max;k++){ const v=(hist.map.get(k)||0)/current.length; const p=poissonPMF(k,currentStats.mean); const g=normalBin(k,currentStats.mean,currentStats.sqrtMean); empirical.push({k,v,p,g}); ymax=Math.max(ymax,v,p,g); }
    ymax*=1.16; if(ymax<=0)ymax=1;
    const plotW=w-pad.l-pad.r, plotH=h-pad.t-pad.b, step=plotW/count;
    const X=k=>pad.l+(k-min+.5)*step, Y=v=>h-pad.b-v/ymax*plotH;
    ctx.fillStyle=COLORS.bars;
    for(const d of empirical){ const bw=Math.max(1,step*.72); ctx.fillRect(X(d.k)-bw/2,Y(d.v),bw,h-pad.b-Y(d.v)); }
    function line(key,color){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();empirical.forEach((d,i)=>{const x=X(d.k),y=Y(d[key]);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()}
    line('p',COLORS.poisson); line('g',COLORS.gaussian);
    ctx.fillStyle=COLORS.text;ctx.font='11px system-ui';ctx.textAlign='center';
    const every=Math.max(1,Math.ceil(count/10)); for(let k=min;k<=max;k+=every)ctx.fillText(String(k),X(k),h-pad.b+17);
    ctx.textAlign='right'; for(let i=0;i<=4;i++){const v=ymax*i/4,y=Y(v);ctx.fillText(v.toFixed(2),pad.l-6,y+4);ctx.strokeStyle=COLORS.grid;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke()}
  }

  function sampledIndices(N,max=280){const out=[];const start=Math.min(2,N);if(N<=max){for(let n=start;n<=N;n++)out.push(n);return out}for(let i=0;i<max;i++){const n=Math.max(start,Math.round(start*Math.pow(N/start,i/(max-1))));if(out[out.length-1]!==n)out.push(n)}return out}

  function drawMean() {
    const canvas=$('meanChart'),{ctx,w,h}=canvasSetup(canvas),pad={l:52,r:18,t:16,b:42};axes(ctx,w,h,pad,'N','среднее');if(!current.length)return;
    const prefix=[0];for(const x of current)prefix.push(prefix[prefix.length-1]+x);
    const ns=sampledIndices(current.length,350);const ys=ns.map(n=>prefix[n]/n);let ymin=Math.min(...ys,currentStats.mean),ymax=Math.max(...ys,currentStats.mean);if(ymax===ymin){ymax+=1;ymin-=1}else{const d=(ymax-ymin)*.12;ymin-=d;ymax+=d}
    const X=n=>pad.l+(n-1)/(Math.max(2,current.length)-1)*(w-pad.l-pad.r),Y=v=>h-pad.b-(v-ymin)/(ymax-ymin)*(h-pad.t-pad.b);
    ctx.strokeStyle=COLORS.grid;ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(pad.l,Y(currentStats.mean));ctx.lineTo(w-pad.r,Y(currentStats.mean));ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle=COLORS.data;ctx.lineWidth=2;ctx.beginPath();ns.forEach((n,i)=>i?ctx.lineTo(X(n),Y(prefix[n]/n)):ctx.moveTo(X(n),Y(prefix[n]/n)));ctx.stroke();
    ctx.fillStyle=COLORS.text;ctx.font='11px system-ui';ctx.textAlign='right';for(let i=0;i<=4;i++){const v=ymin+(ymax-ymin)*i/4;ctx.fillText(format(v,2),pad.l-6,Y(v)+4)}ctx.textAlign='center';for(const n of [1,Math.round(current.length/2),current.length])ctx.fillText(String(n),X(Math.max(1,n)),h-pad.b+17);
  }

  function prefixStats(data,n){let s=0,s2=0;for(let i=0;i<n;i++){s+=data[i];s2+=data[i]*data[i]}const m=s/n,v=Math.max(0,s2/n-m*m);return {mean:m,sem:Math.sqrt(v)/Math.sqrt(n)}}
  function drawError() {
    const canvas=$('errorChart'),{ctx,w,h}=canvasSetup(canvas),pad={l:58,r:18,t:16,b:42};axes(ctx,w,h,pad,'log N','log σ⟨n⟩');if(current.length<5)return;
    const ns=sampledIndices(current.length,100).filter(n=>n>=5);const data=ns.map(n=>({n,sem:prefixStats(current,n).sem,theory:Math.sqrt(Math.max(currentStats.mean,1e-12)/n)})).filter(d=>d.sem>0);
    if(!data.length)return;const xs=data.map(d=>Math.log10(d.n)), ys=data.flatMap(d=>[Math.log10(d.sem),Math.log10(d.theory)]);let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);if(xmax===xmin)xmax=xmin+1;if(ymax===ymin)ymax=ymin+1;const X=x=>pad.l+(x-xmin)/(xmax-xmin)*(w-pad.l-pad.r),Y=y=>h-pad.b-(y-ymin)/(ymax-ymin)*(h-pad.t-pad.b);
    function line(key,color){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();data.forEach((d,i)=>{const x=X(Math.log10(d.n)),y=Y(Math.log10(d[key]));i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()} line('sem',COLORS.data);line('theory',COLORS.theory);
    ctx.fillStyle=COLORS.text;ctx.font='11px system-ui';ctx.textAlign='right';for(let i=0;i<=4;i++){const v=ymin+(ymax-ymin)*i/4;ctx.fillText(v.toFixed(2),pad.l-6,Y(v)+4)}ctx.textAlign='center';for(let i=0;i<=4;i++){const v=xmin+(xmax-xmin)*i/4;ctx.fillText(v.toFixed(2),X(v),h-pad.b+17)}
  }

  function drawAll(){drawHistogram();drawMean();drawError()}

  fileInput.addEventListener('change', async () => {
    const file=fileInput.files?.[0]; if(!file)return;
    dataText.value=await file.text(); rawData=parseData(dataText.value); updateAnalysis();
  });
  analyzeBtn.addEventListener('click',()=>{rawData=parseData(dataText.value);updateAnalysis()});
  for(const el of [baseTauInput,tauInput,tauListInput]) el.addEventListener('change',()=>{if(rawData.length)updateAnalysis()});
  sampleBtn.addEventListener('click',async()=>{try{const r=await fetch('sample_data.txt',{cache:'no-cache'});if(!r.ok)throw new Error();dataText.value=await r.text();rawData=parseData(dataText.value);updateAnalysis()}catch(_){dataStatus.textContent='Не удалось загрузить sample_data.txt.'}});

  // --- Simulator ---
  function randNormal(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
  function randPoisson(lambda){if(lambda<30){const L=Math.exp(-lambda);let k=0,p=1;do{k++;p*=Math.random()}while(p>L);return k-1}return Math.max(0,Math.round(lambda+Math.sqrt(lambda)*randNormal()))}
  function simulate(){
    const type=$('dist').value,param=Number($('param').value),N=Math.max(10,Math.min(20000,Math.round(Number($('simN').value)||1000))),k=Math.max(1,Math.min(100,Math.round(Number($('groupSize').value)||1)));
    if(!(param>0)){ $('simStatus').textContent='Параметр должен быть положительным.'; return; }
    const raw=[];for(let i=0;i<N;i++){if(type==='poisson')raw.push(randPoisson(param));else if(type==='exponential')raw.push(-param*Math.log(Math.max(1e-12,1-Math.random())));else raw.push(Math.pow(Math.max(1e-12,1-Math.random()),-1/param));}
    const grouped=groupData(raw,k);drawContinuousHistogram(grouped,$('simChart'));const s=stats(grouped,k);$('simStatus').textContent=`Получено ${grouped.length} значений. Среднее ≈ ${format(s.mean,3)}, σ ≈ ${format(s.sigma,3)}.`;$('simCaption').textContent=`${type}, N=${N}, k=${k}`;
  }

  function drawContinuousHistogram(data,canvas){const {ctx,w,h}=canvasSetup(canvas),pad={l:48,r:18,t:16,b:42};axes(ctx,w,h,pad,'x','плотность');if(!data.length)return;const sorted=[...data].sort((a,b)=>a-b);const q=(p)=>sorted[Math.min(sorted.length-1,Math.floor(p*(sorted.length-1)))];let min=sorted[0],max=sorted[sorted.length-1];if(max-min>20*(q(.95)-q(.05))&&q(.95)>q(.05))max=q(.98);if(max===min){max=min+1}const bins=32,width=(max-min)/bins,counts=Array(bins).fill(0);let used=0;for(const x of data){if(x<min||x>max)continue;const i=Math.min(bins-1,Math.floor((x-min)/width));counts[i]++;used++}const dens=counts.map(c=>c/Math.max(1,used)/width),ymax=Math.max(...dens)*1.15||1,plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;ctx.fillStyle=COLORS.bars;for(let i=0;i<bins;i++){const x=pad.l+i/bins*plotW,y=h-pad.b-dens[i]/ymax*plotH,bw=plotW/bins*.88;ctx.fillRect(x,y,bw,h-pad.b-y)}ctx.fillStyle=COLORS.text;ctx.font='11px system-ui';ctx.textAlign='center';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;ctx.fillText(format(v,2),pad.l+i/4*plotW,h-pad.b+17)}}

  $('simulateBtn').addEventListener('click',simulate);
  $('dist').addEventListener('change',()=>{const t=$('dist').value;$('param').value=t==='pareto'?'2':'10';simulate()});

  let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(current.length)drawAll();simulate()},120)});
  simulate();
})();
