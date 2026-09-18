(() => {
'use strict';

const BUILD='0.9';
const KEY_SOURCE='mipt.bs.source';
const KEY_SECTION='mipt.bs.section';
const KEY_PINS='mipt.bs.pins';
const KEY_CACHE_PREFIX='mipt.bs.cache.';
const API='https://cloud-api.yandex.net/v1/disk/public/resources';

const $=id=>document.getElementById(id);

const setup=$('setup'),library=$('library'),connectForm=$('connectForm'),sourceInput=$('sourceInput'),setupError=$('setupError');
const shelfContent=$('shelfContent'),shelfSubtitle=$('shelfSubtitle'),openCatalogBtn=$('openCatalogBtn'),manageShelfBtn=$('manageShelfBtn');
const currentSectionLabel=$('currentSectionLabel'),catalogStats=$('catalogStats'),librarySettingsBtn=$('librarySettingsBtn');

const catalogDialog=$('catalogDialog'),closeCatalog=$('closeCatalog'),catalogSectionTitle=$('catalogSectionTitle'),chooseSectionBtn=$('chooseSectionBtn');
const searchInput=$('searchInput'),clearSearch=$('clearSearch'),starterBtn=$('starterBtn'),refreshBtn=$('refreshBtn'),bookCount=$('bookCount'),scanStatus=$('scanStatus'),scanProgress=$('scanProgress');
const folderTree=$('folderTree'),breadcrumbs=$('breadcrumbs'),catalogContent=$('catalogContent');

const sectionDialog=$('sectionDialog'),sectionChoices=$('sectionChoices'),closeSectionDialog=$('closeSectionDialog');
const settingsDialog=$('settingsDialog'),closeSettings=$('closeSettings'),settingsSource=$('settingsSource'),settingsSection=$('settingsSection'),settingsChangeSection=$('settingsChangeSection'),forgetSourceBtn=$('forgetSourceBtn');

let source='';
let rootEntries=[];
let selectedSection='';
let sectionDirs=[];
let books=[];
let metadata=[];
let currentFolder='';
let scanController=null;
let manageMode=false;

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
function norm(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/ё/g,'е').replace(/[—–_.,;:()[\]{}'"«»]/g,' ').replace(/\s+/g,' ').trim()}
function ext(name){const m=String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:''}
function pretty(name){return String(name||'').replace(/\.[^.]+$/,'').replace(/_/g,' ').replace(/\s+/g,' ').trim()}
function parts(path){return String(path||'').replace(/^\/+|\/+$/g,'').split('/').filter(Boolean)}
function parent(path){const p=parts(path);p.pop();return p.length?'/'+p.join('/'):''}
function natural(a,b){return String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'})}
function booksWord(n){n=Math.abs(Number(n))%100;const l=n%10;if(n>10&&n<20)return'книг';if(l===1)return'книга';if(l>=2&&l<=4)return'книги';return'книг'}
function colorFor(b){let h=0;const s=`${b.title}${b.author}${b.path}`;for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;return`hsl(${Math.abs(h)%360} 28% 41%)`}
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}

async function api(params,signal,suffix=''){
  const u=new URL(API+suffix);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v))});
  const c=new AbortController(),onAbort=()=>c.abort();
  if(signal){if(signal.aborted)c.abort();else signal.addEventListener('abort',onAbort,{once:true})}
  let timed=false;const timer=setTimeout(()=>{timed=true;c.abort()},24000);
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
  const hay=norm(`${name} ${path}`);let best=null,score=0;
  for(const m of metadata){
    for(const alias of [...(m.aliases||[]),m.title||'',m.author||'']){
      const a=norm(alias);if(a.length>=4&&hay.includes(a)&&a.length>score){best=m;score=a.length}
    }
  }
  return best;
}
function inferSubject(path,m){
  if(m?.subject)return m.subject;
  const p=norm(path),rules=[
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
  rootEntries=(data._embedded?.items||[]).map(i=>({name:i.name,type:i.type,path:normalizeApiPath(i.path,'',i.name)})).sort((a,b)=>natural(a.name,b.name));
}
function normalizeApiPath(apiPath,parentPath,name){
  let p=String(apiPath||'').trim();
  if(!p||/^disk:/i.test(p)||/^public:/i.test(p))return `${parentPath}/${name}`.replace(/\/+/g,'/');
  if(!p.startsWith('/'))p='/'+p;
  return p.replace(/\/+/g,'/');
}
function cacheKey(){return KEY_CACHE_PREFIX+btoa(unescape(encodeURIComponent(`${source}|${selectedSection}`))).replace(/=+$/,'')}
function loadCache(){try{const c=JSON.parse(localStorage.getItem(cacheKey())||'null');if(!c||!Array.isArray(c.files)||!Array.isArray(c.dirs))return null;return c}catch(_){return null}}
function saveCache(files,dirs){try{localStorage.setItem(cacheKey(),JSON.stringify({savedAt:Date.now(),files,dirs}))}catch(_){}}

async function scanSection(force=false){
  if(!selectedSection)return;
  scanController?.abort();scanController=new AbortController();scanProgress.classList.add('busy');refreshBtn.disabled=true;

  const cached=!force?loadCache():null;
  if(cached){
    books=cached.files.map(decorate);sectionDirs=cached.dirs;renderEverything();
    if(Date.now()-cached.savedAt<8*60*60*1000){
      scanStatus.textContent=`из кэша: ${books.length} ${booksWord(books.length)}`;
      scanProgress.classList.remove('busy');refreshBtn.disabled=false;return
    }
  }

  const files=new Map(),dirs=new Map();
  dirs.set(selectedSection,{path:selectedSection,name:parts(selectedSection).at(-1)||selectedSection,parent:parent(selectedSection)});
  let queue=[{path:selectedSection,depth:0}],scanned=0,failed=0;
  try{
    while(queue.length&&scanned<2500&&files.size<7000){
      const batch=queue.splice(0,5);
      const results=await Promise.all(batch.map(async t=>{
        try{return await readDir(t,scanController.signal)}
        catch(e){if(e.name==='AbortError')throw e;failed++;return{files:[],dirs:[]}}
      }));
      scanned+=batch.length;
      for(const r of results){
        for(const d of r.dirs)if(!dirs.has(d.path)){dirs.set(d.path,d);if(d.depth<=18)queue.push({path:d.path,depth:d.depth})}
        for(const f of r.files)files.set(f.path,f);
      }
      books=[...files.values()].map(decorate);sectionDirs=[...dirs.values()];
      scanStatus.textContent=`папок: ${scanned} · найдено: ${books.length}${failed?` · ошибок: ${failed}`:''}`;
      renderEverything();await new Promise(r=>setTimeout(r,0));
    }
    const raw=[...files.values()],rawDirs=[...dirs.values()];
    books=raw.map(decorate);sectionDirs=rawDirs;saveCache(raw,rawDirs);
    scanStatus.textContent=`готово: ${books.length} ${booksWord(books.length)}${failed?` · ошибок: ${failed}`:''}`;
    renderEverything();
  }catch(e){
    if(e.name!=='AbortError')catalogContent.innerHTML=`<div class="error"><strong>Ошибка чтения раздела.</strong> ${esc(e.message)}</div>`;
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
    offset+=items.length;if(!items.length||offset>=Number(embedded.total||items.length))break;
  }while(true);
  return{files,dirs}
}

/* Shelf */
function getPins(){try{return JSON.parse(localStorage.getItem(KEY_PINS)||'[]')}catch(_){return[]}}
function setPins(p){localStorage.setItem(KEY_PINS,JSON.stringify(p))}
function bookId(b){return `${source}|${b.path}`}
function isPinned(b){return getPins().some(p=>p.id===bookId(b))}
function togglePin(b){
  const pins=getPins(),id=bookId(b),idx=pins.findIndex(p=>p.id===id);
  if(idx>=0)pins.splice(idx,1);else pins.push({id,path:b.path,name:b.name,source,section:selectedSection,addedAt:Date.now()});
  setPins(pins);renderEverything();
}
function pinnedBooks(){
  const ids=new Set(getPins().filter(p=>p.source===source).map(p=>p.id));
  return books.filter(b=>ids.has(bookId(b)));
}
function renderEverything(){
  const pins=pinnedBooks();
  shelfSubtitle.textContent=manageMode?'Режим управления: удаление доступно отдельной кнопкой на книге.':'Нажмите на корешок, чтобы открыть книгу.';
  bookCount.textContent=`${books.length} ${booksWord(books.length)}`;
  catalogStats.textContent=`${books.length} ${booksWord(books.length)} в разделе`;
  renderShelf();
  renderStarterButton();
  if(catalogDialog.open){renderFolderTree();renderCatalog()}
}
function renderShelf(){
  const items=pinnedBooks();shelfContent.innerHTML='';
  if(!items.length){
    const box=document.createElement('div');box.className='shelf-empty';
    box.innerHTML='<strong>Полка пока пустая</strong>Добавьте только те книги, которые хотите держать под рукой.';
    const actions=document.createElement('div');actions.className='empty-actions';
    const add=document.createElement('button');add.type='button';add.className='btn primary';add.textContent='+ Открыть каталог';add.addEventListener('click',openCatalog);
    actions.append(add);
    if(books.some(b=>b.starter)){const starter=document.createElement('button');starter.type='button';starter.className='btn';starter.textContent='Добавить знакомые учебники 1 курса';starter.addEventListener('click',addStarterBooks);actions.append(starter)}
    box.append(actions);shelfContent.append(box);return;
  }
  const groups=new Map();
  for(const b of items){if(!groups.has(b.subject))groups.set(b.subject,[]);groups.get(b.subject).push(b)}
  for(const [subject,group] of [...groups.entries()].sort((a,b)=>natural(a[0],b[0]))){
    const sec=document.createElement('section');sec.className='personal-subject';
    const head=document.createElement('div');head.className='personal-subject-head';head.innerHTML=`<h3>${esc(subject)}</h3><span>${group.length} ${booksWord(group.length)}</span>`;
    const shelf=document.createElement('div');shelf.className='personal-shelf';
    for(const b of group.sort((a,b)=>natural(a.title,b.title)))shelf.append(spine(b));
    sec.append(head,shelf);shelfContent.append(sec)
  }
}
function spine(b){
  const el=document.createElement('div');el.className='spine'+(manageMode?' manage':'');el.style.setProperty('--book-color',colorFor(b));el.tabIndex=0;el.title=[b.title,b.author,b.volume].filter(Boolean).join(' — ');
  const t=document.createElement('span');t.className='spine-title';t.textContent=b.volume?`${b.title} · ${b.volume}`:b.title;el.append(t);
  if(manageMode){
    const rem=document.createElement('button');rem.type='button';rem.className='spine-remove';rem.textContent='Убрать';rem.addEventListener('click',e=>{e.stopPropagation();if(confirm(`Убрать «${b.title}» с полки?`))togglePin(b)});el.append(rem)
  }else{
    el.addEventListener('click',()=>openBook(b));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openBook(b)}})
  }
  return el
}
manageShelfBtn.addEventListener('click',()=>{
  manageMode=!manageMode;manageShelfBtn.setAttribute('aria-pressed',String(manageMode));manageShelfBtn.textContent=manageMode?'Готово':'Управление';renderEverything()
});
function renderStarterButton(){
  const can=books.some(b=>b.starter&&!isPinned(b));starterBtn.hidden=!can;
}
function addStarterBooks(){
  const seen=new Set(),pins=getPins(),ids=new Set(pins.map(p=>p.id));
  for(const b of books.filter(b=>b.starter)){
    const key=b.metadataId||bookId(b);if(seen.has(key))continue;seen.add(key);
    if(!ids.has(bookId(b)))pins.push({id:bookId(b),path:b.path,name:b.name,source,section:selectedSection,addedAt:Date.now()})
  }
  setPins(pins);renderEverything()
}
starterBtn.addEventListener('click',addStarterBooks);

