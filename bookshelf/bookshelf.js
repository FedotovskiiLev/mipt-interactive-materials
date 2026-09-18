(() => {
'use strict';

const BUILD='0.7';
const KEY_SOURCE='mipt.bs.source';
const KEY_SECTION='mipt.bs.section';
const KEY_PINS='mipt.bs.pins';
const KEY_TAB='mipt.bs.tab';
const KEY_CACHE_PREFIX='mipt.bs.cache.';
const API='https://cloud-api.yandex.net/v1/disk/public/resources';

const $=id=>document.getElementById(id);
const setup=$('setup'), library=$('library'), connectForm=$('connectForm'), sourceInput=$('sourceInput'), setupError=$('setupError');
const sectionName=$('sectionName'), chooseSectionBtn=$('chooseSectionBtn'), sectionDialog=$('sectionDialog'), sectionChoices=$('sectionChoices');
const shelfTab=$('shelfTab'), catalogTab=$('catalogTab'), shelfView=$('shelfView'), catalogView=$('catalogView'), pinCount=$('pinCount');
const shelfContent=$('shelfContent'), starterBtn=$('starterBtn');
const searchInput=$('searchInput'), clearSearch=$('clearSearch'), refreshBtn=$('refreshBtn'), bookCount=$('bookCount'), scanStatus=$('scanStatus'), scanProgress=$('scanProgress');
const folderTree=$('folderTree'), breadcrumbs=$('breadcrumbs'), catalogContent=$('catalogContent'), sourceName=$('sourceName'), changeSourceBtn=$('changeSourceBtn');

const readerDialog=$('readerDialog'), readerStatus=$('readerStatus'), readerMessage=$('readerMessage'), readerControls=$('readerControls');
const pdfCanvas=$('pdfCanvas'), canvasWrap=$('canvasWrap'), pageInput=$('pageInput'), pageCount=$('pageCount'), zoomLabel=$('zoomLabel');
const readerYandex=$('readerYandex');

let source='';
let rootEntries=[];
let selectedSection='';
let sectionDirs=[];
let books=[];
let metadata=[];
let currentFolder='';
let activeTab=localStorage.getItem(KEY_TAB)==='catalog'?'catalog':'shelf';
let scanController=null;

let pdfjs=null, pdfDoc=null, currentPage=1, currentScale=1, renderTask=null, readerController=null;

const BOOK_EXT=new Set(['pdf','djvu','epub']);

function normalizeSource(v){
  try{
    const u=new URL(String(v||'').trim());
    u.search='';u.hash='';u.pathname=u.pathname.replace(/\/+$/,'');
    return u.toString().replace(/\/$/,'');
  }catch(_){return String(v||'').trim()}
}
function validSource(v){
  try{
    const u=new URL(normalizeSource(v));
    return ['disk.yandex.ru','disk.360.yandex.ru','yadi.sk'].includes(u.hostname)&&/\/(d|i)\//.test(u.pathname);
  }catch(_){return false}
}
function norm(v){
  return String(v||'').toLowerCase().normalize('NFKD').replace(/ё/g,'е').replace(/[—–_.,;:()[\]{}'"«»]/g,' ').replace(/\s+/g,' ').trim();
}
function ext(name){const m=String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:''}
function pretty(name){return String(name||'').replace(/\.[^.]+$/,'').replace(/_/g,' ').replace(/\s+/g,' ').trim()}
function parts(path){return String(path||'').replace(/^\/+|\/+$/g,'').split('/').filter(Boolean)}
function parent(path){const p=parts(path);p.pop();return p.length?'/'+p.join('/'):''}
function natural(a,b){return String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'})}
function booksWord(n){n=Math.abs(Number(n))%100;const l=n%10;if(n>10&&n<20)return'книг';if(l===1)return'книга';if(l>=2&&l<=4)return'книги';return'книг'}
function colorFor(b){let h=0;const s=`${b.title}${b.author}${b.path}`;for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;return`hsl(${Math.abs(h)%360} 28% 41%)`}
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}

async function api(params, signal, suffix=''){
  const u=new URL(API+suffix);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v))});
  const c=new AbortController(), onAbort=()=>c.abort();
  if(signal){if(signal.aborted)c.abort();else signal.addEventListener('abort',onAbort,{once:true})}
  let timed=false;
  const timer=setTimeout(()=>{timed=true;c.abort()},24000);
  try{
    const r=await fetch(u,{signal:c.signal});
    if(!r.ok){
      let detail='';try{const p=await r.json();detail=p.message||p.description||p.error||''}catch(_){}
      throw new Error(`HTTP ${r.status}${detail?' · '+detail:''}`);
    }
    return await r.json();
  }catch(e){
    if(timed)throw new Error('Яндекс Диск слишком долго не отвечает.');
    throw e;
  }finally{
    clearTimeout(timer);if(signal)signal.removeEventListener('abort',onAbort)
  }
}

