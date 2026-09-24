(()=>{
'use strict';
const $=id=>document.getElementById(id);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const num=v=>{const x=Number(String(v).replace(',','.'));return Number.isFinite(x)?x:0};
const fmt=x=>Math.abs(x-Math.round(x))<1e-10?String(Math.round(x)):String(Math.round(x*1000)/1000);

// ---------- matrix explorer ----------
const explorerValues=[[1,2,3],[4,5,6],[7,8,9]];
function sub(n){return String(n).split('').map(d=>'₀₁₂₃₄₅₆₇₈₉'[Number(d)]).join('')}
function renderExplorer(pick=[1,2]){
  const host=$('matrixExplorer');host.innerHTML='';
  explorerValues.forEach((row,i)=>row.forEach((v,j)=>{
    const b=document.createElement('button');b.type='button';b.className='matrix-cell';b.textContent=v;
    if(i===pick[0])b.classList.add('row-on');if(j===pick[1])b.classList.add('col-on');if(i===pick[0]&&j===pick[1])b.classList.add('picked');
    b.addEventListener('click',()=>renderExplorer([i,j]));host.append(b)
  }));
  const i=pick[0]+1,j=pick[1]+1,v=explorerValues[pick[0]][pick[1]];
  $('matrixPicked').textContent=`выбрано a${sub(i)}${sub(j)}`;
  $('matrixExplain').innerHTML=`<b>a${sub(i)}${sub(j)} = ${v}</b><span>${i}-я строка, ${j}-й столбец</span>`
}
renderExplorer();

// ---------- multiplication ----------
function read2(id){const v=$$('#'+id+' input').map(x=>num(x.value));return [[v[0],v[1]],[v[2],v[3]]]}
function mul2(A,B){return [[A[0][0]*B[0][0]+A[0][1]*B[1][0],A[0][0]*B[0][1]+A[0][1]*B[1][1]],[A[1][0]*B[0][0]+A[1][1]*B[1][0],A[1][0]*B[0][1]+A[1][1]*B[1][1]]]}
function renderSmallMatrix(host,M){host.innerHTML='';M.flat().forEach(v=>{const s=document.createElement('span');s.textContent=fmt(v);host.append(s)})}
function clearHighlights(){ $$('#matrixA input,#matrixB input').forEach(x=>x.classList.remove('row-hi','col-hi')); $$('#matrixProduct button').forEach(x=>x.classList.remove('active')) }
function explainProduct(i,j){
  const A=read2('matrixA'),B=read2('matrixB');clearHighlights();
  $$('#matrixA input').filter((_,k)=>Math.floor(k/2)===i).forEach(x=>x.classList.add('row-hi'));
  $$('#matrixB input').filter((_,k)=>k%2===j).forEach(x=>x.classList.add('col-hi'));
  const buttons=$$('#matrixProduct button');buttons[i*2+j].classList.add('active');
  const terms=[`${fmt(A[i][0])}·${fmt(B[0][j])}`,`${fmt(A[i][1])}·${fmt(B[1][j])}`];
  const value=A[i][0]*B[0][j]+A[i][1]*B[1][j];
  $('multiplyFormula').textContent=`c${sub(i+1)}${sub(j+1)} = ${terms[0]} + ${terms[1]} = ${fmt(value)}`;
  $('multiplyMeaning').textContent=`Берём ${i+1}-ю строку A и ${j+1}-й столбец B. Пары элементов перемножаются и складываются.`
}
function renderProducts(){
  const A=read2('matrixA'),B=read2('matrixB'),AB=mul2(A,B),BA=mul2(B,A);
  const host=$('matrixProduct');host.innerHTML='';AB.flat().forEach((v,k)=>{const b=document.createElement('button');b.type='button';b.textContent=fmt(v);b.addEventListener('click',()=>explainProduct(Math.floor(k/2),k%2));host.append(b)});
  renderSmallMatrix($('abMatrix'),AB);renderSmallMatrix($('baMatrix'),BA);
  $('compareSign').textContent=JSON.stringify(AB)===JSON.stringify(BA)?'=':'≠';$('compareSign').style.color=JSON.stringify(AB)===JSON.stringify(BA)?'var(--lesson-green)':'var(--lesson-red)';
  explainProduct(0,0)
}
$$('#matrixA input,#matrixB input').forEach(x=>x.addEventListener('input',renderProducts));
$('swapExample').addEventListener('click',()=>{
  const examples=[[[1,1,0,1],[1,0,1,1]],[[0,-1,1,0],[2,1,0,1]],[[2,0,0,3],[1,2,3,4]],[[1,2,3,4],[2,-1,1,0]]];
  const e=examples[Math.floor(Math.random()*examples.length)];
  $$('#matrixA input').forEach((x,i)=>x.value=e[0][i]);$$('#matrixB input').forEach((x,i)=>x.value=e[1][i]);renderProducts();
});
renderProducts();

// ---------- determinant ----------
let detSize=2;
const detDefaults={2:[1,2,3,4],3:[1,2,3,0,1,4,5,6,0]};
function det2(v){return v[0]*v[3]-v[1]*v[2]}
function det3(v){return v[0]*(v[4]*v[8]-v[5]*v[7])-v[1]*(v[3]*v[8]-v[5]*v[6])+v[2]*(v[3]*v[7]-v[4]*v[6])}
function renderDetInputs(values=detDefaults[detSize]){
  const host=$('detInputs');host.innerHTML=`<div class="det-grid size${detSize}" id="detGrid"></div>`;const grid=$('detGrid');
  values.forEach((v,k)=>{const inp=document.createElement('input');inp.setAttribute('aria-label',`Элемент a${Math.floor(k/detSize)+1}${k%detSize+1}`);inp.value=v;inp.inputMode='numeric';inp.addEventListener('input',updateDet);grid.append(inp)});updateDet();
}
function updateDet(){
  const v=$$('#detGrid input').map(x=>num(x.value));
  if(detSize===2){const d=det2(v);$('detValue').textContent=`det A = ${fmt(d)}`;$('detSteps').innerHTML=`<b>${fmt(v[0])}·${fmt(v[3])}</b> − <b>${fmt(v[1])}·${fmt(v[2])}</b> = ${fmt(v[0]*v[3])} − ${fmt(v[1]*v[2])} = ${fmt(d)}`}
  else{const m11=v[4]*v[8]-v[5]*v[7],m12=v[3]*v[8]-v[5]*v[6],m13=v[3]*v[7]-v[4]*v[6],d=v[0]*m11-v[1]*m12+v[2]*m13;$('detValue').textContent=`det A = ${fmt(d)}`;$('detSteps').innerHTML=`Разложение по первой строке:<br><b>${fmt(v[0])}·(${fmt(m11)}) − ${fmt(v[1])}·(${fmt(m12)}) + ${fmt(v[2])}·(${fmt(m13)})</b><br>= ${fmt(d)}`}
}
$$('#detTabs button').forEach(b=>b.addEventListener('click',()=>{$$('#detTabs button').forEach(x=>x.classList.toggle('active',x===b));detSize=Number(b.dataset.detSize);renderDetInputs()}));
renderDetInputs();

// ---------- Cramer ----------
let cramerSize=2;
const cramerDefaults={2:{A:[[2,1],[1,-1]],b:[-1,-2]},3:{A:[[1,1,1],[2,-1,1],[1,2,-1]],b:[0,3,-3]}};
function determinant(M){if(M.length===2)return M[0][0]*M[1][1]-M[0][1]*M[1][0];const [a,b,c]=M[0], [d,e,f]=M[1], [g,h,i]=M[2];return a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g)}
function renderCramerSystem(){
  const d=cramerDefaults[cramerSize],host=$('cramerSystem');host.innerHTML='';
  for(let r=0;r<cramerSize;r++){
    const row=document.createElement('div');row.className='eq-row';
    for(let c=0;c<cramerSize;c++){
      const inp=document.createElement('input');inp.value=d.A[r][c];inp.dataset.kind='a';inp.dataset.r=r;inp.dataset.c=c;inp.setAttribute('aria-label',`Коэффициент a${r+1}${c+1}`);inp.addEventListener('input',()=>{$('cramerOutput').textContent='Коэффициенты изменены. Пересчитайте определители.'});row.append(inp);
      const s=document.createElement('span');s.textContent=c===cramerSize-1?`x${c+1}`:`x${c+1} +`;row.append(s)
    }
    const eq=document.createElement('span');eq.textContent='=';row.append(eq);const rhs=document.createElement('input');rhs.value=d.b[r];rhs.dataset.kind='b';rhs.dataset.r=r;rhs.setAttribute('aria-label',`Правая часть b${r+1}`);rhs.addEventListener('input',()=>{$('cramerOutput').textContent='Правая часть изменена. Пересчитайте определители.'});row.append(rhs);host.append(row)
  }
  $('cramerOutput').innerHTML='<p>Сначала попробуй определить, какой столбец надо заменить для Δ₁.</p>'
}
function readCramer(){const A=Array.from({length:cramerSize},()=>Array(cramerSize).fill(0)),b=Array(cramerSize).fill(0);$$('#cramerSystem input').forEach(x=>{if(x.dataset.kind==='a')A[+x.dataset.r][+x.dataset.c]=num(x.value);else b[+x.dataset.r]=num(x.value)});return{A,b}}
function solveCramer(){
  const {A,b}=readCramer(),D=determinant(A),Ds=[];
  for(let c=0;c<cramerSize;c++){const M=A.map((row,r)=>row.map((v,j)=>j===c?b[r]:v));Ds.push(determinant(M))}
  let cards=`<div class="delta-cards"><div class="delta-card"><b>Δ = ${fmt(D)}</b><span>det A</span></div>`+Ds.map((d,i)=>`<div class="delta-card"><b>Δ${sub(i+1)} = ${fmt(d)}</b><span>заменён ${i+1}-й столбец</span></div>`).join('')+'</div>';
  if(Math.abs(D)<1e-12){cards+=`<div class="cramer-warning"><b>Δ = 0.</b> Формулы Крамера не дают единственного решения. Это не означает автоматически «решений нет»: возможны разные случаи, которые изучаются дальше в теории систем.</div>`}
  else{const x=Ds.map(d=>d/D);cards+=`<div class="solution-line">${x.map((v,i)=>`x${sub(i+1)} = ${fmt(v)}`).join(' · ')}</div>`}
  $('cramerOutput').innerHTML=cards;
}
$('solveCramer').addEventListener('click',solveCramer);$('resetCramer').addEventListener('click',renderCramerSystem);
$$('#cramerTabs button').forEach(b=>b.addEventListener('click',()=>{$$('#cramerTabs button').forEach(x=>x.classList.toggle('active',x===b));cramerSize=Number(b.dataset.cramerSize);renderCramerSystem()}));
renderCramerSystem();

// ---------- hints ----------
$$('[data-hint]').forEach(btn=>btn.addEventListener('click',()=>{const el=document.querySelector(`[data-hint-content="${btn.dataset.hint}"]`);el.hidden=!el.hidden}));

// ---------- checklist ----------
const AUDIT_KEY='angem.week1.audit';let saved={};try{saved=JSON.parse(localStorage.getItem(AUDIT_KEY)||'{}')}catch(_){}
$$('[data-audit]').forEach(box=>{box.checked=!!saved[box.dataset.audit];box.addEventListener('change',()=>{const s={};$$('[data-audit]').forEach(x=>s[x.dataset.audit]=x.checked);try{localStorage.setItem(AUDIT_KEY,JSON.stringify(s))}catch(_){}})});

// ---------- quiz ----------
const quiz=[
  {q:'В записи a₂₃ что означает индекс 2?',o:['Номер строки','Номер столбца','Размер матрицы'],a:0,e:'Первый индекс — строка, второй — столбец.'},
  {q:'Когда произведение AB определено?',o:['Когда число столбцов A равно числу строк B','Только если A и B квадратные','Всегда'],a:0,e:'Если A имеет размер m×n, а B — n×p, произведение AB имеет размер m×p.'},
  {q:'Что используется для вычисления cᵢⱼ в AB?',o:['i-я строка A и j-й столбец B','j-я строка A и i-й столбец B','только диагонали'],a:0,e:'Это и есть правило «строка × столбец».'},
  {q:'Верно ли в общем случае AB = BA?',o:['Нет','Да','Только для прямоугольных матриц'],a:0,e:'Матричное умножение некоммутативно. Равенство требует отдельного условия.'},
  {q:'Как называются матрицы, для которых AB = BA?',o:['Перестановочные','Транспонированные','Нулевые'],a:0,e:'В учебнике Беклемишева используется термин «перестановочные»; также говорят «коммутирующие».'},
  {q:'Чему равен det [[a,b],[c,d]]?',o:['ad − bc','ac − bd','ab − cd'],a:0,e:'Для 2×2 это разность произведений главной и побочной диагоналей.'},
  {q:'Какой знак у второго слагаемого при разложении det 3×3 по первой строке?',o:['Минус','Плюс','Знак всегда нулевой'],a:0,e:'Знаки идут +, −, +.'},
  {q:'Что требуется для единственного решения квадратной системы по Крамеру?',o:['Δ = det A ≠ 0','Δ = 0','Все коэффициенты положительны'],a:0,e:'Это условие теоремы Крамера.'},
  {q:'Как строится Δ₂?',o:['В A заменяется второй столбец на столбец свободных членов','Заменяется вторая строка','Меняется знак второго столбца'],a:0,e:'Всегда заменяется соответствующий столбец.'},
  {q:'Если Δ ≠ 0, как находится xᵢ?',o:['Δᵢ/Δ','Δ/Δᵢ','Δ·Δᵢ'],a:0,e:'Формула Крамера: xᵢ = Δᵢ/Δ.'},
  {q:'Что можно заключить из Δ = 0?',o:['Единственного решения нет','Решений обязательно нет','Все x равны нулю'],a:0,e:'При Δ=0 единственность теряется. Система может быть несовместной или иметь много решений.'},
  {q:'Если X коммутирует с любой матрицей 2×2, какой вид получается?',o:['X = λE','X обязана быть нулевой','X должна быть любой диагональной'],a:0,e:'Сравнение XB и BX для произвольной B даёт b=c=0 и a=d, то есть X=λE.'},
  {q:'Почему в задаче «XB=BX для любой B» можно сравнивать коэффициенты при f и g?',o:['Потому что элементы B можно выбирать независимо','Потому что f=g всегда','Потому что B единичная'],a:0,e:'Слова «для любой B» означают, что e,f,g,h — произвольные независимые вещественные числа.'},
  {q:'Как проще всего проверить найденное решение системы?',o:['Подставить x обратно в исходные уравнения','Только пересчитать Δ','Поменять строки местами'],a:0,e:'Подстановка проверяет уже конечный ответ и ловит часть арифметических ошибок.'}
];
let quizSet=[],qi=0,qscore=0,answered=false;
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function startQuiz(){quizSet=shuffle(quiz).slice(0,10);qi=0;qscore=0;answered=false;renderQuiz()}
function renderQuiz(){const host=$('quizHost'),total=quizSet.length;$('quizBar').style.width=`${qi/total*100}%`;$('quizCounter').textContent=qi<total?`${qi+1} / ${total}`:`${total} / ${total}`;$('quizScore').textContent=`${qscore} верных`;
  if(qi>=total){$('quizBar').style.width='100%';host.innerHTML=`<div class="quiz-question">Готово: ${qscore} из ${total}</div><div class="quiz-feedback">Если ошибка повторяется в одной теме, вернись не к формуле, а к интерактиву этого раздела.</div>`;return}
  const item=quizSet[qi];host.innerHTML=`<div class="quiz-question">${item.q}</div><div class="quiz-options" id="quizOptions"></div><div class="quiz-feedback" id="quizFeedback">Выбери ответ.</div><button class="lesson-button primary quiz-next" id="quizNext" type="button" hidden>${qi===total-1?'Завершить':'Следующий вопрос'}</button>`;const opts=$('quizOptions'),fb=$('quizFeedback'),next=$('quizNext');item.o.forEach((t,i)=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.addEventListener('click',()=>{if(answered)return;answered=true;[...opts.children].forEach(x=>x.disabled=true);if(i===item.a){b.classList.add('correct');qscore++}else{b.classList.add('wrong');opts.children[item.a].classList.add('correct')}fb.textContent=item.e;$('quizScore').textContent=`${qscore} верных`;next.hidden=false});opts.append(b)});next.addEventListener('click',()=>{qi++;answered=false;renderQuiz()})}
$('quizRestart').addEventListener('click',startQuiz);startQuiz();
})();