/* Catalog */
function directChildDirs(folder){
  return sectionDirs.filter(d=>d.parent===folder&&descendantCount(d.path)>0).sort((a,b)=>natural(a.name,b.name))
}
function directBooks(folder){return books.filter(b=>parent(b.path)===folder).sort((a,b)=>natural(a.title,b.title))}
function descendantCount(folder){const prefix=folder.endsWith('/')?folder:folder+'/';return books.filter(b=>b.path.startsWith(prefix)).length}
function renderFolderTree(){
  folderTree.innerHTML='';
  const rootBtn=document.createElement('button');rootBtn.type='button';rootBtn.textContent=parts(selectedSection).at(-1)||'Раздел';if(currentFolder===selectedSection)rootBtn.classList.add('active');
  rootBtn.addEventListener('click',()=>{currentFolder=selectedSection;searchInput.value='';renderFolderTree();renderCatalog()});folderTree.append(rootBtn);
  for(const d of directChildDirs(selectedSection)){
    const b=document.createElement('button');b.type='button';b.textContent=d.name;b.title=d.name;if(currentFolder===d.path)b.classList.add('active');
    b.addEventListener('click',()=>{currentFolder=d.path;searchInput.value='';renderFolderTree();renderCatalog()});folderTree.append(b)
  }
}
function renderBreadcrumbs(){
  breadcrumbs.innerHTML='';const rootParts=parts(selectedSection),cur=parts(currentFolder);let acc='';
  for(let i=0;i<cur.length;i++){
    acc+='/'+cur[i];if(i<rootParts.length-1)continue;
    if(breadcrumbs.children.length){const s=document.createElement('span');s.className='crumb-sep';s.textContent='›';breadcrumbs.append(s)}
    const b=document.createElement('button');b.type='button';b.className='crumb'+(i===cur.length-1?' current':'');b.textContent=cur[i];const target=acc;
    b.addEventListener('click',()=>{currentFolder=target;searchInput.value='';renderFolderTree();renderCatalog()});breadcrumbs.append(b)
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
  clearSearch.hidden=!searchInput.value;renderBreadcrumbs();catalogContent.innerHTML='';
  const q=searchInput.value.trim();
  if(q){
    const results=books.map(b=>({b,s:searchScore(b,q)})).filter(x=>x.s>=0).sort((a,b)=>b.s-a.s||natural(a.b.title,b.b.title)).map(x=>x.b);
    const summary=document.createElement('div');summary.className='result-summary';summary.innerHTML=`По запросу <strong>«${esc(q)}»</strong>: ${results.length} ${booksWord(results.length)}`;catalogContent.append(summary);
    if(results.length)catalogContent.append(bookList(results.slice(0,250)));else catalogContent.innerHTML+=`<div class="empty">Ничего не найдено.</div>`;
    return
  }
  const dirs=directChildDirs(currentFolder),files=directBooks(currentFolder);
  if(dirs.length){
    const h=document.createElement('div');h.className='catalog-section-head';h.innerHTML=`<h3>Папки</h3><span>${dirs.length}</span>`;catalogContent.append(h);
    const g=document.createElement('div');g.className='folder-grid';
    for(const d of dirs){
      const c=document.createElement('button');c.type='button';c.className='folder-card';const count=descendantCount(d.path);
      c.innerHTML=`<div>📁</div><strong>${esc(d.name)}</strong><span>${count} ${booksWord(count)}</span>`;
      c.addEventListener('click',()=>{currentFolder=d.path;renderCatalog();renderFolderTree()});g.append(c)
    }
    catalogContent.append(g)
  }
  if(files.length){
    const h=document.createElement('div');h.className='catalog-section-head';h.innerHTML=`<h3>Книги</h3><span>${files.length}</span>`;catalogContent.append(h);catalogContent.append(bookList(files))
  }
  if(!dirs.length&&!files.length)catalogContent.innerHTML='<div class="empty">Здесь нет поддерживаемых книг.</div>'
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
    const pin=document.createElement('button');pin.type='button';pin.className='small-action'+(isPinned(b)?' pinned':'');pin.textContent=isPinned(b)?'На полке':'+ На полку';pin.addEventListener('click',()=>togglePin(b));
    const read=document.createElement('button');read.type='button';read.className='small-action';read.textContent='Открыть';read.addEventListener('click',()=>openBook(b));
    actions.append(pin,read);c.append(col,main,actions);g.append(c)
  }
  return g
}
function openCatalog(){
  catalogSectionTitle.textContent=parts(selectedSection).at(-1)||selectedSection;currentFolder=currentFolder||selectedSection;catalogDialog.showModal();renderFolderTree();renderCatalog()
}
openCatalogBtn.addEventListener('click',openCatalog);closeCatalog.addEventListener('click',()=>catalogDialog.close());
searchInput.addEventListener('input',renderCatalog);clearSearch.addEventListener('click',()=>{searchInput.value='';clearSearch.hidden=true;renderCatalog();searchInput.focus()});
refreshBtn.addEventListener('click',()=>{localStorage.removeItem(cacheKey());scanSection(true)});

