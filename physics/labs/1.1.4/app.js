(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const COLORS = {
    ink: '#17202a', muted: '#66727e', grid: '#dfe5eb', data: '#315f9a', data2: '#6f8fb2',
    poisson: '#1f7a6c', gaussian: '#9a7042', theory: '#8d5f8c', good: '#2f7b60'
  };

  const HIST_DEMO = [3,5,7,12,4,3,4,3,3,5,3,2,7,6,7,7,8,3,4,0,9,10,4,4,8,6,7,3,8,2,4,3,4,4,6,8,2,4,7,4,4,7,5,6,4,7,6,9,7,4,4,6,3,3,4,7,3,3,4,6,3,6,2,6,5,7,4,7,5,5,2,7,8,8,6,8,5,4,4,4,6,2,9,3,10,5,6,5,4,5,6,7,5,5,6,5,10,4,4,4];
  const GROUP_DEMO = [7,12,7,5,9,2,5,7,5,2,1,2,3,7,5,6,6,7,3,6,3,1,4,10,4,6,4,3,3,1,2,1,4,3,2,8,4,12,7,13,4,5,0,2,8,5,1,6,6,6,6,4,6,6,1,6,5,6,3,3,5,7,5,5,5,7,4,1,4,6,7,8,2,1,3,7,4,5,5,7,4,1,6,3,5,5,3,6,8,4,6,5,7,3,5,7,3,4,4,3,3,6,5,5,2,1,2,6,6,5,4,4,9,2,4,4,7,9,2,3,4,3,7,3,6,1,4,3,9,5,2,4,5,3,5,8,6,3,3,2,4,3,5,6,6,4,7,0,2,8,4,1,3,8,5,5,5,5,3,5];

  // ---------- Общие вычисления ----------
  function format(value, digits = 3) {
    if (!Number.isFinite(value)) return '—';
    const a = Math.abs(value);
    if (a !== 0 && (a < 0.001 || a >= 100000)) return value.toExponential(2).replace('.', ',');
    return value.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }

  function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

  function stats(data, tau = 1) {
    const N = data.length;
    if (!N) return null;
    const total = sum(data);
    const mean = total / N;
    const mean2 = data.reduce((s, x) => s + x * x, 0) / N;
    const variance = Math.max(0, mean2 - mean * mean); // именно 1/N
    const sigma = Math.sqrt(variance);
    const sem = sigma / Math.sqrt(N);
    const sqrtMean = Math.sqrt(Math.max(0, mean));
    const intensity = mean / tau;
    const sigmaJ = sem / tau;
    const relative = mean !== 0 ? sem / mean : NaN;
    const poissonRelative = total > 0 ? 1 / Math.sqrt(total) : NaN;
    return { N, total, mean, mean2, variance, sigma, sem, sqrtMean, intensity, sigmaJ, relative, poissonRelative, tau };
  }

  function groupData(data, k) {
    const out = [];
    for (let i = 0; i + k <= data.length; i += k) {
      let s = 0;
      for (let j = 0; j < k; j++) s += data[i + j];
      out.push(s);
    }
    return out;
  }

  function parseLabFile(text) {
    const values = [];
    const meta = { kind:'unknown', distribution:null, mu:null, start:null, stop:null, declaredCount:null };
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        const c=line.replace(/^#\s*/,'').trim();
        if (/^Симуляция\b/i.test(c)) meta.kind='simulation';
        let m=c.match(/^Начало эксперимента\s+в\s+(.+)$/i); if(m){meta.kind='experiment';meta.start=m[1].trim()}
        m=c.match(/^остановка эксперимента\s+в\s+(.+)$/i); if(m){meta.kind='experiment';meta.stop=m[1].trim()}
        m=c.match(/^Распределение:\s*([^,]+),\s*интенсивность\s+mu\s*=\s*([0-9.,]+)/i); if(m){meta.kind='simulation';meta.distribution=m[1].trim().toLowerCase();meta.mu=Number(m[2].replace(',','.'))}
        m=c.match(/^количество точек\s+(\d+)/i); if(m)meta.declaredCount=Number(m[1]);
        continue;
      }
      const clean=line.split('#')[0];
      for(const token of clean.split(/[;\s]+/)){
        if(!token)continue;
        const x=Number(token.replace(',','.'));
        if(Number.isFinite(x))values.push(x);
      }
    }
    return {values,meta};
  }
  function parseData(text) { return parseLabFile(text).values; }
  function serializeLabFile(values,meta={}){
    const head=[];
    if(meta.kind==='simulation'){
      head.push('# Симуляция на основе генератора псевдослучайных чисел');
      if(meta.distribution)head.push(`# Распределение: ${meta.distribution}${Number.isFinite(meta.mu)?`, интенсивность mu = ${meta.mu}`:''}`);
    }else if(meta.kind==='experiment'){
      if(meta.start)head.push(`# Начало эксперимента в  ${meta.start}`);
    }
    head.push(...values.map(v=>String(v)));
    head.push(`# количество точек ${values.length}`);
    if(meta.kind==='experiment'&&meta.stop)head.push(`# остановка эксперимента в ${meta.stop}`);
    return head.join('\n')+'\n';
  }
  function metaSummary(meta){
    const parts=[];
    if(meta?.kind==='experiment')parts.push(['тип','эксперимент']);
    else if(meta?.kind==='simulation')parts.push(['тип','симуляция']);
    if(meta?.distribution)parts.push(['распределение',meta.distribution]);
    if(Number.isFinite(meta?.mu))parts.push(['μ',format(meta.mu,3)]);
    if(meta?.start)parts.push(['начало',meta.start]);
    if(meta?.stop)parts.push(['остановка',meta.stop]);
    if(Number.isFinite(meta?.declaredCount))parts.push(['заявлено точек',meta.declaredCount]);
    return parts;
  }

  function logGamma(z) {
    const p = [676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.984369578019571e-6,1.5056327351493116e-7];
    if (z < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let x = .9999999999998099;
    for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
    const t = z + p.length - .5;
    return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x);
  }
  function poissonPMF(k, mu) {
    if (k < 0 || mu < 0) return 0;
    if (mu === 0) return k === 0 ? 1 : 0;
    return Math.exp(k * Math.log(mu) - mu - logGamma(k + 1));
  }
  function gaussianDensity(x, mu, sigma) {
    if (!(sigma > 0)) return 0;
    return Math.exp(-.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
  }

  // ---------- 00. Теория с нуля ----------
  const theoryItems=$$('#theoryAccordion details, #methodicDepth details');
  $('openAllTheory').addEventListener('click',()=>theoryItems.forEach(d=>d.open=true));
  $('closeAllTheory').addEventListener('click',()=>theoryItems.forEach(d=>d.open=false));

  // ---------- 01. Схема измерения ----------
  const PULSE_TIMES = [0.18,0.71,1.14,1.43,1.86,2.21,2.83,3.08,3.51,3.73,4.16,4.88,5.09,5.27,5.92,6.45,6.62,7.18,7.39,7.77];
  let measureTau = 1;

  function renderMeasurement() {
    const timeline = $('pulseTimeline');
    const strip = $('countStrip');
    timeline.innerHTML = '';
    strip.innerHTML = '';

    for (let i = 0; i < PULSE_TIMES.length; i++) {
      const t = PULSE_TIMES[i];
      const pulse = document.createElement('span');
      pulse.className = 'pulse';
      pulse.style.left = `${(t / 8) * 100}%`;
      pulse.style.setProperty('--h', `${30 + (i % 5) * 8}px`);
      pulse.title = `регистрация в t ≈ ${t.toFixed(2)} с`;
      timeline.append(pulse);
    }

    const groups = 8 / measureTau;
    const overlay = document.createElement('div');
    overlay.className = 'interval-overlay';
    overlay.style.gridTemplateColumns = `repeat(${groups},1fr)`;
    for (let i = 0; i < groups; i++) overlay.append(document.createElement('span'));
    timeline.append(overlay);

    const counts = [];
    for (let g = 0; g < groups; g++) {
      const lo = g * measureTau, hi = lo + measureTau;
      const c = PULSE_TIMES.filter(t => t >= lo && (t < hi || (g === groups - 1 && t <= hi))).length;
      counts.push(c);
      const cell = document.createElement('div');
      cell.className = 'count-cell';
      cell.innerHTML = `<b>${c}</b><small>${lo}–${hi} с</small>`;
      strip.append(cell);
    }
    strip.style.gridTemplateColumns = `repeat(${groups},minmax(54px,1fr))`;
    $('measureCaption').innerHTML = `Эта же последовательность импульсов при τ = <b>${measureTau} с</b> превращается в отсчёты <b>${counts.join(', ')}</b>. При увеличении τ соседние интервалы объединяются.`;
  }

  $$('#measureTauButtons button').forEach(btn => btn.addEventListener('click', () => {
    measureTau = Number(btn.dataset.tau);
    $$('#measureTauButtons button').forEach(b => b.classList.toggle('active', b === btn));
    renderMeasurement();
  }));

  // ---------- 02. Пошаговая статистика ----------
  const MINI_DEFAULT = [2,4,3,5,2,4,6,2];
  let miniData = [...MINI_DEFAULT];
  let statStep = 'mean';

  function renderEditableCounts() {
    const box = $('editableCounts');
    box.innerHTML = '';
    miniData.forEach((value, i) => {
      const label = document.createElement('label');
      label.innerHTML = `<span>n${i + 1}</span>`;
      const input = document.createElement('input');
      input.type = 'number'; input.step = '1'; input.value = value;
      input.addEventListener('input', () => {
        const x = Number(input.value);
        miniData[i] = Number.isFinite(x) ? x : 0;
        renderStatStep();
      });
      label.append(input); box.append(label);
    });
  }

  function renderStatStep() {
    const s = stats(miniData, 1);
    const box = $('statStepContent');
    if (!s) return;
    if (statStep === 'mean') {
      box.innerHTML = `
        <div class="calc-title">Среднее число регистраций</div>
        <div class="calc-chain">
          <span class="calc-box">Σnᵢ = ${format(s.total, 2)}</span><span>→</span>
          <span class="calc-box">N = ${s.N}</span><span>→</span>
          <span class="calc-box">⟨n⟩ = ${format(s.total,2)} / ${s.N}</span>
        </div>
        <div class="calc-result"><b>⟨n⟩ = ${format(s.mean,3)}</b><br><span>Это одно число, характеризующее центр всей серии.</span></div>`;
    } else if (statStep === 'variance') {
      const rows = miniData.map((x, i) => `<tr><td>n${i + 1} = ${format(x,2)}</td><td>${format(x - s.mean,3)}</td><td>${format((x - s.mean) ** 2,3)}</td></tr>`).join('');
      const sqsum = miniData.reduce((a, x) => a + (x - s.mean) ** 2, 0);
      box.innerHTML = `
        <div class="calc-title">Сначала смотрим отклонения от среднего</div>
        <table class="deviation-table"><thead><tr><th>отсчёт</th><th>nᵢ − ⟨n⟩</th><th>(nᵢ − ⟨n⟩)²</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="calc-result"><b>σₙ² = (1/N) Σ(nᵢ − ⟨n⟩)² = ${format(sqsum,3)} / ${s.N} = ${format(s.variance,3)}</b></div>
        <div class="shortcut">Та же формула в короткой записи из методички: <b>σₙ² = ⟨n²⟩ − ⟨n⟩²</b>.</div>`;
    } else if (statStep === 'sigma') {
      box.innerHTML = `
        <div class="calc-title">Стандартное отклонение — корень из дисперсии</div>
        <div class="calc-chain"><span class="calc-box">σₙ² = ${format(s.variance,3)}</span><span>→ √</span><span class="calc-box">σₙ = ${format(s.sigma,3)}</span></div>
        <div class="calc-result"><b>σₙ = ${format(s.sigma,3)}</b><br><span>Это характерный разброс отдельных nᵢ вокруг ⟨n⟩.</span></div>`;
    } else {
      box.innerHTML = `
        <div class="calc-title">Среднее само тоже найдено с конечной точностью</div>
        <div class="calc-chain"><span class="calc-box">σₙ = ${format(s.sigma,3)}</span><span>÷</span><span class="calc-box">√N = √${s.N}</span><span>→</span><span class="calc-box">σ⟨n⟩ = ${format(s.sem,3)}</span></div>
        <div class="calc-result"><b>⟨n⟩ = ${format(s.mean,3)} ± ${format(s.sem,3)}</b><br><span>Именно σ⟨n⟩ уменьшается при увеличении числа измерений N.</span></div>`;
    }
  }

  $$('.stat-step-tabs button').forEach(btn => btn.addEventListener('click', () => {
    statStep = btn.dataset.step;
    $$('.stat-step-tabs button').forEach(b => b.classList.toggle('active', b === btn));
    renderStatStep();
  }));
  $('resetMiniData').addEventListener('click', () => { miniData = [...MINI_DEFAULT]; renderEditableCounts(); renderStatStep(); });

  // ---------- 03. Гистограмма частот ----------
  let histN = 20;
  let selectedHistValue = null;

  function renderFrequencyHistogram() {
    const data = HIST_DEMO.slice(0, histN);
    const min = Math.min(...data), max = Math.max(...data);
    const counts = new Map();
    data.forEach(x => counts.set(x, (counts.get(x) || 0) + 1));
    const maxFreq = Math.max(...[...counts.values()].map(c => c / data.length));
    const box = $('frequencyHistogram');
    box.innerHTML = '';
    for (let n = min; n <= max; n++) {
      const c = counts.get(n) || 0;
      const w = c / data.length;
      const wrap = document.createElement('div'); wrap.className = 'freq-bar-wrap';
      const value = document.createElement('span'); value.className = 'freq-bar-value'; value.textContent = w ? format(w,2) : '';
      const bar = document.createElement('button'); bar.type = 'button'; bar.className = 'freq-bar';
      bar.style.height = `${Math.max(2, (w / maxFreq) * 180)}px`; bar.title = `n=${n}, Nₙ=${c}, wₙ=${format(w,3)}`;
      if (selectedHistValue === n) bar.classList.add('active');
      bar.addEventListener('click', () => { selectedHistValue = n; renderFrequencyHistogram(); renderHistInfo(n, c, data.length); });
      const label = document.createElement('span'); label.className = 'freq-bar-label'; label.textContent = n;
      wrap.append(value, bar, label); box.append(wrap);
    }
    if (selectedHistValue != null && selectedHistValue >= min && selectedHistValue <= max) {
      renderHistInfo(selectedHistValue, counts.get(selectedHistValue) || 0, data.length);
    }
  }
  function renderHistInfo(n, c, N) {
    $('histInfo').innerHTML = `<b>n = ${n}</b> встретилось <b>Nₙ = ${c}</b> раз из <b>N = ${N}</b>.<br>Поэтому <b>wₙ = Nₙ/N = ${c}/${N} = ${format(c/N,3)}</b>.`;
  }
  $$('#histNButtons button').forEach(btn => btn.addEventListener('click', () => {
    histN = Number(btn.dataset.n); selectedHistValue = null;
    $$('#histNButtons button').forEach(b => b.classList.toggle('active', b === btn));
    $('histInfo').textContent = 'Выберите столбец на гистограмме.';
    renderFrequencyHistogram();
  }));

  // ---------- Canvas helpers ----------
  function canvasSetup(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, rect.width || 600), h = Math.max(220, rect.height || 330);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return {ctx,w,h};
  }
  function drawAxes(ctx,w,h,pad,xLabel,yLabel) {
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,h-pad.b); ctx.lineTo(w-pad.r,h-pad.b); ctx.stroke();
    ctx.fillStyle = COLORS.muted; ctx.font = '11px system-ui';
    ctx.textAlign = 'right'; ctx.fillText(xLabel,w-pad.r,h-8);
    ctx.save(); ctx.translate(13,pad.t); ctx.rotate(-Math.PI/2); ctx.textAlign = 'right'; ctx.fillText(yLabel,0,0); ctx.restore();
  }

  // ---------- 04. Пуассон ----------
  let poissonBars = [];
  function renderPoisson() {
    const mu = Number($('poissonMean').value);
    let k = Number($('poissonK').value);
    const maxK = Math.max(12, Math.ceil(mu + 4 * Math.sqrt(mu)));
    $('poissonK').max = maxK;
    if (k > maxK) { k = Math.round(mu); $('poissonK').value = k; }
    $('poissonMeanValue').textContent = format(mu,0);
    $('poissonSigmaValue').textContent = format(Math.sqrt(mu),3);
    $('poissonKValue').textContent = k;
    const p = poissonPMF(k,mu);
    $('poissonProbValue').innerHTML = `wₙ = <b>${format(p,5)}</b>`;
    $('poissonNumeric').textContent = `При n̄ = ${mu} и n = ${k}: вероятность по формуле ≈ ${format(p*100,2)}%`;

    const toggle = $('gaussToggle');
    toggle.disabled = mu < 10;
    if (mu < 10) toggle.checked = false;
    $('gaussNote').textContent = mu < 10
      ? 'В методичке гауссово приближение предлагается использовать при достаточно большом среднем; практически указано n̄ ≳ 10.'
      : 'Для этого среднего можно включить гауссову кривую и сравнить форму с распределением Пуассона.';

    const canvas = $('poissonChart');
    const {ctx,w,h} = canvasSetup(canvas); const pad = {l:48,r:18,t:18,b:40};
    drawAxes(ctx,w,h,pad,'n','wₙ');
    const vals = [];
    let ymax = 0;
    for (let n=0;n<=maxK;n++) { const v=poissonPMF(n,mu); vals.push(v); ymax=Math.max(ymax,v); }
    ymax *= 1.15;
    const plotW=w-pad.l-pad.r, plotH=h-pad.t-pad.b, step=plotW/(maxK+1);
    const X=n=>pad.l+(n+.5)*step, Y=v=>h-pad.b-(v/ymax)*plotH;
    poissonBars=[];
    vals.forEach((v,n)=>{
      const bw=Math.max(4,step*.68), x=X(n)-bw/2, y=Y(v);
      ctx.fillStyle = n===k ? '#315f9a' : '#6f8fb2'; ctx.fillRect(x,y,bw,h-pad.b-y);
      poissonBars.push({n,x,y,w:bw,h:h-pad.b-y});
    });
    if (toggle.checked && mu >= 10) {
      ctx.strokeStyle=COLORS.gaussian; ctx.lineWidth=2; ctx.beginPath();
      const sigma=Math.sqrt(mu);
      for(let i=0;i<=260;i++){
        const xVal=(i/260)*maxK, dens=gaussianDensity(xVal,mu,sigma), x=pad.l+(xVal+.5)*step, y=Y(dens);
        i?ctx.lineTo(x,y):ctx.moveTo(x,y);
      }
      ctx.stroke();
    }
    ctx.fillStyle=COLORS.muted;ctx.font='10px system-ui';ctx.textAlign='center';
    const every=Math.max(1,Math.ceil((maxK+1)/12));
    for(let n=0;n<=maxK;n+=every)ctx.fillText(String(n),X(n),h-pad.b+16);
    ctx.textAlign='right'; for(let i=0;i<=4;i++){const v=ymax*i/4;ctx.fillText(v.toFixed(2),pad.l-5,Y(v)+3)}
  }
  $('poissonMean').addEventListener('input', renderPoisson);
  $('poissonK').addEventListener('input', renderPoisson);
  $('gaussToggle').addEventListener('change', renderPoisson);
  $('poissonChart').addEventListener('click', (e) => {
    const rect=e.currentTarget.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top;
    const hit=poissonBars.find(b=>x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h);
    if(hit){$('poissonK').value=hit.n;renderPoisson()}
  });

  // ---------- 05. Группировка ----------
  let groupK = 1;
  function renderGrouping() {
    const visual=$('groupingVisual'); visual.innerHTML='';
    const raw=document.createElement('div'); raw.className='raw-cells';
    const shown=GROUP_DEMO.slice(0,Math.min(80,GROUP_DEMO.length));
    shown.forEach((x,i)=>{const c=document.createElement('span');c.className='raw-cell';c.textContent=x;c.title=`n${i+1}=${x}`;raw.append(c)});
    visual.append(raw);
    const grouped=groupData(GROUP_DEMO,groupK);
    const gShown=groupData(shown,groupK);
    const gRow=document.createElement('div');gRow.className='grouped-cells';
    gShown.forEach((x)=>{const b=document.createElement('div');b.className='group-box';b.style.width=`${Math.max(31,groupK*34-3)}px`;b.textContent=x;gRow.append(b)});
    visual.append(gRow);
    const s=stats(grouped,groupK);
    $('groupingSummary').innerHTML=`
      <div class="summary-chip"><span>интервал τ</span><b>${groupK} с</b></div>
      <div class="summary-chip"><span>число групп N</span><b>${s.N}</b></div>
      <div class="summary-chip"><span>⟨n⟩</span><b>${format(s.mean,3)}</b></div>
      <div class="summary-chip"><span>j = ⟨n⟩/τ</span><b>${format(s.intensity,3)} с⁻¹</b></div>`;
  }
  $$('#groupTauButtons button').forEach(btn=>btn.addEventListener('click',()=>{
    groupK=Number(btn.dataset.k);$$('#groupTauButtons button').forEach(b=>b.classList.toggle('active',b===btn));renderGrouping();
  }));

  // ---------- 06. Погрешность ----------
  function renderErrorSlider(){
    const n=Number($('totalEvents').value);$('totalEventsValue').textContent=n.toLocaleString('ru-RU');$('relativeErrorValue').textContent=`${format(100/Math.sqrt(n),2)}%`;
  }
  $('totalEvents').addEventListener('input',renderErrorSlider);

  // ---------- 07. Маршрут работы ----------
  const workflowTexts = {
    experiment: `<div class="work-grid"><div><h3>Основной эксперимент</h3><p>Запишите длинную последовательность числа регистраций. В методичке для основной серии указано время порядка <b>t = 4000 с</b> при <b>τ₀ = 1 с</b>, то есть около 4000 значений.</p></div><div class="work-highlight"><b>Результат этого этапа</b><p>Файл с последовательностью n₁, n₂, …, nᴺ, который дальше можно группировать и статистически обрабатывать.</p></div></div>`,
    'n-growth': `<div class="work-grid"><div><h3>Следите, что происходит при росте N</h3><ul><li>как стабилизируется ⟨n⟩;</li><li>как ведёт себя σₙ;</li><li>согласуется ли σₙ с √⟨n⟩;</li><li>как уменьшается σ⟨n⟩;</li><li>как выглядит гистограмма и теоретическое распределение.</li></ul></div><div class="work-highlight"><b>Отдельный график</b><p>Методичка предлагает исследовать ошибку среднего на логарифмических осях и сопоставить её с зависимостью, следующей из 1/√N.</p></div></div>`,
    tau: `<div class="work-grid"><div><h3>Перегруппируйте те же данные</h3><p>Для каждого выбранного τ складывайте последовательные секундные отсчёты блоками. Рассчитайте гистограмму, ⟨n⟩, σₙ, σ⟨n⟩, j и σⱼ.</p></div><div class="work-highlight"><b>Что сравнивать</b><p>Проверьте σₙ ≈ √⟨n⟩ и доли результатов в пределах ±σ, ±2σ, ±3σ. В методичке приведены разные примеры наборов τ, поэтому ниже анализатор позволяет вводить список самостоятельно.</p></div></div>`,
    simulation: `<div class="work-grid"><div><h3>Симуляция выполняется в лабораторной программе</h3><ul><li>изменяйте интенсивность μ;</li><li>переключайтесь на экспоненциальное распределение;</li><li>исследуйте Парето при α = 2,0 и α = 1,0.</li></ul></div><div class="work-highlight"><b>Почему на сайте нет собственного генератора?</b><p>Предоставленная методичка не задаёт программную параметризацию этих генераторов. Чтобы не подменять вашу программу сторонними соглашениями, сайт здесь остаётся инструкцией и журналом наблюдений.</p></div></div>`
  };
  function renderWorkflow(key='experiment'){$('workflowContent').innerHTML=workflowTexts[key]}
  $$('#workflowTabs button').forEach(btn=>btn.addEventListener('click',()=>{$$('#workflowTabs button').forEach(b=>b.classList.toggle('active',b===btn));renderWorkflow(btn.dataset.work)}));

  // ---------- 08. Анализ реальных данных ----------
  let rawData=[];
  let rawMeta={kind:'unknown',distribution:null,mu:null,start:null,stop:null,declaredCount:null};
  let currentData=[];
  let currentStats=null;
  let analysisMode='hist';
  let analysisBarHits=[];

  const fileInput=$('fileInput'),dataText=$('dataText'),baseTauInput=$('baseTau'),tauInput=$('tau'),tauListInput=$('tauList');
  function validateGrouping(){
    const base=Number(baseTauInput.value),tau=Number(tauInput.value);
    if(!(base>0&&tau>0))return{ok:false,msg:'τ₀ и τ должны быть положительными.'};
    const k=tau/base,ki=Math.round(k);if(Math.abs(k-ki)>1e-9||ki<1)return{ok:false,msg:'τ должен быть целым кратным τ₀.'};
    return{ok:true,k:ki,base,tau};
  }

  function updateAnalysis(){
    if(!rawData.length){$('dataStatus').textContent='Не найдено числовых данных.';return}
    const v=validateGrouping();if(!v.ok){$('dataStatus').textContent=v.msg;return}
    currentData=groupData(rawData,v.k);currentStats=stats(currentData,v.tau);
    if(!currentData.length){$('dataStatus').textContent='После группировки не осталось полных интервалов.';return}
    const metaBits=metaSummary(rawMeta).map(([k,val])=>`${k}: ${val}`).join(' · ');
    $('dataStatus').textContent=`Прочитано ${rawData.length} исходных значений. Для τ = ${format(v.tau,3)} с получено ${currentData.length} полных групп.${metaBits?` · ${metaBits}`:''}`;
    renderDashboard(v);
  }

  function renderDashboard(v){
    const s=currentStats,dashboard=$('analysisDashboard');dashboard.className='analysis-dashboard';
    const shares=[1,2,3].map(k=>({k,p:currentData.filter(x=>Math.abs(x-s.mean)<=k*s.sigma+1e-12).length/currentData.length}));
    const ratio=s.sqrtMean>0?s.sigma/s.sqrtMean:NaN;
    const metaHtml=metaSummary(rawMeta).length?`<div class="data-file-meta">${metaSummary(rawMeta).map(([k,val])=>`<span>${k}: <b>${val}</b></span>`).join('')}</div>`:'';
    dashboard.innerHTML=`${metaHtml}
      <div class="data-passport">
        ${metric('исходных отсчётов',rawData.length,'N₀')}
        ${metric('длительность исходной серии',`${format(rawData.length*v.base,2)} с`,'N₀τ₀')}
        ${metric('всего событий nΣ',format(sum(rawData),0),'Σnᵢ')}
        ${metric('полных групп',s.N,`τ = ${format(v.tau,2)} с`)}
      </div>
      <div class="analysis-grid">
        <div class="analysis-card">
          <div class="analysis-tabs">
            <button data-analysis="hist" class="${analysisMode==='hist'?'active':''}">Гистограмма</button>
            <button data-analysis="mean" class="${analysisMode==='mean'?'active':''}">Среднее при росте N</button>
            <button data-analysis="error" class="${analysisMode==='error'?'active':''}">Ошибка: log-log</button>
          </div>
          <canvas id="analysisChart"></canvas>
          <div class="chart-explainer" id="analysisExplain"></div>
        </div>
        <div class="analysis-card">
          <h3>Статистика для выбранного τ</h3>
          <p>Все величины рассчитаны из этой же сгруппированной серии.</p>
          <div class="analysis-stat-grid">
            ${analysisStat('⟨n⟩',format(s.mean,4))}
            ${analysisStat('σₙ²',format(s.variance,4))}
            ${analysisStat('σₙ',format(s.sigma,4))}
            ${analysisStat('√⟨n⟩',format(s.sqrtMean,4))}
            ${analysisStat('σ⟨n⟩',format(s.sem,4))}
            ${analysisStat('j',`${format(s.intensity,4)} с⁻¹`)}
            ${analysisStat('σⱼ',`${format(s.sigmaJ,4)} с⁻¹`)}
            ${analysisStat('ε по данным',`${format(s.relative*100,3)}%`)}
          </div>
          <div class="ratio-callout">Проверка свойства Пуассона: <b>σₙ / √⟨n⟩ = ${format(ratio,3)}</b>. Для согласия ожидается значение порядка 1.</div>
          <div class="ratio-callout">По пуассоновской формуле через nΣ: <b>1/√nΣ = ${format(s.poissonRelative*100,3)}%</b>.</div>
          <div class="sigma-share-list">${shares.map(x=>`<div class="sigma-share"><b>±${x.k}σ</b><span class="sigma-share-track"><i style="width:${Math.min(100,x.p*100)}%"></i></span><span>${format(x.p*100,1)}%</span></div>`).join('')}</div>
        </div>
      </div>
      <div class="compare-card"><h3>Сравнение нескольких τ</h3><p>Одна исходная серия, разные способы группировки.</p><div id="compareTable"></div></div>`;
    $$('.analysis-tabs button',dashboard).forEach(btn=>btn.addEventListener('click',()=>{analysisMode=btn.dataset.analysis;renderDashboard(v)}));
    drawAnalysisChart();renderCompareTable(v.base);
  }
  function metric(label,value,note){return `<div class="metric"><span>${label}</span><b>${value}</b><small>${note}</small></div>`}
  function analysisStat(label,value){return `<div class="analysis-stat"><span>${label}</span><b>${value}</b></div>`}

  function histogramMap(data){const map=new Map();for(const x of data){const k=Math.round(x);map.set(k,(map.get(k)||0)+1)}return map}
  function drawAnalysisChart(){
    const canvas=$('analysisChart');if(!canvas||!currentData.length)return;
    if(analysisMode==='hist')drawExperimentalHistogram(canvas);
    else if(analysisMode==='mean')drawRunningMean(canvas);
    else drawErrorLog(canvas);
  }

  function drawExperimentalHistogram(canvas){
    const {ctx,w,h}=canvasSetup(canvas),pad={l:50,r:18,t:18,b:42};drawAxes(ctx,w,h,pad,'n','wₙ');
    const map=histogramMap(currentData),keys=[...map.keys()].sort((a,b)=>a-b),min=keys[0],max=keys[keys.length-1];
    const vals=[];let ymax=0;for(let n=min;n<=max;n++){const emp=(map.get(n)||0)/currentData.length,p=poissonPMF(n,currentStats.mean),g=currentStats.mean>=10?gaussianDensity(n,currentStats.mean,Math.sqrt(currentStats.mean)):null;vals.push({n,emp,p,g});ymax=Math.max(ymax,emp,p,g||0)}ymax*=1.15;
    const plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b,step=plotW/vals.length,X=i=>pad.l+(i+.5)*step,Y=v=>h-pad.b-(v/ymax)*plotH;
    analysisBarHits=[];
    vals.forEach((d,i)=>{const bw=Math.max(3,step*.68),x=X(i)-bw/2,y=Y(d.emp);ctx.fillStyle=COLORS.data2;ctx.fillRect(x,y,bw,h-pad.b-y);analysisBarHits.push({n:d.n,x,y,w:bw,h:h-pad.b-y,count:map.get(d.n)||0});});
    ctx.strokeStyle=COLORS.poisson;ctx.lineWidth=2;ctx.beginPath();vals.forEach((d,i)=>i?ctx.lineTo(X(i),Y(d.p)):ctx.moveTo(X(i),Y(d.p)));ctx.stroke();
    if(currentStats.mean>=10){ctx.strokeStyle=COLORS.gaussian;ctx.beginPath();vals.forEach((d,i)=>i?ctx.lineTo(X(i),Y(d.g)):ctx.moveTo(X(i),Y(d.g)));ctx.stroke();}
    ctx.fillStyle=COLORS.muted;ctx.font='10px system-ui';ctx.textAlign='center';const every=Math.max(1,Math.ceil(vals.length/11));vals.forEach((d,i)=>{if(i%every===0)ctx.fillText(String(d.n),X(i),h-pad.b+16)});
    $('analysisExplain').innerHTML=`<b>Столбцы</b> — экспериментальные wₙ. <span style="color:${COLORS.poisson}">Зелёная линия</span> — Пуассон с n̄, оценённым как ⟨n⟩.${currentStats.mean>=10?` <span style="color:${COLORS.gaussian}">Коричневая линия</span> — гауссово приближение формы.`:''} Нажмите на столбец, чтобы увидеть Nₙ и wₙ.`;
    canvas.onclick=(e)=>{const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,hit=analysisBarHits.find(b=>x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h);if(hit)$('analysisExplain').innerHTML=`Для <b>n = ${hit.n}</b>: Nₙ = <b>${hit.count}</b>, N = <b>${currentData.length}</b>, поэтому wₙ = <b>${format(hit.count/currentData.length,4)}</b>.`};
  }
  function sampledIndices(N,max=260){const out=[];if(N<=max){for(let n=2;n<=N;n++)out.push(n);return out}for(let i=0;i<max;i++){const n=Math.max(2,Math.round(2*Math.pow(N/2,i/(max-1))));if(out.at(-1)!==n)out.push(n)}return out}
  function drawRunningMean(canvas){
    const {ctx,w,h}=canvasSetup(canvas),pad={l:52,r:18,t:18,b:42};drawAxes(ctx,w,h,pad,'N','⟨n⟩');
    const pref=[0];currentData.forEach(x=>pref.push(pref.at(-1)+x));const ns=sampledIndices(currentData.length),ys=ns.map(n=>pref[n]/n);let ymin=Math.min(...ys,currentStats.mean),ymax=Math.max(...ys,currentStats.mean);if(ymax===ymin){ymax+=1;ymin-=1}else{const d=(ymax-ymin)*.12;ymin-=d;ymax+=d}
    const X=n=>pad.l+(n-2)/(Math.max(3,currentData.length)-2)*(w-pad.l-pad.r),Y=v=>h-pad.b-(v-ymin)/(ymax-ymin)*(h-pad.t-pad.b);
    ctx.strokeStyle='#9aa7b3';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(pad.l,Y(currentStats.mean));ctx.lineTo(w-pad.r,Y(currentStats.mean));ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle=COLORS.data;ctx.lineWidth=2;ctx.beginPath();ns.forEach((n,i)=>i?ctx.lineTo(X(n),Y(pref[n]/n)):ctx.moveTo(X(n),Y(pref[n]/n)));ctx.stroke();
    $('analysisExplain').innerHTML=`Точка при каждом N показывает среднее, вычисленное по <b>первым N интервалам</b>. Пунктир — среднее по всей текущей серии. Этот график нужен, чтобы увидеть стабилизацию оценки при росте N.`;
    canvas.onclick=null;
  }
  function prefixStats(data,n){let s=0,s2=0;for(let i=0;i<n;i++){s+=data[i];s2+=data[i]*data[i]}const m=s/n,v=Math.max(0,s2/n-m*m);return{mean:m,sem:Math.sqrt(v)/Math.sqrt(n)}}
  function drawErrorLog(canvas){
    const {ctx,w,h}=canvasSetup(canvas),pad={l:58,r:18,t:18,b:42};drawAxes(ctx,w,h,pad,'log₁₀ N','log₁₀ σ⟨n⟩');
    const ns=sampledIndices(currentData.length,100).filter(n=>n>=5),data=ns.map(n=>({n,sem:prefixStats(currentData,n).sem,theory:Math.sqrt(Math.max(currentStats.mean,1e-12)/n)})).filter(d=>d.sem>0);if(!data.length)return;
    const xs=data.map(d=>Math.log10(d.n)),ys=data.flatMap(d=>[Math.log10(d.sem),Math.log10(d.theory)]);let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);if(xmax===xmin)xmax=xmin+1;if(ymax===ymin)ymax=ymin+1;
    const X=x=>pad.l+(x-xmin)/(xmax-xmin)*(w-pad.l-pad.r),Y=y=>h-pad.b-(y-ymin)/(ymax-ymin)*(h-pad.t-pad.b);
    const line=(key,color)=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();data.forEach((d,i)=>{const x=X(Math.log10(d.n)),y=Y(Math.log10(d[key]));i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()};line('sem',COLORS.data);line('theory',COLORS.theory);
    $('analysisExplain').innerHTML=`<span style="color:${COLORS.data}">Синяя линия</span> — σ⟨n⟩, пересчитанная по первым N значениям. <span style="color:${COLORS.theory}">Фиолетовая</span> — пуассоновская зависимость √(⟨n⟩/N), то есть закон 1/√N в логарифмических координатах.`;
    canvas.onclick=null;
  }

  function parseTauList(base){
    const vals=tauListInput.value.split(/[;,\s]+/).map(x=>Number(x.replace(',','.'))).filter(x=>x>0);const out=[];
    for(const tau of vals){const k=Math.round(tau/base);if(k>=1&&Math.abs(tau/base-k)<1e-9&&!out.some(x=>Math.abs(x.tau-tau)<1e-9))out.push({tau,k})}return out
  }
  function renderCompareTable(base){
    const rows=parseTauList(base).map(({tau,k})=>{const d=groupData(rawData,k),s=stats(d,tau);if(!s)return'';return`<tr><td>${format(tau,3)}</td><td>${s.N}</td><td>${format(s.mean,3)}</td><td>${format(s.sigma,3)}</td><td>${format(s.sqrtMean,3)}</td><td>${format(s.sem,4)}</td><td>${format(s.intensity,4)}</td><td>${format(s.sigmaJ,4)}</td><td>${format(s.poissonRelative*100,3)}%</td></tr>`}).join('');
    $('compareTable').innerHTML=`<div style="overflow:auto"><table class="compare-table"><thead><tr><th>τ, с</th><th>N</th><th>⟨n⟩</th><th>σₙ</th><th>√⟨n⟩</th><th>σ⟨n⟩</th><th>j, с⁻¹</th><th>σⱼ, с⁻¹</th><th>1/√nΣ</th></tr></thead><tbody>${rows||'<tr><td colspan="9">Нет корректных τ, кратных τ₀.</td></tr>'}</tbody></table></div>`;
  }

  fileInput.addEventListener('change',async()=>{const f=fileInput.files?.[0];if(!f)return;dataText.value=await f.text();const parsed=parseLabFile(dataText.value);rawData=parsed.values;rawMeta=parsed.meta;updateAnalysis()});
  $('analyzeBtn').addEventListener('click',()=>{const parsed=parseLabFile(dataText.value);rawData=parsed.values;rawMeta=parsed.meta;updateAnalysis()});
  [baseTauInput,tauInput,tauListInput].forEach(el=>el.addEventListener('change',()=>{if(rawData.length)updateAnalysis()}));
  $('sampleBtn').addEventListener('click',async()=>{try{const r=await fetch('sample_data.txt',{cache:'no-cache'});if(!r.ok)throw new Error();dataText.value=await r.text();const parsed=parseLabFile(dataText.value);rawData=parsed.values;rawMeta=parsed.meta;updateAnalysis()}catch(_){$('dataStatus').textContent='Не удалось загрузить учебный пример.'}});

  // ---------- 09. Учебная версия лабораторной программы ----------
  let programMode='experiment';
  let programData=[];
  let programMeta={kind:'unknown',distribution:null,mu:null,start:null,stop:null,declaredCount:null};
  let programShown=[];
  let programCursor=0;
  let programTimer=null;
  let programPlaybackState='idle';

  function poissonRandom(mu){
    const L=Math.exp(-mu);let k=0,p=1;
    do{k++;p*=Math.random()}while(p>L);
    return k-1;
  }
  function stopProgram(){
    if(programTimer){clearInterval(programTimer);programTimer=null}
  }
  function updateProgramPlaybackButtons(){
    const start=$('progStart'),pause=$('progPause');
    if(!start||!pause)return;
    if(programPlaybackState==='paused'){
      start.textContent='Продолжить';
      pause.disabled=true;
    }else if(programPlaybackState==='running'){
      start.textContent='Идёт…';
      pause.disabled=false;
    }else if(programPlaybackState==='finished'){
      start.textContent='Сначала';
      pause.disabled=true;
    }else{
      start.textContent='Старт';
      pause.disabled=true;
    }
  }
  function pauseProgram(){
    if(programPlaybackState!=='running')return;
    stopProgram();
    programPlaybackState='paused';
    $('progDataInfo').textContent=`Пауза: ${programCursor} из ${programData.length}. Нажмите «Продолжить».`;
    updateProgramPlaybackButtons();
  }
  function setProgramMode(mode){
    programMode=mode;
    $$('#programModeButtons button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    $('programExperimentControls').hidden=mode!=='experiment';
    $('programSimulationControls').hidden=mode!=='simulation';
    stopProgram();programShown=[];programCursor=0;programPlaybackState='idle';renderProgram();updateProgramPlaybackButtons();
    $('progDataInfo').textContent=mode==='experiment'?'Выберите запись эксперимента.':'Выберите распределение и источник серии.';
  }
  function setSimulationDistribution(kind){
    $('progPoissonSettings').hidden=kind!=='poisson';
    $('progExpSettings').hidden=kind!=='exp';
  }
  async function loadProgramFile(url,label){
    stopProgram();
    try{
      const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const parsed=parseLabFile(await r.text());
      setProgramData(parsed.values,label,parsed.meta);
    }catch(e){$('progDataInfo').textContent=`Не удалось загрузить пример: ${e.message}`}
  }
  function setProgramData(data,label,meta={}){
    stopProgram();
    programData=[...data];
    programMeta={kind:'unknown',distribution:null,mu:null,start:null,stop:null,declaredCount:null,...meta};
    programShown=[];
    programCursor=0;
    programPlaybackState='idle';
    $('progDataInfo').textContent=`${label}: ${programData.length} значений.`;
    renderProgram();
    updateProgramPlaybackButtons();
  }
  function resetProgramPlayback(){
    stopProgram();
    programShown=[];
    programCursor=0;
    programPlaybackState='idle';
    renderProgram();
    updateProgramPlaybackButtons();
    if(programData.length)$('progDataInfo').textContent=`Сброс: готово к запуску с начала (${programData.length} точек).`;
  }
  function startProgram(){
    if(!programData.length){
      $('progDataInfo').textContent='Сначала выберите или сгенерируйте серию.';
      return;
    }

    // После завершения новый запуск начинается с начала.
    // После паузы programCursor и programShown сохраняются, поэтому продолжаем с той же точки.
    if(programPlaybackState==='finished' || programCursor>=programData.length){
      programShown=[];
      programCursor=0;
    }

    stopProgram();
    programPlaybackState='running';
    $('progDataInfo').textContent=`Воспроизведение: ${programCursor} из ${programData.length}.`;
    updateProgramPlaybackButtons();

    programTimer=setInterval(()=>{
      const batch=Math.max(1,Number($('progSpeed').value)||1);
      for(let i=0;i<batch&&programCursor<programData.length;i++){
        programShown.push(programData[programCursor]);
        programCursor++;
      }
      renderProgram();
      if(programCursor>=programData.length){
        stopProgram();
        programPlaybackState='finished';
        $('progDataInfo').textContent=`Готово: показаны все ${programData.length} точек.`;
        updateProgramPlaybackButtons();
      }else{
        $('progDataInfo').textContent=`Воспроизведение: ${programCursor} из ${programData.length}.`;
      }
    },120);
  }

  function renderProgram(){
    const s=programShown.length?stats(programShown,1):null;
    $('progLiveN').textContent=programShown.length;
    $('progLiveCurrent').textContent=programShown.length?programShown.at(-1):'—';
    $('progLiveMean').textContent=s?format(s.mean,3):'—';
    $('progLiveSigma').textContent=s?format(s.sigma,3):'—';
    $('progLiveSem').textContent=s?format(s.sem,4):'—';
    $('progCursorLabel').textContent=`${programCursor} / ${programData.length}`;
    const recent=$('progRecent');recent.innerHTML='';programShown.slice(-18).forEach(v=>{const el=document.createElement('span');el.textContent=v;recent.append(el)});
    const chips=[...metaSummary(programMeta)];
    if(programData.length)chips.push(['точек',programData.length]);
    $('progMetadata').innerHTML=chips.length?chips.map(([k,v])=>`<span class="program-meta-chip">${k}: <b>${v}</b></span>`).join(''):'<span class="program-meta-chip">данные ещё не выбраны</span>';
    drawProgramTime();drawProgramHist();drawProgramMean();drawProgramError();
  }
  function programCanvas(id,xLabel,yLabel){const canvas=$(id);const setup=canvasSetup(canvas);const pad={l:48,r:16,t:15,b:38};drawAxes(setup.ctx,setup.w,setup.h,pad,xLabel,yLabel);return{...setup,pad}}
  function drawProgramTime(){
    const {ctx,w,h,pad}=programCanvas('programTimeChart',programMeta.kind==='experiment'?'t, с':'номер отсчёта','nᵢ');if(!programShown.length)return;
    const maxPts=120,start=Math.max(0,programShown.length-maxPts),view=programShown.slice(start),running=[];let total=0;
    for(let i=0;i<programShown.length;i++){total+=programShown[i];if(i>=start)running.push(total/(i+1))}
    const ymax=Math.max(1,...view,...running)*1.15,plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b,step=plotW/Math.max(1,view.length),Y=v=>h-pad.b-v/ymax*plotH;
    view.forEach((v,i)=>{const x=pad.l+i*step+step*.15,bw=Math.max(1,step*.7),y=Y(v);ctx.fillStyle=COLORS.data2;ctx.fillRect(x,y,bw,h-pad.b-y)});
    ctx.strokeStyle=COLORS.data;ctx.lineWidth=2;ctx.beginPath();running.forEach((v,i)=>{const x=pad.l+(i+.5)*step,y=Y(v);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
    ctx.fillStyle=COLORS.muted;ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(String(start+1),pad.l,h-pad.b+15);ctx.fillText(String(programShown.length),w-pad.r,h-pad.b+15);
    $('progTimeNote').textContent=programMeta.kind==='experiment'?'каждая точка соответствует очередному интервалу τ₀':'время воспроизведения ускорено; порядок точек сохранён';
  }
  function drawProgramHist(){
    const {ctx,w,h,pad}=programCanvas('programHistChart','n','wₙ');if(!programShown.length)return;
    const map=histogramMap(programShown),keys=[...map.keys()].sort((a,b)=>a-b),min=keys[0],max=keys.at(-1),vals=[];
    const poissonLike=programMeta.kind==='experiment'||programMeta.distribution==='poisson';const mu=programMeta.distribution==='poisson'&&Number.isFinite(programMeta.mu)?programMeta.mu:stats(programShown,1).mean;let ymax=0;
    for(let n=min;n<=max;n++){const emp=(map.get(n)||0)/programShown.length,p=poissonLike?poissonPMF(n,mu):null;vals.push({n,emp,p});ymax=Math.max(ymax,emp,p||0)}ymax=Math.max(.01,ymax*1.15);
    const plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b,step=plotW/Math.max(1,vals.length),X=i=>pad.l+(i+.5)*step,Y=v=>h-pad.b-v/ymax*plotH;
    vals.forEach((d,i)=>{const bw=Math.max(2,step*.66),y=Y(d.emp);ctx.fillStyle=COLORS.data2;ctx.fillRect(X(i)-bw/2,y,bw,h-pad.b-y)});
    if(poissonLike){ctx.strokeStyle=COLORS.poisson;ctx.lineWidth=2;ctx.beginPath();vals.forEach((d,i)=>i?ctx.lineTo(X(i),Y(d.p)):ctx.moveTo(X(i),Y(d.p)));ctx.stroke()}
    ctx.fillStyle=COLORS.muted;ctx.font='10px system-ui';ctx.textAlign='center';const every=Math.max(1,Math.ceil(vals.length/10));vals.forEach((d,i)=>{if(i%every===0)ctx.fillText(String(d.n),X(i),h-pad.b+15)});
    $('progHistNote').textContent=poissonLike?'столбцы — данные; линия — Пуассон':'exp: только экспериментальная гистограмма';
  }
  function drawProgramMean(){
    const {ctx,w,h,pad}=programCanvas('programMeanChart','N','⟨n⟩');if(programShown.length<2)return;
    const pref=[0];programShown.forEach(x=>pref.push(pref.at(-1)+x));const ns=sampledIndices(programShown.length,160),ys=ns.map(n=>pref[n]/n);let ymin=Math.min(...ys),ymax=Math.max(...ys);
    if(programMeta.distribution==='poisson'&&Number.isFinite(programMeta.mu)){ymin=Math.min(ymin,programMeta.mu);ymax=Math.max(ymax,programMeta.mu)}if(ymax===ymin){ymin-=.5;ymax+=.5}else{const d=(ymax-ymin)*.15;ymin-=d;ymax+=d}
    const X=n=>pad.l+(n-2)/(Math.max(3,programShown.length)-2)*(w-pad.l-pad.r),Y=v=>h-pad.b-(v-ymin)/(ymax-ymin)*(h-pad.t-pad.b);
    ctx.strokeStyle=COLORS.data;ctx.lineWidth=2;ctx.beginPath();ns.forEach((n,i)=>i?ctx.lineTo(X(n),Y(pref[n]/n)):ctx.moveTo(X(n),Y(pref[n]/n)));ctx.stroke();
    if(programMeta.distribution==='poisson'&&Number.isFinite(programMeta.mu)){ctx.strokeStyle=COLORS.poisson;ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(pad.l,Y(programMeta.mu));ctx.lineTo(w-pad.r,Y(programMeta.mu));ctx.stroke();ctx.setLineDash([])}
  }
  function drawProgramError(){
    const {ctx,w,h,pad}=programCanvas('programErrorChart','log₁₀ N','log₁₀ σ⟨n⟩');if(programShown.length<5)return;
    const ns=sampledIndices(programShown.length,100).filter(n=>n>=5),poissonLike=programMeta.kind==='experiment'||programMeta.distribution==='poisson';
    const fullMean=stats(programShown,1).mean,data=ns.map(n=>({n,sem:prefixStats(programShown,n).sem,theory:poissonLike?Math.sqrt(Math.max(fullMean,1e-12)/n):null})).filter(d=>d.sem>0);if(!data.length)return;
    const xs=data.map(d=>Math.log10(d.n)),ys=data.map(d=>Math.log10(d.sem));if(poissonLike)ys.push(...data.map(d=>Math.log10(d.theory)));
    let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);if(xmax===xmin)xmax=xmin+1;if(ymax===ymin)ymax=ymin+1;
    const X=x=>pad.l+(x-xmin)/(xmax-xmin)*(w-pad.l-pad.r),Y=y=>h-pad.b-(y-ymin)/(ymax-ymin)*(h-pad.t-pad.b);
    const line=(key,color)=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();data.forEach((d,i)=>{const x=X(Math.log10(d.n)),y=Y(Math.log10(d[key]));i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()};line('sem',COLORS.data);if(poissonLike)line('theory',COLORS.theory);
  }

  $$('#programModeButtons button').forEach(btn=>btn.addEventListener('click',()=>setProgramMode(btn.dataset.mode)));
  $('progDistribution').addEventListener('change',()=>setSimulationDistribution($('progDistribution').value));
  $('progPoissonMean').addEventListener('input',()=>$('progPoissonMeanValue').textContent=format(Number($('progPoissonMean').value),1));
  $('progGenerate').addEventListener('click',()=>{const mu=Number($('progPoissonMean').value),N=Number($('progPoissonN').value),data=Array.from({length:N},()=>poissonRandom(mu));setProgramData(data,`Симуляция poisson · μ=${format(mu,1)}`,{kind:'simulation',distribution:'poisson',mu,declaredCount:N})});
  $('progLoadPoissonArchive').addEventListener('click',()=>loadProgramFile('examples/simulation-poisson-2026.txt','Архивная симуляция poisson 2026'));
  $('progLoadExpArchive').addEventListener('click',()=>loadProgramFile('examples/simulation-exp-2022.txt','Архивная симуляция exp 2022'));
  $('progLoadExperiment').addEventListener('click',()=>loadProgramFile($('progExperimentExample').value,'Запись эксперимента'));
  $('progUseAnalyzer').addEventListener('click',()=>{if(!rawData.length){$('progDataInfo').textContent='В анализаторе пока нет данных.';return}setProgramData(rawData,'Данные из анализатора',rawMeta)});
  $('progStart').addEventListener('click',startProgram);$('progPause').addEventListener('click',pauseProgram);$('progReset').addEventListener('click',resetProgramPlayback);
  $('progToAnalyzer').addEventListener('click',()=>{if(!programData.length){$('progDataInfo').textContent='Нет серии для передачи.';return}dataText.value=serializeLabFile(programData,programMeta);rawData=[...programData];rawMeta={...programMeta,declaredCount:programData.length};updateAnalysis();document.querySelector('#analyzer').scrollIntoView({behavior:'smooth'})});
  $('progDownload').addEventListener('click',()=>{if(!programData.length){$('progDataInfo').textContent='Нет серии для сохранения.';return}const blob=new Blob([serializeLabFile(programData,programMeta)],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`lab-1.1.4-${programMeta.kind||'data'}-${programMeta.distribution||'series'}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
  setSimulationDistribution('poisson');
  updateProgramPlaybackButtons();

  // ---------- 09. Журнал ----------
  const JOURNAL_KEY='mipt.lab114.journal.v1';
  function loadJournal(){let data={};try{data=JSON.parse(localStorage.getItem(JOURNAL_KEY)||'{}')}catch(_){};$$('[data-journal]').forEach(t=>{t.value=data[t.dataset.journal]||'';t.addEventListener('input',saveJournal)})}
  function saveJournal(){const data={};$$('[data-journal]').forEach(t=>data[t.dataset.journal]=t.value);localStorage.setItem(JOURNAL_KEY,JSON.stringify(data))}
  $('clearJournal').addEventListener('click',()=>{if(confirm('Очистить все записи мини-журнала?')){$$('[data-journal]').forEach(t=>t.value='');localStorage.removeItem(JOURNAL_KEY)}});

  // ---------- 10. Самопроверка ----------
  const quizData=[
    {q:'Что означает nᵢ?',o:['Число регистраций в i-м интервале','Общее число измерений','Среднее число регистраций'],a:0,e:'nᵢ — результат одного временного интервала: сколько регистраций попало именно в него.'},
    {q:'Что означает N?',o:['Число разных значений n','Общее число измерений в серии','Число событий в одном интервале'],a:1,e:'N — количество измерений (интервалов) в серии.'},
    {q:'Как вычисляется ⟨n⟩?',o:['Σnᵢ / N','Σnᵢ² / N','N / Σnᵢ'],a:0,e:'Среднее — сумма всех nᵢ, делённая на число измерений N.'},
    {q:'Какой делитель используется в формуле дисперсии именно в этой методичке?',o:['N','N − 1','√N'],a:0,e:'На странице используется определение методички: σₙ² = (1/N)Σ(nᵢ−⟨n⟩)².'},
    {q:'Что показывает σₙ?',o:['Разброс отдельных отсчётов около среднего','Точность таймера','Количество измерений'],a:0,e:'σₙ характеризует разброс отдельных значений nᵢ.'},
    {q:'Что показывает σ⟨n⟩?',o:['Ошибка найденного среднего','Число столбцов гистограммы','Длительность интервала'],a:0,e:'σ⟨n⟩ — ошибка среднего: σₙ/√N.'},
    {q:'Если N увеличить в 4 раза при том же σₙ, что произойдёт с σ⟨n⟩?',o:['Уменьшится в 2 раза','Уменьшится в 4 раза','Увеличится в 2 раза'],a:0,e:'В знаменателе стоит √N. Корень из 4 равен 2.'},
    {q:'Что означает Nₙ на гистограмме?',o:['Сколько раз встретилось конкретное значение n','Среднее n','Количество всех событий'],a:0,e:'Nₙ — число измерений, где получилось именно выбранное n.'},
    {q:'Как связаны Nₙ и экспериментальная частота wₙ?',o:['wₙ = Nₙ/N','wₙ = N/Nₙ','wₙ = Nₙ·N'],a:0,e:'Высота экспериментального столбца задаётся частотой wₙ = Nₙ/N.'},
    {q:'Какое свойство закона Пуассона проверяется в работе?',o:['σ ≈ √n̄','σ ≈ n̄²','σ ≈ 1/n̄'],a:0,e:'Ключевое свойство: стандартное отклонение Пуассона равно √n̄. Экспериментально сравнивают σₙ и √⟨n⟩.'},
    {q:'При каком среднем методичка указывает практически пригодное гауссово приближение Пуассона?',o:['n̄ ≳ 10','n̄ < 1','Только n̄ = 1000'],a:0,e:'В методичке указан ориентир n̄ ≳ 10.'},
    {q:'Какая доля гауссового распределения находится примерно в пределах ±σ?',o:['68%','95%','99,7%'],a:0,e:'Ориентиры: ≈68% в ±σ, ≈95% в ±2σ, ≈99,7% в ±3σ.'},
    {q:'Что означает перейти от τ₀ = 1 с к τ = 10 с?',o:['Сложить каждые 10 последовательных секундных отсчётов','Умножить каждый отсчёт на 10 без группировки','Оставить только каждый десятый отсчёт'],a:0,e:'Группировка — суммирование соседних исходных значений в более длинный временной интервал.'},
    {q:'Почему при разных τ удобно сравнивать j, а не только ⟨n⟩?',o:['j = ⟨n⟩/τ учитывает длительность интервала','j всегда равно σₙ','j не зависит от данных'],a:0,e:'Среднее число событий растёт с длительностью интервала. Интенсивность j нормирует его на τ.'},
    {q:'Как определяется средняя интенсивность?',o:['j = ⟨n⟩/τ','j = τ/⟨n⟩','j = ⟨n⟩·τ'],a:0,e:'По методичке j = ⟨n⟩/τ.'},
    {q:'Как связана ошибка интенсивности с ошибкой среднего?',o:['σⱼ = σ⟨n⟩/τ','σⱼ = σ⟨n⟩·τ','σⱼ = τ/σ⟨n⟩'],a:0,e:'При делении среднего на τ его ошибка также делится на τ.'},
    {q:'Что такое nΣ?',o:['Общее число зарегистрированных событий Σnᵢ','Число групп после укрупнения τ','Среднее значение'],a:0,e:'nΣ = Σnᵢ = ⟨n⟩N.'},
    {q:'Как для пуассоновского процесса выражается относительная ошибка среднего через nΣ?',o:['1/√nΣ','1/nΣ','√nΣ'],a:0,e:'Методичка приводит ε⟨n⟩ = 1/√nΣ.'},
    {q:'Сколько событий нужно примерно зарегистрировать для относительной ошибки порядка 1%?',o:['10⁴','10²','10⁸'],a:0,e:'1/√10⁴ = 1/100 = 1%.'},
    {q:'Какие значения α методичка предлагает исследовать для Парето?',o:['2,0 и 1,0','10 и 20','0 и 100'],a:0,e:'В задании явно указаны α = 2,0 и α = 1,0.'},
    {q:'Что делает анализатор со строками файла, начинающимися с #?',o:['Игнорирует как комментарии','Считает их нулевыми отсчётами','Прерывает обработку'],a:0,e:'Строки с # являются комментариями и не входят в числовую серию.'},
    {q:'Что происходит с неполной последней группой при группировке на сайте?',o:['Она не используется','Она дополняется нулями','Она удваивается'],a:0,e:'Обработчик использует только полные группы.'},
    {q:'Чем в программе принципиально отличаются эксперимент и симуляция?',o:['Источником nᵢ: установка или ГПСЧ','Форматом числового файла','Формулой среднего'],a:0,e:'После получения серии обработка одинакова; отличается именно источник отсчётов.'},
    {q:'Что в сохранённом файле симуляции сообщает тип распределения?',o:['Строка комментария, начинающаяся с # Распределение','Первое число серии','Имя студента'],a:0,e:'Файл хранит служебные метаданные в строках комментариев #; числовая серия идёт отдельными строками.'},
    {q:'Почему веб-версия не генерирует exp самостоятельно?',o:['Точный алгоритм генератора не задан в предоставленных материалах','JavaScript не умеет случайные числа','Экспоненциальные данные нельзя хранить в txt'],a:0,e:'Мы не подменяем лабораторную программу собственной параметризацией. Вместо этого доступна реальная архивная exp-серия.'},
    {q:'Какие четыре представления данных собраны в учебной веб-программе?',o:['Отсчёты во времени, гистограмма, среднее при росте N, ошибка среднего','Только четыре одинаковые гистограммы','Силы, скорости, энергии и координаты'],a:0,e:'Это четыре графика, восстановленные для этой работы; три статистических совпадают с разделом обработки данных.'},
    {q:'Можно ли считать скоростью физического эксперимента скорость анимации на сайте?',o:['Нет, это только скорость воспроизведения уже имеющихся точек','Да, всегда','Только в режиме exp'],a:0,e:'Сайт ускоряет просмотр. В экспериментальном файле порядок и данные сохраняются, но экранная анимация не является ходом реального измерения.'},
    {q:'Что делает сайт с личной строкой «Студент …» в опубликованных примерах?',o:['Не публикует её, сохраняя научные метаданные файла','Использует её как числовой отсчёт','Рисует её на графике'],a:0,e:'Для примеров на сайте личные заголовки удалены; тип режима, распределение, время и число точек сохранены.'}
  ];

  let quizSet=[],quizIndex=0,quizCorrect=0,quizAnswered=false,quizCountMode=10;

  function shuffled(arr){
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }
  function startQuiz(count=quizCountMode){
    quizCountMode=count;
    quizSet=count==='all'?shuffled(quizData):shuffled(quizData).slice(0,Number(count));
    quizIndex=0;
    quizCorrect=0;
    quizAnswered=false;
    renderQuizTrainer();
  }
  function renderQuizTrainer(){
    const host=$('quizTrainer'),total=quizSet.length;
    $('quizProgressBar').style.width=`${total?quizIndex/total*100:0}%`;
    $('quizProgressText').textContent=quizIndex<total?`${quizIndex+1} / ${total}`:`${total} / ${total}`;
    $('quizScoreText').textContent=`${quizCorrect} верных`;

    if(quizIndex>=total){
      const pct=total?Math.round(quizCorrect/total*100):0;
      $('quizProgressBar').style.width='100%';
      host.innerHTML=`<div class="quiz-summary"><strong>${quizCorrect} / ${total}</strong><span>${pct}% правильных ответов</span><button class="button trainer-next" id="quizAgain" type="button">Пройти ещё раз</button></div>`;
      $('quizAgain').addEventListener('click',()=>startQuiz(quizCountMode));
      return;
    }

    const item=quizSet[quizIndex];
    host.innerHTML=`<div class="trainer-question">${quizIndex+1}. ${item.q}</div><div class="trainer-options" id="trainerOptions"></div><div class="trainer-feedback" id="trainerFeedback">Выберите ответ.</div><button class="button primary trainer-next" id="trainerNext" type="button" hidden>${quizIndex===total-1?'Завершить':'Следующий вопрос'}</button>`;
    const opts=$('trainerOptions'),fb=$('trainerFeedback'),next=$('trainerNext');

    item.o.forEach((text,oi)=>{
      const b=document.createElement('button');
      b.type='button';
      b.textContent=text;
      b.addEventListener('click',()=>{
        if(quizAnswered)return;
        quizAnswered=true;
        [...opts.children].forEach(x=>x.disabled=true);
        if(oi===item.a){
          b.classList.add('correct');
          quizCorrect++;
        }else{
          b.classList.add('wrong');
          opts.children[item.a].classList.add('correct');
        }
        fb.textContent=item.e;
        $('quizScoreText').textContent=`${quizCorrect} верных`;
        next.hidden=false;
      });
      opts.append(b);
    });

    next.addEventListener('click',()=>{
      quizIndex++;
      quizAnswered=false;
      renderQuizTrainer();
    });
  }

  $$('#quizModeButtons button').forEach(btn=>btn.addEventListener('click',()=>{
    $$('#quizModeButtons button').forEach(b=>b.classList.toggle('active',b===btn));
    startQuiz(btn.dataset.count==='all'?'all':Number(btn.dataset.count));
  }));
  $('quizRestart').addEventListener('click',()=>startQuiz(quizCountMode));

  // ---------- 11. Самостоятельное построение графиков ----------
  const GRAPH_CHECK_KEY='lab114.graphChecklist.v1';
  function loadGraphChecklist(){
    let saved={};
    try{saved=JSON.parse(localStorage.getItem(GRAPH_CHECK_KEY)||'{}')}catch(_){}
    $$('[data-graph-check]').forEach(box=>{
      box.checked=!!saved[box.dataset.graphCheck];
      box.addEventListener('change',()=>{
        const state={};
        $$('[data-graph-check]').forEach(x=>state[x.dataset.graphCheck]=x.checked);
        localStorage.setItem(GRAPH_CHECK_KEY,JSON.stringify(state));
      });
    });
  }
  $$('[data-copy-target]').forEach(btn=>btn.addEventListener('click',async()=>{
    const node=$(btn.dataset.copyTarget);if(!node)return;
    const old=btn.textContent;
    try{
      await navigator.clipboard.writeText(node.textContent);
      btn.textContent='Скопировано';
    }catch(_){
      btn.textContent='Выделите код вручную';
    }
    setTimeout(()=>btn.textContent=old,1400);
  }));

  // ---------- init ----------
  function init(){
    renderMeasurement();renderEditableCounts();renderStatStep();renderFrequencyHistogram();renderPoisson();renderGrouping();renderErrorSlider();renderWorkflow();loadJournal();loadGraphChecklist();setProgramMode('experiment');renderProgram();startQuiz(10);
  }
  let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{renderPoisson();if(currentData.length)drawAnalysisChart();if(programShown.length){drawProgramTime();drawProgramHist();drawProgramMean();drawProgramError()}},120)});
  init();
})();