async function loadMetadata(){
  try{const r=await fetch('metadata.json',{cache:'no-cache'});const d=r.ok?await r.json():{};return Array.isArray(d.books)?d.books:[]}catch(_){return[]}
}
function matchMeta(name,path){
  const hay=norm(`${name} ${path}`);
  let best=null,score=0;
  for(const m of metadata){
    for(const alias of [...(m.aliases||[]),m.title||'',m.author||'']){
      const a=norm(alias);
      if(a.length>=4&&hay.includes(a)&&a.length>score){best=m;score=a.length}
    }
  }
  return best;
}
function inferSubject(path,m){
  if(m?.subject)return m.subject;
  const p=norm(path);
  const rules=[
    ['Математический анализ',['матан','мат анализ','математический анализ','calculus','интеграл','производн']],
    ['Линейная алгебра и аналитическая геометрия',['ангем','линал','линейная алгебра','аналитическая геометрия']],
    ['Физика',['физика','механика','термодинамика','молекулярн','оптика']],
    ['Химия',['химия']],['Биология',['биология','биофизика','биохимия']]
  ];
  for(const [s,ws] of rules)if(ws.some(w=>p.includes(norm(w))))return s;
  return 'Другое';
}
function decorate(f){
  const m=matchMeta(f.name,f.path);
  return {...f,title:m?.title||pretty(f.name),author:m?.author||'',volume:m?.volume||'',subject:inferSubject(f.path,m),kind:m?.kind||'Книга',metadataId:m?.id||null,starter:!!m?.starter,ext:ext(f.name)};
}

async function readRoot(){
  const data=await api({public_key:source,limit:1000});
  const items=data._embedded?.items||[];
  rootEntries=items.map(i=>({name:i.name,type:i.type,path:normalizeApiPath(i.path,'',i.name)})).sort((a,b)=>natural(a.name,b.name));
}
function normalizeApiPath(apiPath,parentPath,name){
  let p=String(apiPath||'').trim();
  if(!p||/^disk:/i.test(p)||/^public:/i.test(p))return `${parentPath}/${name}`.replace(/\/+/g,'/');
  if(!p.startsWith('/'))p='/'+p;
  return p.replace(/\/+/g,'/');
}

function cacheKey(){return KEY_CACHE_PREFIX+btoa(unescape(encodeURIComponent(`${source}|${selectedSection}`))).replace(/=+$/,'')}
function loadCache(){
  try{const c=JSON.parse(localStorage.getItem(cacheKey())||'null');if(!c||!Array.isArray(c.files)||!Array.isArray(c.dirs))return null;return c}catch(_){return null}
}
function saveCache(files,dirs){
  try{localStorage.setItem(cacheKey(),JSON.stringify({savedAt:Date.now(),files,dirs}))}catch(_){}
}

