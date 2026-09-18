(() => {
  'use strict';

  const BUILD_VERSION = '0.6';
  const STORAGE_KEY = 'mipt.bookshelf.source.v1';
  const MODE_KEY = 'mipt.bookshelf.mode.v2';
  const CACHE_KEY = 'mipt.bookshelf.cache.v3';
  const PATH_KEY = 'mipt.bookshelf.path.v1';

  const API_ENDPOINTS = [
    'https://cloud-api.yandex.net/v1/disk/public/resources',
    'https://cloud-api.yandex.ru/v1/disk/public/resources'
  ];

  const BOOK_EXTENSIONS = new Set(['pdf', 'djvu', 'epub']);
  const CONCURRENCY = 5;
  const REQUEST_TIMEOUT_MS = 24000;
  const MAX_ITEMS = 7000;
  const MAX_DIRECTORIES = 3500;
  const MAX_DEPTH = 20;
  const CACHE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

  const $ = id => document.getElementById(id);

  const setup = $('setup');
  const library = $('library');
  const connectForm = $('connectForm');
  const sourceInput = $('sourceInput');
  const setupError = $('setupError');
  const searchInput = $('searchInput');
  const clearSearch = $('clearSearch');
  const foldersBtn = $('foldersBtn');
  const subjectsBtn = $('subjectsBtn');
  const listBtn = $('listBtn');
  const refreshBtn = $('refreshBtn');
  const changeBtn = $('changeBtn');
  const catalog = $('catalog');
  const bookCount = $('bookCount');
  const sourceName = $('sourceName');
  const scanStatus = $('scanStatus');
  const scanProgress = $('scanProgress');
  const breadcrumbs = $('breadcrumbs');
  const quickFolders = $('quickFolders');

  const readerDialog = $('readerDialog');
  const readerFrame = $('readerFrame');
  const readerPlaceholder = $('readerPlaceholder');
  const readerStatus = $('readerStatus');
  const openDirect = $('openDirect');
  const openYandex = $('openYandex');

  let source = '';
  let books = [];
  let metadata = [];
  let controller = null;
  let mode = localStorage.getItem(MODE_KEY) || 'folders';
  let currentPath = localStorage.getItem(PATH_KEY) || '';
  let readerController = null;

  function normalizeSourceUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url.toString().replace(/\/$/, '');
    } catch (_) {
      return String(value || '').trim();
    }
  }

  function isYandexPublicUrl(value) {
    try {
      const url = new URL(normalizeSourceUrl(value));
      return ['disk.yandex.ru', 'disk.360.yandex.ru', 'yadi.sk'].includes(url.hostname) &&
        /\/(d|i)\//.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/ё/g, 'е')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[—–_.,;:()[\]{}'"«»]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function prettyFilename(name) {
    return String(name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extension(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function booksWord(n) {
    const value = Math.abs(Number(n)) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return 'книг';
    if (last === 1) return 'книга';
    if (last >= 2 && last <= 4) return 'книги';
    return 'книг';
  }

  function formatSize(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
  }

  function colorFor(book) {
    const s = `${book.title}${book.author}${book.path}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360} 27% 42%)`;
  }

  async function loadMetadata() {
    try {
      const r = await fetch('metadata.json', { cache: 'no-cache' });
      const data = r.ok ? await r.json() : {};
      return Array.isArray(data.books) ? data.books : [];
    } catch (_) {
      return [];
    }
  }

  function matchMetadata(name, path) {
    const hay = normalizeText(`${name} ${path}`);
    let best = null;
    let score = 0;
    for (const item of metadata) {
      const aliases = [...(item.aliases || []), item.title || '', item.author || '']
        .map(normalizeText).filter(Boolean);
      for (const alias of aliases) {
        if (alias.length >= 4 && hay.includes(alias) && alias.length > score) {
          score = alias.length;
          best = item;
        }
      }
    }
    return best;
  }

  function inferSubject(path, meta) {
    if (meta?.subject) return meta.subject;
    const p = normalizeText(path);
    const rules = [
      ['Математический анализ', ['матан','мат анализ','математический анализ','calculus','analysis','интеграл','производн']],
      ['Линейная алгебра и аналитическая геометрия', ['линал','линейная алгебра','ангем','аналитическая геометрия','linear algebra']],
      ['Физика', ['физика','physics','механика','электричество','термодинамика','оптика']],
      ['Химия', ['химия','chemistry']],
      ['Программирование', ['программирование','programming','python','c++','алгоритм']]
    ];
    for (const [subject, words] of rules) {
      if (words.some(w => p.includes(normalizeText(w)))) return subject;
    }
    return 'Другое';
  }

  function decorateFile(file) {
    const meta = matchMetadata(file.name, file.path);
    return {
      ...file,
      title: meta?.title || prettyFilename(file.name),
      author: meta?.author || '',
      volume: meta?.volume || '',
      kind: meta?.kind || 'Книга',
      subject: inferSubject(file.path, meta),
      metadataId: meta?.id || null,
      ext: extension(file.name)
    };
  }

  function sortBooks(items) {
    return items.slice().sort((a,b) =>
      (a.author || '').localeCompare(b.author || '', 'ru') ||
      a.title.localeCompare(b.title, 'ru')
    );
  }

  function pathParts(path) {
    return String(path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  }

  function parentPath(path) {
    const parts = pathParts(path);
    parts.pop();
    return parts.length ? `/${parts.join('/')}` : '';
  }

  function isInCurrentFolder(book, folder) {
    return parentPath(book.path) === folder;
  }

  function firstChildFolder(bookPath, folder) {
    const base = pathParts(folder);
    const full = pathParts(bookPath);
    const fileRemoved = full.slice(0, -1);
    if (fileRemoved.length <= base.length) return null;
    return fileRemoved[base.length] || null;
  }

  function childFolders(folder, items = books) {
    const map = new Map();
    for (const book of items) {
      const child = firstChildFolder(book.path, folder);
      if (!child) continue;
      if (!map.has(child)) map.set(child, 0);
      map.set(child, map.get(child) + 1);
    }
    return [...map.entries()]
      .map(([name,count]) => ({
        name, count,
        path: `${folder}/${name}`.replace(/\/+/g,'/')
      }))
      .sort((a,b) => naturalCompare(a.name,b.name));
  }

  function naturalCompare(a,b) {
    return String(a).localeCompare(String(b), 'ru', { numeric:true, sensitivity:'base' });
  }

  async function fetchWithTimeout(url, signal) {
    const local = new AbortController();
    let timedOut = false;
    const onAbort = () => local.abort();
    if (signal) {
      if (signal.aborted) local.abort();
      else signal.addEventListener('abort', onAbort, { once:true });
    }
    const timer = setTimeout(() => { timedOut = true; local.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { signal: local.signal });
    } catch (e) {
      if (timedOut) {
        const err = new Error('Яндекс Диск слишком долго не отвечает.');
        err.name = 'RequestTimeoutError';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async function apiGet(params, signal, suffix = '') {
    let last = null;
    for (const endpoint of API_ENDPOINTS) {
      try {
        const url = new URL(endpoint + suffix);
        for (const [k,v] of Object.entries(params)) {
          if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        }
        const r = await fetchWithTimeout(url, signal);
        if (!r.ok) {
          let detail = '';
          try {
            const p = await r.json();
            detail = p.message || p.description || p.error || '';
          } catch (_) {}
          throw new Error(`HTTP ${r.status}${detail ? ` · ${detail}` : ''}`);
        }
        return await r.json();
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        last = e;
      }
    }
    throw last || new Error('Не удалось обратиться к API Яндекс Диска.');
  }

  function joinPath(parent, name) {
    return `${String(parent || '').replace(/\/$/,'')}/${name}`.replace(/\/+/g,'/');
  }

  function normalizeChildPath(apiPath, parent, name) {
    let p = String(apiPath || '').trim();
    if (!p || /^disk:/i.test(p) || /^public:/i.test(p)) return joinPath(parent,name);
    if (!p.startsWith('/')) p = `/${p}`;
    return p.replace(/\/+/g,'/');
  }

  async function readDirectory(publicKey, task, signal) {
    const files = [], dirs = [];
    let offset = 0;
    const limit = 1000;

    do {
      const data = await apiGet({
        public_key: publicKey,
        path: task.path || undefined,
        limit,
        offset
      }, signal);

      if (data.type === 'file') {
        if (BOOK_EXTENSIONS.has(extension(data.name))) {
          files.push({
            name:data.name,
            path:task.path || `/${data.name}`,
            size:data.size || 0,
            mime:data.mime_type || '',
            modified:data.modified || ''
          });
        }
        break;
      }

      const embedded = data._embedded || {};
      const items = Array.isArray(embedded.items) ? embedded.items : [];

      for (const item of items) {
        const childPath = normalizeChildPath(item.path, task.path, item.name);
        if (item.type === 'dir') {
          if (task.depth < MAX_DEPTH) dirs.push({ path:childPath, depth:task.depth+1 });
        } else if (BOOK_EXTENSIONS.has(extension(item.name))) {
          files.push({
            name:item.name,
            path:childPath,
            size:item.size || 0,
            mime:item.mime_type || '',
            modified:item.modified || ''
          });
        }
      }

      offset += items.length;
      const total = Number(embedded.total || items.length);
      if (!items.length || offset >= total) break;
    } while (true);

    return { files, directories:dirs };
  }

  function saveCache(rawFiles) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        version:3, source, savedAt:Date.now(), files:rawFiles
      }));
    } catch (_) {}
  }

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c || c.version !== 3 || c.source !== source || !Array.isArray(c.files)) return null;
      return c;
    } catch (_) { return null; }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  function updateStatus(scanned, queued, found, failures) {
    const left = Math.max(queued - scanned, 0);
    scanStatus.textContent = `папок: ${scanned}/${scanned+left} · найдено: ${found}` +
      (failures ? ` · ошибок: ${failures}` : '');
  }

  async function scanLibrary({force=false}={}) {
    if (!source) return;
    controller?.abort();
    controller = new AbortController();
    refreshBtn.disabled = true;
    scanProgress.classList.add('busy');

    const cached = loadCache();
    if (!force && cached?.files?.length) {
      books = cached.files.map(decorateFile);
      scanStatus.textContent = `из кэша: ${books.length} ${booksWord(books.length)}`;
      renderAll();
      if (Date.now() - cached.savedAt < CACHE_MAX_AGE_MS) {
        refreshBtn.disabled = false;
        scanProgress.classList.remove('busy');
        return;
      }
    }

    const found = new Map();
    let frontier = [{path:'',depth:0}];
    let scanned=0, queued=1, failures=0;

    try {
      while (frontier.length && found.size < MAX_ITEMS && scanned < MAX_DIRECTORIES) {
        const batch = frontier.splice(0,CONCURRENCY);
        const results = await Promise.all(batch.map(async task => {
          try {
            return await readDirectory(source,task,controller.signal);
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            if (!task.path) { e.isRootFailure = true; throw e; }
            failures++;
            return {files:[],directories:[]};
          }
        }));

        scanned += batch.length;

        for (const result of results) {
          for (const f of result.files) {
            if (found.size >= MAX_ITEMS) break;
            found.set(`${f.path}\n${f.name}`,f);
          }
          for (const d of result.directories) {
            if (queued >= MAX_DIRECTORIES) break;
            frontier.push(d); queued++;
          }
        }

        books = [...found.values()].map(decorateFile);
        updateStatus(scanned,queued,books.length,failures);
        renderAll();
        await new Promise(r => setTimeout(r,0));
      }

      const raw = [...found.values()];
      books = raw.map(decorateFile);
      saveCache(raw);
      scanStatus.textContent = `готово: ${books.length} ${booksWord(books.length)}` +
        (failures ? ` · ошибок: ${failures}` : '');
      renderAll();
    } catch (e) {
      if (e.name === 'AbortError') return;
      showCatalogError(e);
    } finally {
      refreshBtn.disabled = false;
      scanProgress.classList.remove('busy');
    }
  }

  function showCatalogError(error) {
    scanStatus.textContent = 'не удалось прочитать библиотеку';
    const box = document.createElement('div');
    box.className = 'error';
    box.innerHTML = `<strong>${error.isRootFailure ? 'Не удалось прочитать корень библиотеки.' : 'Ошибка чтения библиотеки.'}</strong> ${escapeHtml(error.message)}`;
    const details = document.createElement('details');
    details.className = 'diagnostics';
    const summary = document.createElement('summary');
    summary.textContent = 'Технические сведения';
    const pre = document.createElement('pre');
    pre.textContent = `Версия: ${BUILD_VERSION}\nИсточник: ${source}\nТип ошибки: ${error.name || 'Error'}\nСообщение: ${error.message || ''}\nСтраница: ${location.href}`;
    details.append(summary,pre);
    box.append(details);
    catalog.replaceChildren(box);
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function setMode(next) {
    mode = ['folders','subjects','list'].includes(next) ? next : 'folders';
    localStorage.setItem(MODE_KEY,mode);
    updateModeButtons();
    renderCatalog();
  }

  function updateModeButtons() {
    foldersBtn.setAttribute('aria-pressed',String(mode==='folders'));
    subjectsBtn.setAttribute('aria-pressed',String(mode==='subjects'));
    listBtn.setAttribute('aria-pressed',String(mode==='list'));
  }

  function setPath(next) {
    currentPath = String(next || '').replace(/\/+$/,'');
    localStorage.setItem(PATH_KEY,currentPath);
    searchInput.value = '';
    clearSearch.hidden = true;
    renderCatalog();
  }

  function renderAll() {
    bookCount.textContent = `${books.length} ${booksWord(books.length)}`;
    renderQuickFolders();
    renderCatalog();
  }

  function topLevelFolders() {
    const map = new Map();
    for (const b of books) {
      const p = pathParts(b.path);
      if (p.length < 2) continue;
      const name = p[0];
      map.set(name,(map.get(name)||0)+1);
    }
    return [...map.entries()]
      .map(([name,count]) => ({name,count,path:`/${name}`}))
      .sort((a,b)=>naturalCompare(a.name,b.name));
  }

  function renderQuickFolders() {
    quickFolders.innerHTML = '';
    const rootBtn = quickFolderButton('Вся библиотека',books.length,'');
    quickFolders.append(rootBtn);
    for (const f of topLevelFolders().slice(0,14)) {
      quickFolders.append(quickFolderButton(f.name,f.count,f.path));
    }
  }

  function quickFolderButton(name,count,path) {
    const b = document.createElement('button');
    b.type='button'; b.className='quick-folder';
    if (currentPath === path && mode==='folders') b.classList.add('active');
    const n = document.createElement('span'); n.textContent=name;
    const c = document.createElement('small'); c.textContent=count;
    b.append(n,c);
    b.addEventListener('click',()=>{ mode='folders'; updateModeButtons(); setPath(path); });
    return b;
  }

  function renderBreadcrumbs() {
    breadcrumbs.innerHTML = '';
    if (mode !== 'folders' || normalizeText(searchInput.value)) {
      breadcrumbs.hidden = true;
      return;
    }
    breadcrumbs.hidden = false;
    const root = crumbButton('Библиотека','',!currentPath);
    breadcrumbs.append(root);
    const parts = pathParts(currentPath);
    let acc='';
    parts.forEach((part,i)=>{
      const sep=document.createElement('span'); sep.className='crumb-sep'; sep.textContent='›'; breadcrumbs.append(sep);
      acc += `/${part}`;
      breadcrumbs.append(crumbButton(part,acc,i===parts.length-1));
    });
  }

  function crumbButton(label,path,current) {
    const b=document.createElement('button');
    b.type='button'; b.className='crumb'+(current?' current':''); b.textContent=label;
    b.addEventListener('click',()=>setPath(path));
    return b;
  }

  function searchScore(book,q) {
    const terms = normalizeText(q).split(' ').filter(Boolean);
    if (!terms.length) return 0;
    const fields = [
      [normalizeText(book.title),10],
      [normalizeText(book.author),8],
      [normalizeText(book.name),6],
      [normalizeText(book.subject),4],
      [normalizeText(book.path),2]
    ];
    let score=0;
    for (const term of terms) {
      let best=0;
      for (const [text,w] of fields) {
        if (text === term) best=Math.max(best,w*4);
        else if (text.startsWith(term)) best=Math.max(best,w*2);
        else if (text.includes(term)) best=Math.max(best,w);
      }
      if (!best) return -1;
      score += best;
    }
    return score;
  }

  function renderCatalog() {
    updateModeButtons();
    renderBreadcrumbs();
    clearSearch.hidden = !searchInput.value;
    const q = searchInput.value.trim();

    if (q) {
      const results = books.map(b=>({b,score:searchScore(b,q)}))
        .filter(x=>x.score>=0)
        .sort((a,b)=>b.score-a.score || naturalCompare(a.b.title,b.b.title))
        .map(x=>x.b);
      renderSearchResults(results,q);
      return;
    }

    if (mode==='folders') renderFolderView();
    else if (mode==='subjects') renderSubjectView();
    else renderListView(sortBooks(books));
  }

  function renderSearchResults(items,q) {
    catalog.innerHTML='';
    const summary=document.createElement('div');
    summary.className='result-summary';
    summary.innerHTML=`По запросу <strong>«${escapeHtml(q)}»</strong>: ${items.length} ${booksWord(items.length)}`;
    catalog.append(summary);
    if (!items.length) return catalog.append(emptyNode('Ничего не найдено. Попробуйте часть фамилии, названия или имени файла.'));
    catalog.append(bookGrid(items.slice(0,250)));
    if (items.length>250) {
      const note=document.createElement('div'); note.className='empty';
      note.textContent=`Показаны первые 250 результатов из ${items.length}. Уточните запрос.`;
      catalog.append(note);
    }
  }

  function renderFolderView() {
    catalog.innerHTML='';
    const folders=childFolders(currentPath);
    const direct=sortBooks(books.filter(b=>isInCurrentFolder(b,currentPath)));

    if (folders.length) {
      const title=sectionTitle('Папки',folders.length);
      catalog.append(title);
      const grid=document.createElement('div'); grid.className='folder-grid';
      for (const f of folders) {
        const b=document.createElement('button'); b.type='button'; b.className='folder-card';
        b.innerHTML=`<span class="folder-icon">📁</span><span class="folder-name">${escapeHtml(f.name)}</span><span class="folder-count">${f.count} ${booksWord(f.count)}</span>`;
        b.addEventListener('click',()=>setPath(f.path));
        grid.append(b);
      }
      catalog.append(grid);
    }

    if (direct.length) {
      catalog.append(sectionTitle(currentPath ? 'Книги в этой папке' : 'Книги в корне',direct.length));
      catalog.append(bookGrid(direct));
    }

    if (!folders.length && !direct.length) catalog.append(emptyNode('В этой папке пока нет найденных книг.'));
  }

  function renderSubjectView() {
    catalog.innerHTML='';
    const groups=new Map();
    for (const b of books) {
      if (!groups.has(b.subject)) groups.set(b.subject,[]);
      groups.get(b.subject).push(b);
    }
    const preferred=['Математический анализ','Линейная алгебра и аналитическая геометрия','Физика','Химия','Программирование','Другое'];
    const entries=[...groups.entries()].sort((a,b)=>{
      const ai=preferred.indexOf(a[0]), bi=preferred.indexOf(b[0]);
      return (ai<0?99:ai)-(bi<0?99:bi) || naturalCompare(a[0],b[0]);
    });
    for (const [subject,items] of entries) {
      const block=document.createElement('section'); block.className='subject-block';
      const head=document.createElement('div'); head.className='subject-head';
      head.innerHTML=`<h2>${escapeHtml(subject)}</h2><span>${items.length} ${booksWord(items.length)}</span>`;
      block.append(head,bookGrid(sortBooks(items).slice(0,24)));
      if (items.length>24) {
        const more=document.createElement('button'); more.type='button'; more.className='subject-more';
        more.textContent=`Показать все ${items.length}`;
        more.addEventListener('click',()=>{
          searchInput.value=subject; clearSearch.hidden=false; renderCatalog(); searchInput.focus();
        });
        block.append(more);
      }
      catalog.append(block);
    }
  }

  function renderListView(items) {
    catalog.innerHTML='';
    if (!items.length) return catalog.append(emptyNode('Книги пока не найдены.'));
    const list=document.createElement('div'); list.className='list-view';
    const head=document.createElement('div'); head.className='list-head';
    head.innerHTML='<div>Название</div><div>Автор</div><div>Путь</div><div></div>';
    list.append(head);
    for (const b of items.slice(0,1000)) {
      const row=document.createElement('div'); row.className='list-row';
      const name=document.createElement('div'); name.className='list-name'; name.textContent=b.volume?`${b.title} — ${b.volume}`:b.title; name.title=b.name;
      const author=document.createElement('div'); author.className='list-author'; author.textContent=b.author||b.subject;
      const path=document.createElement('div'); path.className='list-path'; path.textContent=parentPath(b.path)||'/';
      const btn=readButton(b);
      row.append(name,author,path,btn); list.append(row);
    }
    catalog.append(list);
  }

  function sectionTitle(title,count) {
    const row=document.createElement('div'); row.className='section-title-row';
    const h=document.createElement('h2'); h.textContent=title;
    const s=document.createElement('span'); s.textContent=`${count}`;
    row.append(h,s); return row;
  }

  function bookGrid(items) {
    const grid=document.createElement('div'); grid.className='book-grid';
    for (const b of items) {
      const card=document.createElement('article'); card.className='book-card';
      const color=document.createElement('span'); color.className='book-color'; color.style.setProperty('--book-color',colorFor(b));
      const body=document.createElement('div'); body.className='book-body';
      const title=document.createElement('div'); title.className='book-title'; title.textContent=b.volume?`${b.title} — ${b.volume}`:b.title; title.title=b.name;
      const author=document.createElement('div'); author.className='book-author'; author.textContent=b.author||parentPath(b.path)||'Без автора';
      const meta=document.createElement('div'); meta.className='book-meta'; meta.textContent=[b.ext.toUpperCase(),formatSize(b.size)].filter(Boolean).join(' · ');
      body.append(title,author,meta);
      card.append(color,body,readButton(b));
      grid.append(card);
    }
    return grid;
  }

  function readButton(book) {
    const btn=document.createElement('button'); btn.type='button'; btn.className='read-btn';
    btn.textContent = book.ext === 'pdf' ? 'Читать' : 'Открыть';
    btn.addEventListener('click',()=>openBook(book));
    return btn;
  }

  function emptyNode(text) {
    const d=document.createElement('div'); d.className='empty'; d.textContent=text; return d;
  }

  function buildYandexUrl(book) {
    const base=source.split('#')[0].split('?')[0].replace(/\/$/,'');
    const parts=pathParts(book.path);
    return `${base}/${parts.map(encodeURIComponent).join('/')}`;
  }

  async function getDirectLink(book, signal) {
    const payload = await apiGet({
      public_key: source,
      path: book.path
    }, signal, '/download');
    if (!payload?.href) throw new Error('Яндекс не вернул прямую ссылку на файл.');
    return payload.href;
  }

  async function openBook(book) {
    if (book.ext !== 'pdf') {
      window.open(buildYandexUrl(book),'_blank','noopener');
      return;
    }

    readerController?.abort();
    readerController = new AbortController();

    $('readerSubject').textContent = book.subject;
    $('readerTitle').textContent = book.volume ? `${book.title} — ${book.volume}` : book.title;
    $('readerAuthor').textContent = book.author || book.name;
    openYandex.href = buildYandexUrl(book);
    openDirect.hidden = true;
    openDirect.removeAttribute('href');
    readerFrame.src = 'about:blank';
    readerFrame.hidden = true;
    readerPlaceholder.hidden = false;
    readerStatus.textContent = 'Получаем прямую ссылку на PDF…';

    readerDialog.showModal();

    try {
      const href = await getDirectLink(book, readerController.signal);
      openDirect.href = href;
      openDirect.hidden = false;
      readerStatus.textContent = 'PDF открыт напрямую. Если встроенный просмотр не появился, используйте «Открыть напрямую».';
      readerFrame.src = href;
      readerFrame.hidden = false;

      // Даём браузеру немного времени на инициализацию PDF viewer.
      setTimeout(()=>{ if (readerDialog.open) readerPlaceholder.hidden = true; },900);
    } catch (e) {
      if (e.name === 'AbortError') return;
      readerStatus.textContent = `Прямой просмотр не получился: ${e.message}`;
      readerPlaceholder.querySelector('strong').textContent='Не удалось открыть PDF напрямую';
      readerPlaceholder.querySelector('span').textContent='Можно открыть публичную страницу файла через кнопку «Яндекс Диск».';
    }
  }

  function enterLibrary(url) {
    source = normalizeSourceUrl(url);
    localStorage.setItem(STORAGE_KEY,source);
    setup.hidden=true; library.hidden=false;
    sourceName.textContent=source;
    sourceName.title=source;
    scanLibrary();
  }

  function returnToSetup(forget=false) {
    controller?.abort(); readerController?.abort();
    if (forget) {
      localStorage.removeItem(STORAGE_KEY);
      clearCache();
    }
    source=''; books=[];
    sourceInput.value=forget?'':(localStorage.getItem(STORAGE_KEY)||'');
    library.hidden=true; setup.hidden=false; setupError.hidden=true;
    sourceInput.focus();
  }

  connectForm.addEventListener('submit',e=>{
    e.preventDefault();
    const value=normalizeSourceUrl(sourceInput.value);
    if (!isYandexPublicUrl(value)) {
      setupError.textContent='Вставьте публичную ссылку Яндекс Диска вида disk.yandex.ru/d/…';
      setupError.hidden=false; return;
    }
    setupError.hidden=true;
    if (localStorage.getItem(STORAGE_KEY)!==value) clearCache();
    enterLibrary(value);
  });

  searchInput.addEventListener('input',renderCatalog);
  clearSearch.addEventListener('click',()=>{searchInput.value='';clearSearch.hidden=true;renderCatalog();searchInput.focus()});
  foldersBtn.addEventListener('click',()=>setMode('folders'));
  subjectsBtn.addEventListener('click',()=>setMode('subjects'));
  listBtn.addEventListener('click',()=>setMode('list'));
  refreshBtn.addEventListener('click',()=>{clearCache();scanLibrary({force:true})});
  changeBtn.addEventListener('click',()=>{
    const forget=confirm('Удалить сохранённую ссылку на библиотеку с этого устройства?\n\n«ОК» — удалить. «Отмена» — оставить ссылку и просто вернуться к экрану подключения.');
    returnToSetup(forget);
  });

  $('closeReader').addEventListener('click',()=>{
    readerController?.abort();
    readerFrame.src='about:blank';
    readerDialog.close();
  });
  readerDialog.addEventListener('close',()=>{readerController?.abort();readerFrame.src='about:blank'});

  (async function init(){
    metadata=await loadMetadata();
    updateModeButtons();
    const saved=localStorage.getItem(STORAGE_KEY);
    if (saved && isYandexPublicUrl(saved)) {
      sourceInput.value=saved; enterLibrary(saved);
    } else {
      setup.hidden=false; library.hidden=true;
    }
  })();
})();
