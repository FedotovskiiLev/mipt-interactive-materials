(() => {
  'use strict';

  const STORAGE_KEY = 'mipt.bookshelf.source.v1';
  const VIEW_KEY = 'mipt.bookshelf.view.v1';
  const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
  const MAX_ITEMS = 5000;
  const MAX_DEPTH = 14;
  const BOOK_EXTENSIONS = new Set(['pdf', 'djvu', 'epub']);

  const setup = document.getElementById('setup');
  const library = document.getElementById('library');
  const connectForm = document.getElementById('connectForm');
  const sourceInput = document.getElementById('sourceInput');
  const setupError = document.getElementById('setupError');
  const searchInput = document.getElementById('searchInput');
  const shelfBtn = document.getElementById('shelfBtn');
  const listBtn = document.getElementById('listBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const changeBtn = document.getElementById('changeBtn');
  const catalog = document.getElementById('catalog');
  const bookCount = document.getElementById('bookCount');
  const sourceName = document.getElementById('sourceName');
  const scanStatus = document.getElementById('scanStatus');
  const scanProgress = document.getElementById('scanProgress');
  const dialog = document.getElementById('bookDialog');

  let source = '';
  let books = [];
  let metadata = [];
  let view = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'shelf';
  let controller = null;
  let selectedBook = null;

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

  function isYandexPublicUrl(value) {
    try {
      const url = new URL(value);
      const allowed = ['disk.yandex.ru', 'disk.360.yandex.ru', 'yadi.sk'];
      return allowed.includes(url.hostname) && /\/(d|i)\//.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  async function loadMetadata() {
    try {
      const response = await fetch('metadata.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('metadata unavailable');
      const data = await response.json();
      return Array.isArray(data.books) ? data.books : [];
    } catch (_) {
      return [];
    }
  }

  function matchMetadata(name, path) {
    const haystack = normalizeText(`${name} ${path}`);
    let best = null;
    let bestScore = 0;
    for (const item of metadata) {
      const aliases = [...(item.aliases || []), item.title || '', item.author || '']
        .map(normalizeText)
        .filter(Boolean);
      let score = 0;
      for (const alias of aliases) {
        if (alias.length >= 4 && haystack.includes(alias)) score = Math.max(score, alias.length);
      }
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  function inferSubject(path, meta) {
    if (meta?.subject) return meta.subject;
    const p = normalizeText(path);
    const rules = [
      ['Математический анализ', ['матан', 'мат анализ', 'математический анализ', 'calculus', 'analysis', 'дифференц', 'интеграл']],
      ['Линейная алгебра и аналитическая геометрия', ['линал', 'линейная алгебра', 'ангем', 'аналитическая геометрия', 'linear algebra', 'geometry']],
      ['Физика', ['физика', 'physics', 'механика', 'электричество', 'термодинамика', 'оптика']],
      ['Химия', ['химия', 'chemistry']],
      ['Программирование', ['программирование', 'programming', 'python', 'c++', 'алгоритм']]
    ];
    for (const [subject, words] of rules) {
      if (words.some(word => p.includes(normalizeText(word)))) return subject;
    }
    return 'Другое';
  }

  function prettyFilename(name) {
    return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
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
      metadataId: meta?.id || null
    };
  }

  function extension(name) {
    const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function joinPath(parent, name) {
    const cleanParent = String(parent || '').replace(/^public:/, '').replace(/\/$/, '');
    return `${cleanParent}/${name}`.replace(/\/+/g, '/');
  }

  async function apiGet(params, signal) {
    const url = new URL(API);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) {}
      throw new Error(`Яндекс Диск вернул ошибку ${response.status}.`);
    }
    return response.json();
  }

  async function listDirectory(publicKey, path, depth, signal, found) {
    if (depth > MAX_DEPTH || found.length >= MAX_ITEMS) return;
    let offset = 0;
    const limit = 1000;
    do {
      const data = await apiGet({ public_key: publicKey, path: path || undefined, limit, offset }, signal);
      if (data.type === 'file') {
        if (BOOK_EXTENSIONS.has(extension(data.name))) {
          found.push({ name: data.name, path: path || `/${data.name}`, size: data.size || 0, mime: data.mime_type || '', modified: data.modified || '' });
        }
        return;
      }
      const embedded = data._embedded || {};
      const items = Array.isArray(embedded.items) ? embedded.items : [];
      for (const item of items) {
        if (found.length >= MAX_ITEMS) break;
        const childPath = joinPath(path, item.name);
        if (item.type === 'dir') {
          await listDirectory(publicKey, childPath, depth + 1, signal, found);
        } else if (BOOK_EXTENSIONS.has(extension(item.name))) {
          found.push({ name: item.name, path: childPath, size: item.size || 0, mime: item.mime_type || '', modified: item.modified || '' });
        }
      }
      offset += items.length;
      const total = Number(embedded.total || items.length);
      if (!items.length || offset >= total) break;
    } while (found.length < MAX_ITEMS);
  }

  async function scanLibrary() {
    if (!source) return;
    controller?.abort();
    controller = new AbortController();
    refreshBtn.disabled = true;
    scanProgress.classList.add('busy');
    scanStatus.textContent = 'Читаем публичную папку…';
    catalog.innerHTML = '';
    try {
      const found = [];
      await listDirectory(source, '', 0, controller.signal, found);
      books = found.map(decorateFile).sort((a, b) => a.subject.localeCompare(b.subject) || a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
      scanStatus.textContent = books.length >= MAX_ITEMS ? `Остановлено после ${MAX_ITEMS} файлов` : 'Обновлено';
      render();
    } catch (error) {
      if (error.name === 'AbortError') return;
      scanStatus.textContent = 'Не удалось прочитать библиотеку';
      catalog.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'error';
      box.textContent = `${error.message} Ссылка по-прежнему сохранена только в этом браузере: можно повторить попытку или сменить источник.`;
      catalog.append(box);
    } finally {
      refreshBtn.disabled = false;
      scanProgress.classList.remove('busy');
    }
  }

  function colorFor(book) {
    const sourceText = `${book.metadataId || ''}${book.title}${book.author}`;
    let hash = 0;
    for (let i = 0; i < sourceText.length; i++) hash = ((hash << 5) - hash + sourceText.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 28% 38%)`;
  }

  function formatSize(bytes) {
    const n = Number(bytes || 0);
    if (!n) return 'Размер неизвестен';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
  }

  function booksWord(n) {
    const value = Math.abs(Number(n)) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return 'книг';
    if (last === 1) return 'книга';
    if (last >= 2 && last <= 4) return 'книги';
    return 'книг';
  }

  function buildViewerUrl(book) {
    const base = source.split('#')[0].split('?')[0].replace(/\/$/, '');
    const parts = String(book.path || '').replace(/^\/+/, '').split('/').filter(Boolean);
    return `${base}/${parts.map(encodeURIComponent).join('/')}`;
  }

  function matchesSearch(book, query) {
    if (!query) return true;
    const text = normalizeText(`${book.title} ${book.author} ${book.volume} ${book.subject} ${book.kind} ${book.name} ${book.path}`);
    return query.split(' ').filter(Boolean).every(part => text.includes(part));
  }

  function render() {
    const query = normalizeText(searchInput.value);
    const filtered = books.filter(book => matchesSearch(book, query));
    bookCount.textContent = `${filtered.length} ${booksWord(filtered.length)}`;
    catalog.innerHTML = '';
    setViewButtons();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = books.length ? 'По этому запросу ничего не найдено.' : 'В публичной папке не найдено книг в форматах PDF, DJVU или EPUB.';
      catalog.append(empty);
      return;
    }
    if (view === 'list') renderList(filtered);
    else renderShelves(filtered);
  }

  function renderShelves(items) {
    const groups = new Map();
    for (const book of items) {
      if (!groups.has(book.subject)) groups.set(book.subject, []);
      groups.get(book.subject).push(book);
    }
    const preferred = ['Математический анализ', 'Линейная алгебра и аналитическая геометрия', 'Физика', 'Химия', 'Программирование', 'Другое'];
    const ordered = [...groups.entries()].sort((a, b) => {
      const ai = preferred.indexOf(a[0]); const bi = preferred.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a[0].localeCompare(b[0]);
    });
    for (const [subject, subjectBooks] of ordered) {
      const section = document.createElement('section');
      section.className = 'subject';
      const head = document.createElement('div'); head.className = 'subject-head';
      const h2 = document.createElement('h2'); h2.textContent = subject;
      const count = document.createElement('span'); count.textContent = `${subjectBooks.length} ${booksWord(subjectBooks.length)}`;
      head.append(h2, count);
      const row = document.createElement('div'); row.className = 'books-row';
      for (const book of subjectBooks) row.append(createBookSpine(book));
      const board = document.createElement('div'); board.className = 'shelf-board';
      section.append(head, row, board);
      catalog.append(section);
    }
  }

  function createBookSpine(book) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'book';
    button.style.setProperty('--book-color', colorFor(book));
    button.title = [book.title, book.author, book.volume].filter(Boolean).join(' — ');
    button.setAttribute('aria-label', `Открыть сведения о книге «${book.title}»`);
    const spine = document.createElement('span'); spine.className = 'book-spine';
    const title = document.createElement('strong'); title.textContent = book.volume ? `${book.title} · ${book.volume}` : book.title;
    const author = document.createElement('small'); author.textContent = book.author || prettyFilename(book.name);
    spine.append(title, author);
    const mark = document.createElement('span'); mark.className = 'book-mark'; mark.setAttribute('aria-hidden', 'true');
    button.append(spine, mark);
    button.addEventListener('click', () => openDetails(book));
    return button;
  }

  function renderList(items) {
    const list = document.createElement('div'); list.className = 'list-view';
    for (const book of items) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'list-item';
      const title = document.createElement('div'); title.className = 'list-title'; title.textContent = book.volume ? `${book.title} — ${book.volume}` : book.title;
      const author = document.createElement('div'); author.className = 'list-author'; author.textContent = book.author || 'Автор не указан';
      const kind = document.createElement('div'); kind.className = 'list-kind'; kind.textContent = book.subject;
      const path = document.createElement('div'); path.className = 'list-path'; path.textContent = book.path;
      button.append(title, author, kind, path);
      button.addEventListener('click', () => openDetails(book));
      list.append(button);
    }
    catalog.append(list);
  }

  function openDetails(book) {
    selectedBook = book;
    const color = colorFor(book);
    document.getElementById('dialogCover').style.setProperty('--book-color', color);
    document.getElementById('coverAuthor').textContent = book.author || book.subject;
    document.getElementById('coverTitle').textContent = book.title;
    document.getElementById('coverVolume').textContent = book.volume || book.kind;
    document.getElementById('detailSubject').textContent = book.subject;
    document.getElementById('detailTitle').textContent = book.volume ? `${book.title} — ${book.volume}` : book.title;
    document.getElementById('detailAuthor').textContent = book.author || 'Автор не определён';
    document.getElementById('detailKind').textContent = book.kind;
    document.getElementById('detailSize').textContent = formatSize(book.size);
    document.getElementById('detailPath').textContent = book.path;
    document.getElementById('openBook').href = buildViewerUrl(book);
    dialog.showModal();
  }

  function setView(next) {
    view = next;
    localStorage.setItem(VIEW_KEY, next);
    render();
  }

  function setViewButtons() {
    shelfBtn.setAttribute('aria-pressed', String(view === 'shelf'));
    listBtn.setAttribute('aria-pressed', String(view === 'list'));
  }

  function enterLibrary(url) {
    source = url.trim();
    localStorage.setItem(STORAGE_KEY, source);
    setup.hidden = true;
    library.hidden = false;
    sourceName.textContent = source;
    sourceName.title = source;
    scanLibrary();
  }

  function returnToSetup(forget = false) {
    controller?.abort();
    if (forget) localStorage.removeItem(STORAGE_KEY);
    source = '';
    books = [];
    sourceInput.value = forget ? '' : (localStorage.getItem(STORAGE_KEY) || '');
    library.hidden = true;
    setup.hidden = false;
    setupError.hidden = true;
    sourceInput.focus();
  }

  connectForm.addEventListener('submit', event => {
    event.preventDefault();
    const value = sourceInput.value.trim();
    if (!isYandexPublicUrl(value)) {
      setupError.textContent = 'Вставьте публичную ссылку Яндекс Диска вида disk.yandex.ru/d/… или disk.yandex.ru/i/…';
      setupError.hidden = false;
      return;
    }
    setupError.hidden = true;
    enterLibrary(value);
  });

  searchInput.addEventListener('input', render);
  shelfBtn.addEventListener('click', () => setView('shelf'));
  listBtn.addEventListener('click', () => setView('list'));
  refreshBtn.addEventListener('click', scanLibrary);
  changeBtn.addEventListener('click', () => {
    const forget = confirm('Удалить сохранённую ссылку на библиотеку с этого устройства?\n\n«ОК» — удалить ссылку. «Отмена» — сохранить её и вернуться к экрану подключения.');
    returnToSetup(forget);
  });
  document.getElementById('closeDialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  document.getElementById('copyName').addEventListener('click', async event => {
    if (!selectedBook) return;
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(selectedBook.name);
      const old = button.textContent; button.textContent = 'Скопировано'; setTimeout(() => { button.textContent = old; }, 1200);
    } catch (_) {
      button.textContent = selectedBook.name;
    }
  });

  (async function init() {
    metadata = await loadMetadata();
    setViewButtons();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isYandexPublicUrl(saved)) {
      sourceInput.value = saved;
      enterLibrary(saved);
    } else {
      setup.hidden = false;
      library.hidden = true;
    }
  })();
})();