async function scanSection(force=false){
  if(!selectedSection)return;
  scanController?.abort();scanController=new AbortController();
  scanProgress.classList.add('busy');refreshBtn.disabled=true;
  const cached=!force?loadCache():null;
  if(cached){
    books=cached.files.map(decorate);sectionDirs=cached.dirs;
    renderEverything();
    if(Date.now()-cached.savedAt<8*60*60*1000){scanStatus.textContent=`из кэша: ${books.length} ${booksWord(books.length)}`;scanProgress.classList.remove('busy');refreshBtn.disabled=false;return}
  }

  const files=new Map(),dirs=new Map();
  dirs.set(selectedSection,{path:selectedSection,name:parts(selectedSection).at(-1)||selectedSection,parent:parent(selectedSection)});
  let queue=[{path:selectedSection,depth:0}],scanned=0,failed=0;
  try{
    while(queue.length&&scanned<2500&&files.size<7000){
      const batch=queue.splice(0,5);
      const results=await Promise.all(batch.map(async t=>{
        try{
          const data=await readDir(t,scanController.signal);
          return data;
        }catch(e){
          if(e.name==='AbortError')throw e;
          failed++;return{files:[],dirs:[]}
        }
      }));
      scanned+=batch.length;
      for(const r of results){
        for(const d of r.dirs){
          if(!dirs.has(d.path)){dirs.set(d.path,d);if(d.depth<=18)queue.push({path:d.path,depth:d.depth})}
        }
        for(const f of r.files)files.set(f.path,f);
      }
      books=[...files.values()].map(decorate);
      sectionDirs=[...dirs.values()];
      scanStatus.textContent=`папок: ${scanned} · найдено: ${books.length}${failed?` · ошибок: ${failed}`:''}`;
      renderEverything();
      await new Promise(r=>setTimeout(r,0));
    }
    const raw=[...files.values()], rawDirs=[...dirs.values()];
    books=raw.map(decorate);sectionDirs=rawDirs;saveCache(raw,rawDirs);
    scanStatus.textContent=`готово: ${books.length} ${booksWord(books.length)}${failed?` · ошибок: ${failed}`:''}`;
    renderEverything();
  }catch(e){
    if(e.name!=='AbortError'){catalogContent.innerHTML=`<div class="error"><strong>Ошибка чтения раздела.</strong> ${esc(e.message)}</div>`}
  }finally{
    scanProgress.classList.remove('busy');refreshBtn.disabled=false;
  }
}
async function readDir(task,signal){
  const files=[],dirs=[];let offset=0;
  do{
    const data=await api({public_key:source,path:task.path,limit:1000,offset},signal);
    const embedded=data._embedded||{},items=embedded.items||[];
    for(const i of items){
      const p=normalizeApiPath(i.path,task.path,i.name);
      if(i.type==='dir')dirs.push({path:p,name:i.name,parent:task.path,depth:task.depth+1});
      else if(BOOK_EXT.has(ext(i.name)))files.push({name:i.name,path:p,size:i.size||0,mime:i.mime_type||''});
    }
    offset+=items.length;
    if(!items.length||offset>=Number(embedded.total||items.length))break;
  }while(true);
  return{files,dirs}
}

function renderEverything(){
  bookCount.textContent=`${books.length} ${booksWord(books.length)}`;
  pinCount.textContent=String(getPins().length);
  renderStarterButton();
  renderShelf();
  if(activeTab==='catalog'){renderFolderTree();renderCatalog()}
}

function getPins(){try{return JSON.parse(localStorage.getItem(KEY_PINS)||'[]')}catch(_){return[]}}
function setPins(p){localStorage.setItem(KEY_PINS,JSON.stringify(p));pinCount.textContent=String(p.length)}
function bookId(b){return `${source}|${b.path}`}
function isPinned(b){return getPins().some(p=>p.id===bookId(b))}
function togglePin(b){
  const pins=getPins(),id=bookId(b),idx=pins.findIndex(p=>p.id===id);
  if(idx>=0)pins.splice(idx,1);
  else pins.push({id,path:b.path,name:b.name,source,section:selectedSection,addedAt:Date.now()});
  setPins(pins);renderShelf();if(activeTab==='catalog')renderCatalog()
}
function pinnedBooks(){
  const ids=new Set(getPins().filter(p=>p.source===source).map(p=>p.id));
  return books.filter(b=>ids.has(bookId(b)));
}