/* Section/source settings */
function renderSectionChoices(){
  sectionChoices.innerHTML='';
  for(const e of rootEntries.filter(x=>x.type==='dir')){
    const b=document.createElement('button');b.type='button';b.className='section-choice';b.innerHTML=`<strong>${esc(e.name)}</strong><span>${esc(e.path)}</span>`;
    b.addEventListener('click',async()=>{selectedSection=e.path;localStorage.setItem(KEY_SECTION,selectedSection);currentFolder=selectedSection;currentSectionLabel.textContent=e.name;catalogSectionTitle.textContent=e.name;sectionDialog.close();await scanSection(false)})
    sectionChoices.append(b)
  }
}
chooseSectionBtn.addEventListener('click',()=>{renderSectionChoices();sectionDialog.showModal()});
closeSectionDialog.addEventListener('click',()=>sectionDialog.close());
librarySettingsBtn.addEventListener('click',()=>{settingsSource.textContent=source;settingsSection.textContent=parts(selectedSection).at(-1)||selectedSection;settingsDialog.showModal()});
closeSettings.addEventListener('click',()=>settingsDialog.close());
settingsChangeSection.addEventListener('click',()=>{settingsDialog.close();renderSectionChoices();sectionDialog.showModal()});
forgetSourceBtn.addEventListener('click',()=>{
  if(!confirm('Отключить источник? Полка для этого источника останется сохранённой в браузере, но не будет показана до повторного подключения.'))return;
  scanController?.abort();localStorage.removeItem(KEY_SOURCE);localStorage.removeItem(KEY_SECTION);settingsDialog.close();library.hidden=true;setup.hidden=false;sourceInput.value='';source='';books=[];sectionDirs=[]
});

