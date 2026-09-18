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

  function parseData(text) {
    const values = [];
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const clean = line.split('#')[0];
      for (const token of clean.split(/[;\s]+/)) {
        if (!token) continue;
        const x = Number(token.replace(',', '.'));
        if (Number.isFinite(x)) values.push(x);
      }
    }
    return values;
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
    $('dataStatus').textContent=`Прочитано ${rawData.length} исходных значений. Для τ = ${format(v.tau,3)} с получено ${currentData.length} полных групп.`;
    renderDashboard(v);
  }

  function renderDashboard(v){
    const s=currentStats,dashboard=$('analysisDashboard');dashboard.className='analysis-dashboard';
    const shares=[1,2,3].map(k=>({k,p:currentData.filter(x=>Math.abs(x-s.mean)<=k*s.sigma+1e-12).length/currentData.length}));
    const ratio=s.sqrtMean>0?s.sigma/s.sqrtMean:NaN;
    dashboard.innerHTML=`
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

  fileInput.addEventListener('change',async()=>{const f=fileInput.files?.[0];if(!f)return;dataText.value=await f.text();rawData=parseData(dataText.value);updateAnalysis()});
  $('analyzeBtn').addEventListener('click',()=>{rawData=parseData(dataText.value);updateAnalysis()});
  [baseTauInput,tauInput,tauListInput].forEach(el=>el.addEventListener('change',()=>{if(rawData.length)updateAnalysis()}));
  $('sampleBtn').addEventListener('click',async()=>{try{const r=await fetch('sample_data.txt',{cache:'no-cache'});if(!r.ok)throw new Error();dataText.value=await r.text();rawData=parseData(dataText.value);updateAnalysis()}catch(_){$('dataStatus').textContent='Не удалось загрузить учебный пример.'}});

  // ---------- 09. Журнал ----------
  const JOURNAL_KEY='mipt.lab114.journal.v1';
  function loadJournal(){let data={};try{data=JSON.parse(localStorage.getItem(JOURNAL_KEY)||'{}')}catch(_){};$$('[data-journal]').forEach(t=>{t.value=data[t.dataset.journal]||'';t.addEventListener('input',saveJournal)})}
  function saveJournal(){const data={};$$('[data-journal]').forEach(t=>data[t.dataset.journal]=t.value);localStorage.setItem(JOURNAL_KEY,JSON.stringify(data))}
  $('clearJournal').addEventListener('click',()=>{if(confirm('Очистить все записи мини-журнала?')){$$('[data-journal]').forEach(t=>t.value='');localStorage.removeItem(JOURNAL_KEY)}});

  // ---------- 10. Самопроверка ----------
  const quizData=[
    {q:'Что означает Nₙ на гистограмме?',o:['Среднее число событий','Сколько раз встретилось значение n','Число всех измерений'],a:1,e:'Nₙ — число измерений, в которых получилось конкретное значение n. Частота wₙ = Nₙ/N.'},
    {q:'Если число измерений N увеличить в 4 раза, как меняется σ⟨n⟩ при том же σₙ?',o:['Уменьшится в 2 раза','Уменьшится в 4 раза','Не изменится'],a:0,e:'σ⟨n⟩ = σₙ/√N. Корень из 4 равен 2.'},
    {q:'Какое соотношение проверяют для пуассоновского потока?',o:['σₙ ≈ ⟨n⟩','σₙ ≈ √⟨n⟩','σₙ ≈ 1/⟨n⟩'],a:1,e:'Ключевое свойство Пуассона в методичке: σ = √n̄; экспериментально сравнивают σₙ и √⟨n⟩.'},
    {q:'Что происходит при переходе от τ = 1 с к большему τ?',o:['Соседние отсчёты суммируются','Отбрасываются все малые значения','Каждый nᵢ делится на τ'],a:0,e:'Группировка — это суммирование последовательных исходных отсчётов в более длинные интервалы.'},
    {q:'Почему nΣ ≈ 10⁴ особенно заметно в этой работе?',o:['Это число точек в гистограмме','Оно даёт относительную пуассоновскую ошибку порядка 1%','При нём σₙ становится нулём'],a:1,e:'ε = 1/√nΣ. При nΣ = 10⁴ получаем 1/100 = 1%.'}
  ];
  function renderQuiz(){const q=$('quiz');q.innerHTML='';quizData.forEach((item,qi)=>{const card=document.createElement('div');card.className='quiz-item';const question=document.createElement('div');question.className='quiz-question';question.textContent=`${qi+1}. ${item.q}`;const options=document.createElement('div');options.className='quiz-options';const fb=document.createElement('div');fb.className='quiz-feedback';item.o.forEach((text,oi)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>{[...options.children].forEach(x=>{x.disabled=true});b.classList.add(oi===item.a?'correct':'wrong');if(oi!==item.a)options.children[item.a].classList.add('correct');fb.textContent=item.e});options.append(b)});card.append(question,options,fb);q.append(card)})}

  // ---------- init ----------
  function init(){
    renderMeasurement();renderEditableCounts();renderStatStep();renderFrequencyHistogram();renderPoisson();renderGrouping();renderErrorSlider();renderWorkflow();loadJournal();renderQuiz();
  }
  let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{renderPoisson();if(currentData.length)drawAnalysisChart()},120)});
  init();
})();