function renderStarterButton(){
  const hasStarter=books.some(b=>b.starter);
  const allStarterPinned=books.filter(b=>b.starter).every(b=>isPinned(b));
  starterBtn.hidden=!hasStarter||allStarterPinned;
}
starterBtn.addEventListener('click',()=>{
  const candidates=[];
  const seenMeta=new Set();
  for(const b of books.filter(b=>b.starter)){
    const key=b.metadataId||bookId(b);if(seenMeta.has(key))continue;seenMeta.add(key);candidates.push(b)
  }
  const pins=getPins(),ids=new Set(pins.map(p=>p.id));
  for(const b of candidates)if(!ids.has(bookId(b)))pins.push({id:bookId(b),path:b.path,name:b.name,source,section:selectedSection,addedAt:Date.now()});
  setPins(pins);renderShelf();renderStarterButton();
});

function renderShelf(){
  const items=pinnedBooks();
  shelfContent.innerHTML='';
  if(!items.length){
    shelfContent.innerHTML=`<div class="shelf-empty"><strong>Полка пока пустая</strong>Откройте «Каталог» и нажимайте «На полку» у нужных книг. Если в выбранном разделе найдены знакомые учебники первого курса, можно собрать базовую полку одной кнопкой.</div>`;
    return;
  }
  const groups=new Map();
  for(const b of items){if(!groups.has(b.subject))groups.set(b.subject,[]);groups.get(b.subject).push(b)}
  for(const [subject,group] of [...groups.entries()].sort((a,b)=>natural(a[0],b[0]))){
    const sec=document.createElement('section');sec.className='personal-subject';
    const head=document.createElement('div');head.className='personal-subject-head';
    head.innerHTML=`<h3>${esc(subject)}</h3><span>${group.length} ${booksWord(group.length)}</span>`;
    const shelf=document.createElement('div');shelf.className='personal-shelf';
    for(const b of group.sort((a,b)=>natural(a.title,b.title)))shelf.append(spine(b));
    sec.append(head,shelf);shelfContent.append(sec)
  }
}
function spine(b){
  const btn=document.createElement('button');btn.type='button';btn.className='spine';btn.style.setProperty('--book-color',colorFor(b));btn.title=[b.title,b.author,b.volume].filter(Boolean).join(' — ');
  const t=document.createElement('span');t.className='spine-title';t.textContent=b.volume?`${b.title} · ${b.volume}`:b.title;
  const rem=document.createElement('button');rem.type='button';rem.className='spine-remove';rem.textContent='×';rem.title='Убрать с полки';
  rem.addEventListener('click',e=>{e.stopPropagation();togglePin(b)});
  btn.append(t,rem);btn.addEventListener('click',()=>openBook(b));return btn
}

function setTab(tab){
  activeTab=tab;localStorage.setItem(KEY_TAB,tab);
  const shelf=tab==='shelf';shelfTab.setAttribute('aria-selected',String(shelf));catalogTab.setAttribute('aria-selected',String(!shelf));
  shelfView.hidden=!shelf;catalogView.hidden=shelf;
  if(!shelf){renderFolderTree();renderCatalog();searchInput.focus()}
}
shelfTab.addEventListener('click',()=>setTab('shelf'));
catalogTab.addEventListener('click',()=>setTab('catalog'));

function directChildDirs(folder){
  return sectionDirs.filter(d=>d.parent===folder).sort((a,b)=>natural(a.name,b.name))
}
function directBooks(folder){
  return books.filter(b=>parent(b.path)===folder).sort((a,b)=>natural(a.title,b.title))
}
function descendantCount(folder){
  const prefix=folder.endsWith('/')?folder:folder+'/';
  return books.filter(b=>b.path.startsWith(prefix)).length
}