async function connect(value){
  source=normalizeSource(value);localStorage.setItem(KEY_SOURCE,source);setup.hidden=true;library.hidden=false;
  await readRoot();
  const saved=localStorage.getItem(KEY_SECTION),available=new Set(rootEntries.filter(x=>x.type==='dir').map(x=>x.path));
  selectedSection=saved&&available.has(saved)?saved:(rootEntries.find(x=>x.type==='dir'&&norm(x.name)==='1 курс')?.path||rootEntries.find(x=>x.type==='dir')?.path||'');
  if(!selectedSection){renderSectionChoices();sectionDialog.showModal();return}
  localStorage.setItem(KEY_SECTION,selectedSection);currentFolder=selectedSection;
  const name=parts(selectedSection).at(-1)||selectedSection;currentSectionLabel.textContent=name;catalogSectionTitle.textContent=name;
  await scanSection(false)
}
connectForm.addEventListener('submit',async e=>{
  e.preventDefault();const v=normalizeSource(sourceInput.value);
  if(!validSource(v)){setupError.textContent='Вставьте публичную ссылку Яндекс Диска вида disk.yandex.ru/d/…';setupError.hidden=false;return}
  setupError.hidden=true;try{await connect(v)}catch(err){setupError.textContent=err.message;setupError.hidden=false;library.hidden=true;setup.hidden=false}
});