function renderFolderTree(){
  folderTree.innerHTML='';
  const rootBtn=document.createElement('button');rootBtn.type='button';rootBtn.textContent=parts(selectedSection).at(-1)||'Раздел';rootBtn.className=currentFolder===selectedSection?'active':'';
  rootBtn.addEventListener('click',()=>{currentFolder=selectedSection;searchInput.value='';renderFolderTree();renderCatalog()});folderTree.append(rootBtn);
  for(const d of directChildDirs(selectedSection)){
    const b=document.createElement('button');b.type='button';b.textContent=d.name;b.title=d.name;if(currentFolder===d.path)b.classList.add('active');
    b.addEventListener('click',()=>{currentFolder=d.path;searchInput.value='';renderFolderTree();renderCatalog()});folderTree.append(b)
  }
}
function renderBreadcrumbs(){
  breadcrumbs.innerHTML='';const rootParts=parts(selectedSection),cur=parts(currentFolder);
  let acc='';
  for(let i=0;i<cur.length;i++){
    acc+='/'+cur[i];
    if(i<rootParts.length-1)continue;
    if(breadcrumbs.children.length){const s=document.createElement('span');s.className='crumb-sep';s.textContent='›';breadcrumbs.append(s)}
    const btn=document.createElement('button');btn.type='button';btn.className='crumb'+(i===cur.length-1?' current':'');btn.textContent=cur[i];
    const target=acc;btn.addEventListener('click',()=>{currentFolder=target;searchInput.value='';renderFolderTree();renderCatalog()});breadcrumbs.append(btn)
  }
}
function searchScore(b,q){
  const terms=norm(q).split(' ').filter(Boolean);if(!terms.length)return-1;
  const fields=[[norm(b.title),10],[norm(b.author),8],[norm(b.name),7],[norm(b.path),2]];
  let score=0;
  for(const term of terms){let best=0;for(const [text,w] of fields){if(text===term)best=Math.max(best,w*4);else if(text.startsWith(term))best=Math.max(best,w*2);else if(text.includes(term))best=Math.max(best,w)}if(!best)return-1;score+=best}
  return score
}
function renderCatalog(){
  clearSearch.hidden=!searchInput.value;
  renderBreadcrumbs();
  const q=searchInput.value.trim();
  catalogContent.innerHTML='';
  if(q){
    const results=books.map(b=>({b,s:searchScore(b,q)})).filter(x=>x.s>=0).sort((a,b)=>b.s-a.s||natural(a.b.title,b.b.title)).map(x=>x.b);
    catalogContent.innerHTML=`<div class="result-summary">По запросу <strong>«${esc(q)}»</strong>: ${results.length} ${booksWord(results.length)}</div>`;
    if(results.length)catalogContent.append(bookList(results.slice(0,250)));else catalogContent.innerHTML+=`<div class="empty">Ничего не найдено.</div>`;
    return;
  }
  const dirs=directChildDirs(currentFolder),files=directBooks(currentFolder);
  if(dirs.length){
    const h=document.createElement('div');h.className='catalog-section-head';h.innerHTML=`<h2>Папки</h2><span>${dirs.length}</span>`;catalogContent.append(h);
    const g=document.createElement('div');g.className='folder-grid';
    for(const d of dirs){
      const c=document.createElement('button');c.type='button';c.className='folder-card';const count=descendantCount(d.path);
      c.innerHTML=`<div>📁</div><strong>${esc(d.name)}</strong><span>${count} ${booksWord(count)}</span>`;
      c.addEventListener('click',()=>{currentFolder=d.path;renderCatalog();renderFolderTree()});g.append(c)
    }
    catalogContent.append(g)
  }
  if(files.length){
    const h=document.createElement('div');h.className='catalog-section-head';h.innerHTML=`<h2>Книги</h2><span>${files.length}</span>`;catalogContent.append(h);catalogContent.append(bookList(files))
  }
  if(!dirs.length&&!files.length)catalogContent.innerHTML=`<div class="empty">В этой папке нет PDF, DJVU или EPUB.</div>`;
}
function bookList(items){
  const g=document.createElement('div');g.className='book-list';
  for(const b of items){
    const c=document.createElement('article');c.className='catalog-book';
    const col=document.createElement('span');col.className='catalog-book-color';col.style.setProperty('--book-color',colorFor(b));
    const main=document.createElement('div');main.className='catalog-book-main';
    const title=document.createElement('div');title.className='catalog-book-title';title.textContent=b.volume?`${b.title} — ${b.volume}`:b.title;title.title=b.name;
    const author=document.createElement('div');author.className='catalog-book-author';author.textContent=b.author||parent(b.path);
    const meta=document.createElement('div');meta.className='catalog-book-meta';meta.textContent=b.ext.toUpperCase();
    main.append(title,author,meta);
    const actions=document.createElement('div');actions.className='catalog-book-actions';
    const pin=document.createElement('button');pin.type='button';pin.className='small-action'+(isPinned(b)?' pinned':'');pin.textContent=isPinned(b)?'На полке':'На полку';pin.addEventListener('click',()=>togglePin(b));
    const read=document.createElement('button');read.type='button';read.className='small-action';read.textContent=b.ext==='pdf'?'Читать':'Открыть';read.addEventListener('click',()=>openBook(b));
    actions.append(pin,read);c.append(col,main,actions);g.append(c)
  }
  return g
}

function chooseSection(open=true){
  sectionChoices.innerHTML='';
  for(const entry of rootEntries.filter(x=>x.type==='dir')){
    const b=document.createElement('button');b.type='button';b.className='section-choice';
    b.innerHTML=`<strong>${esc(entry.name)}</strong><span>${entry.path}</span>`;
    b.addEventListener('click',async()=>{
      selectedSection=entry.path;localStorage.setItem(KEY_SECTION,selectedSection);currentFolder=selectedSection;sectionName.textContent=entry.name;sectionDialog.close();await scanSection(false)
    });
    sectionChoices.append(b)
  }
  if(open)sectionDialog.showModal()
}
chooseSectionBtn.addEventListener('click',()=>chooseSection(true));
$('closeSectionDialog').addEventListener('click',()=>sectionDialog.close());

async function connect(value){
  source=normalizeSource(value);localStorage.setItem(KEY_SOURCE,source);sourceName.textContent=source;setup.hidden=true;library.hidden=false;
  await readRoot();
  const saved=localStorage.getItem(KEY_SECTION);
  const available=new Set(rootEntries.filter(x=>x.type==='dir').map(x=>x.path));
  if(saved&&available.has(saved))selectedSection=saved;
  else selectedSection=rootEntries.find(x=>x.type==='dir'&&norm(x.name)==='1 курс')?.path||rootEntries.find(x=>x.type==='dir')?.path||'';
  if(!selectedSection){chooseSection(true);return}
  localStorage.setItem(KEY_SECTION,selectedSection);currentFolder=selectedSection;sectionName.textContent=parts(selectedSection).at(-1)||selectedSection;
  setTab(activeTab);await scanSection(false)
}

connectForm.addEventListener('submit',async e=>{
  e.preventDefault();const v=normalizeSource(sourceInput.value);
  if(!validSource(v)){setupError.textContent='Вставьте публичную ссылку Яндекс Диска вида disk.yandex.ru/d/…';setupError.hidden=false;return}
  setupError.hidden=true;try{await connect(v)}catch(err){setupError.textContent=err.message;setupError.hidden=false;library.hidden=true;setup.hidden=false}
});
searchInput.addEventListener('input',renderCatalog);
clearSearch.addEventListener('click',()=>{searchInput.value='';clearSearch.hidden=true;renderCatalog();searchInput.focus()});
refreshBtn.addEventListener('click',()=>{localStorage.removeItem(cacheKey());scanSection(true)});
changeSourceBtn.addEventListener('click',()=>{scanController?.abort();source='';books=[];sectionDirs=[];library.hidden=true;setup.hidden=false;sourceInput.value=localStorage.getItem(KEY_SOURCE)||''});
function cacheKey(){return KEY_CACHE_PREFIX+btoa(unescape(encodeURIComponent(`${source}|${selectedSection}`))).replace(/=+$/,'')}