/* Чтение книг.
   Яндекс Документы запрещает отображение внутри iframe другого сайта.
   Поэтому на полностью статическом GitHub Pages корректный вариант —
   сразу открыть Яндекс Просмотр документов в новой вкладке.

   Вкладка создаётся синхронно по клику, чтобы браузер не блокировал её как popup.
   Пока API выдаёт временную ссылку, в ней показывается короткий экран загрузки.
*/
function yandexFileUrl(book){
  const base=source.replace(/\/$/,'');
  return `${base}/${parts(book.path).map(encodeURIComponent).join('/')}`
}
function buildDocviewerUrl(href,book){
  const u=new URL('https://docviewer.yandex.ru/');
  u.searchParams.set('url',href);
  u.searchParams.set('name',book.name);
  u.searchParams.set('lang','ru');
  return u.toString()
}
function writeOpeningPage(win,book){
  try{
    win.document.open();
    win.document.write(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Открываем ${esc(book.title)}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;color:#17202a;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}
main{text-align:center;max-width:540px;padding:32px}
.spinner{width:34px;height:34px;margin:0 auto 18px;border:3px solid #d7dee5;border-top-color:#315f9a;border-radius:50%;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
h1{font-size:1.1rem;margin:0 0 8px}
p{color:#687582;line-height:1.5}
</style>
</head>
<body>
<main>
<div class="spinner"></div>
<h1>${esc(book.title)}</h1>
<p>Открываем документ в просмотрщике Яндекса…</p>
</main>
</body>
</html>`);
    win.document.close();
  }catch(_){}
}
async function openBook(book){
  const fallback=yandexFileUrl(book);
  const win=window.open('about:blank','_blank');

  if(!win){
    window.open(fallback,'_blank','noopener');
    return;
  }

  writeOpeningPage(win,book);

  try{
    const d=await api({public_key:source,path:book.path},null,'/download');
    if(!d.href)throw new Error('Яндекс не вернул ссылку на документ.');
    win.location.replace(buildDocviewerUrl(d.href,book));
  }catch(e){
    try{win.location.replace(fallback)}
    catch(_){window.open(fallback,'_blank','noopener')}
  }
}

(async function init(){
  metadata=await loadMetadata();
  const saved=localStorage.getItem(KEY_SOURCE);
  if(saved&&validSource(saved)){sourceInput.value=saved;try{await connect(saved)}catch(_){setup.hidden=false;library.hidden=true}}
  else{setup.hidden=false;library.hidden=true}
})();
})();