async function loadPdfJs(){
  if(pdfjs)return pdfjs;
  pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
  return pdfjs;
}
async function directHref(book,signal){
  const d=await api({public_key:source,path:book.path},signal,'/download');
  if(!d.href)throw new Error('Яндекс не вернул ссылку на файл.');
  return d.href;
}
function yandexUrl(book){
  const base=source.replace(/\/$/,'');return `${base}/${parts(book.path).map(encodeURIComponent).join('/')}`
}
async function openBook(book){
  if(book.ext!=='pdf'){window.open(yandexUrl(book),'_blank','noopener');return}
  readerController?.abort();readerController=new AbortController();
  pdfDoc=null;currentPage=1;currentScale=1;
  $('readerSubject').textContent=book.subject;$('readerTitle').textContent=book.volume?`${book.title} — ${book.volume}`:book.title;$('readerAuthor').textContent=book.author||book.name;
  readerYandex.href=yandexUrl(book);readerStatus.textContent='Получаем PDF…';readerControls.hidden=true;canvasWrap.hidden=true;readerMessage.hidden=false;
  readerMessage.querySelector('strong').textContent='Загружаем PDF';
  readerMessage.querySelector('span').textContent='Получаем файл с Яндекс Диска и открываем его во встроенном просмотрщике.';
  readerDialog.showModal();
  try{
    const href=await directHref(book,readerController.signal);
    const r=await fetch(href,{signal:readerController.signal});
    if(!r.ok)throw new Error(`Не удалось получить файл: HTTP ${r.status}`);
    const data=await r.arrayBuffer();
    const lib=await loadPdfJs();
    pdfDoc=await lib.getDocument({data}).promise;
    pageCount.textContent=String(pdfDoc.numPages);pageInput.max=String(pdfDoc.numPages);pageInput.value='1';zoomLabel.textContent='100%';
    readerControls.hidden=false;readerMessage.hidden=true;canvasWrap.hidden=false;readerStatus.textContent='PDF открыт внутри сайта.';
    await renderPage()
  }catch(e){
    if(e.name==='AbortError')return;
    readerStatus.textContent='Встроенный просмотр не получился.';
    readerMessage.hidden=false;canvasWrap.hidden=true;readerControls.hidden=true;
    readerMessage.querySelector('strong').textContent='Яндекс не разрешил прочитать PDF из браузера';
    readerMessage.querySelector('span').textContent=`${e.message} Полностью статический сайт не может обойти CORS/ограничение источника. Можно открыть публичную страницу файла через кнопку «Яндекс Диск».`;
  }
}
async function renderPage(){
  if(!pdfDoc)return;
  if(renderTask)try{renderTask.cancel()}catch(_){}
  const page=await pdfDoc.getPage(currentPage);
  const viewport=page.getViewport({scale:currentScale});
  const dpr=Math.min(window.devicePixelRatio||1,2);
  pdfCanvas.width=Math.floor(viewport.width*dpr);pdfCanvas.height=Math.floor(viewport.height*dpr);
  pdfCanvas.style.width=`${viewport.width}px`;pdfCanvas.style.height=`${viewport.height}px`;
  const ctx=pdfCanvas.getContext('2d');
  renderTask=page.render({canvasContext:ctx,viewport,transform:dpr===1?null:[dpr,0,0,dpr,0,0]});
  try{await renderTask.promise}catch(e){if(e?.name!=='RenderingCancelledException')throw e}
  pageInput.value=String(currentPage);zoomLabel.textContent=`${Math.round(currentScale*100)}%`
}
$('prevPage').addEventListener('click',async()=>{if(pdfDoc&&currentPage>1){currentPage--;await renderPage()}});
$('nextPage').addEventListener('click',async()=>{if(pdfDoc&&currentPage<pdfDoc.numPages){currentPage++;await renderPage()}});
pageInput.addEventListener('change',async()=>{if(!pdfDoc)return;currentPage=Math.max(1,Math.min(pdfDoc.numPages,Number(pageInput.value)||1));await renderPage()});
$('zoomOut').addEventListener('click',async()=>{currentScale=Math.max(.5,currentScale-.15);await renderPage()});
$('zoomIn').addEventListener('click',async()=>{currentScale=Math.min(2.5,currentScale+.15);await renderPage()});
$('closeReader').addEventListener('click',()=>{readerController?.abort();if(pdfDoc)try{pdfDoc.destroy()}catch(_){}readerDialog.close()});
readerDialog.addEventListener('close',()=>{readerController?.abort();if(pdfDoc)try{pdfDoc.destroy()}catch(_){}pdfDoc=null});

(async function init(){
  metadata=await loadMetadata();
  const saved=localStorage.getItem(KEY_SOURCE);
  if(saved&&validSource(saved)){sourceInput.value=saved;try{await connect(saved)}catch(_){setup.hidden=false;library.hidden=true}}
  else{setup.hidden=false;library.hidden=true}
})();
})();
