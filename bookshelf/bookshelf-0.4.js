(() => {
  'use strict';

  const BUILD_VERSION = '0.4';

  const STORAGE_KEY = 'mipt.bookshelf.source.v1';
  const VIEW_KEY = 'mipt.bookshelf.view.v1';
  const CACHE_KEY = 'mipt.bookshelf.cache.v2';

  const API_ENDPOINTS = [
    'https://cloud-api.yandex.net/v1/disk/public/resources',
    'https://cloud-api.yandex.ru/v1/disk/public/resources'
  ];
  const BOOK_EXTENSIONS = new Set(['pdf', 'djvu', 'epub']);

  // Большая библиотека может содержать сотни папок. Сканируем несколько
  // директорий параллельно, но не слишком агрессивно, чтобы не упираться
  // в ограничения API Яндекс Диска.
  const CONCURRENCY = 5;
  const REQUEST_TIMEOUT_MS = 18000;
  const MAX_ITEMS = 5000;
  const MAX_DIRECTORIES = 2500;
  const MAX_DEPTH = 18;
  const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

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
        if (alias.length >= 4 && haystack.includes(alias)) {
          score = Math.max(score, alias.length);
        }
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
    return String(name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function joinPath(parent, name) {
    const cleanParent = String(parent || '')
      .replace(/^public:/, '')
      .replace(/^disk:/, '')
      .replace(/\/$/, '');

    return `${cleanParent}/${name}`.replace(/\/+/g, '/');
  }

  function normalizeChildPath(apiPath, parent, name) {
    const fallback = joinPath(parent, name);
    let value = String(apiPath || '').trim();

    // Для public API нужен путь относительно опубликованной папки.
    if (!value || /^disk:/i.test(value) || /^public:/i.test(value)) return fallback;
    if (!value.startsWith('/')) value = `/${value}`;
    return value.replace(/\/+/g, '/');
  }

  async function fetchWithTimeout(url, externalSignal) {
    const localController = new AbortController();
    let timedOut = false;

    const onAbort = () => localController.abort();
    if (externalSignal) {
      if (externalSignal.aborted) localController.abort();
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      localController.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        signal: localController.signal,
        headers: { Accept: 'application/json' }
      });
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error('Яндекс Диск слишком долго не отвечает.');
        timeoutError.name = 'RequestTimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }

  async function apiGet(params, signal) {
    let lastError = null;

    for (const endpoint of API_ENDPOINTS) {
      try {
        const url = new URL(endpoint);

        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
          }
        }

        // Не добавляем пользовательские заголовки: запрос остаётся максимально
        // простым для браузера и меньше зависит от CORS-настроек провайдера.
        const response = await fetchWithTimeout(url, signal);

        if (!response.ok) {
          let detail = '';
          let code = '';
          try {
            const payload = await response.json();
            detail = payload.message || payload.description || '';
            code = payload.error || '';
          } catch (_) {}

          const e = new Error(
            `HTTP ${response.status}${code ? ` · ${code}` : ''}${detail ? ` · ${detail}` : ''}`
          );
          e.httpStatus = response.status;
          e.endpoint = endpoint;
          throw e;
        }

        return await response.json();
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        lastError = error;
      }
    }

    throw lastError || new Error('Не удалось обратиться к API Яндекс Диска.');
  }

  async function readDirectory(publicKey, task, signal) {
    const files = [];
    const directories = [];
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
            name: data.name,
            path: task.path || `/${data.name}`,
            size: data.size || 0,
            mime: data.mime_type || '',
            modified: data.modified || ''
          });
        }
        break;
      }

      const embedded = data._embedded || {};
      const items = Array.isArray(embedded.items) ? embedded.items : [];

      for (const item of items) {
        const childPath = normalizeChildPath(item.path, task.path, item.name);

        if (item.type === 'dir') {
          if (task.depth < MAX_DEPTH) {
            directories.push({ path: childPath, depth: task.depth + 1 });
          }
          continue;
        }

        if (BOOK_EXTENSIONS.has(extension(item.name))) {
          files.push({
            name: item.name,
            path: childPath,
            size: item.size || 0,
            mime: item.mime_type || '',
            modified: item.modified || ''
          });
        }
      }

      offset += items.length;
      const total = Number(embedded.total || items.length);
      if (!items.length || offset >= total) break;
    } while (true);

    return { files, directories };
  }

  function sortBooks(items) {
    return items.slice().sort((a, b) =>
      a.subject.localeCompare(b.subject, 'ru') ||
      a.author.localeCompare(b.author, 'ru') ||
      a.title.localeCompare(b.title, 'ru')
    );
  }

  function cacheRawFiles(rawFiles) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        version: 2,
        source,
        savedAt: Date.now(),
        files: rawFiles
      }));
    } catch (_) {
      // Кэш — только ускорение. Если localStorage заполнен, библиотека всё
      // равно должна продолжить работать.
    }
  }

  function loadCachedFiles(currentSource) {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!parsed || parsed.version !== 2 || parsed.source !== currentSource || !Array.isArray(parsed.files)) {
        return null;
      }
      return {
        files: parsed.files,
        savedAt: Number(parsed.savedAt || 0)
      };
    } catch (_) {
      return null;
    }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  function updateScanStatus(scanned, queued, found, failures = 0) {
    const left = Math.max(queued - scanned, 0);
    scanStatus.textContent =
      `Папок просмотрено: ${scanned} · в очереди: ${left} · книг найдено: ${found}` +
      (failures ? ` · пропущено из-за ошибок: ${failures}` : '');
  }

  async function scanLibrary({ force = false } = {}) {
    if (!source) return;

    controller?.abort();
    controller = new AbortController();

    refreshBtn.disabled = true;
    scanProgress.classList.add('busy');
    catalog.innerHTML = '';

    const cached = loadCachedFiles(source);
    const cacheAge = cached ? Date.now() - cached.savedAt : Infinity;

    if (!force && cached?.files?.length) {
      books = sortBooks(cached.files.map(decorateFile));
      scanStatus.textContent = `Загружено из кэша: ${books.length} ${booksWord(books.length)}`;
      render();

      if (cacheAge < CACHE_MAX_AGE_MS) {
        refreshBtn.disabled = false;
        scanProgress.classList.remove('busy');
        return;
      }
    }

    const foundMap = new Map();
    let frontier = [{ path: '', depth: 0 }];
    let scannedDirectories = 0;
    let queuedDirectories = 1;
    let failures = 0;
    let hitDirectoryLimit = false;

    scanStatus.textContent = `0.4 · подключаемся к Яндекс Диску…`;

    try {
      while (frontier.length && foundMap.size < MAX_ITEMS && scannedDirectories < MAX_DIRECTORIES) {
        const batch = frontier.splice(0, CONCURRENCY);

        const results = await Promise.all(batch.map(async task => {
          try {
            return await readDirectory(source, task, controller.signal);
          } catch (error) {
            if (error.name === 'AbortError') throw error;

            // Если не читается корень публичной папки, дальше сканировать нечего.
            // Показываем настоящую ошибку, а не вводящее в заблуждение
            // "некоторые папки прочитать не удалось".
            if (!task.path) {
              error.isRootFailure = true;
              throw error;
            }

            failures += 1;
            return { files: [], directories: [], error };
          }
        }));

        scannedDirectories += batch.length;

        for (const result of results) {
          for (const file of result.files) {
            if (foundMap.size >= MAX_ITEMS) break;
            const key = `${file.path}\n${file.name}`;
            foundMap.set(key, file);
          }

          for (const dir of result.directories) {
            if (queuedDirectories >= MAX_DIRECTORIES) {
              hitDirectoryLimit = true;
              break;
            }
            frontier.push(dir);
            queuedDirectories += 1;
          }
        }

        // Показываем книги сразу, а не ждём завершения обхода всей огромной папки.
        const rawFiles = [...foundMap.values()];
        books = sortBooks(rawFiles.map(decorateFile));
        updateScanStatus(scannedDirectories, queuedDirectories, books.length, failures);
        render();

        // Отдаём управление браузеру: интерфейс не должен "замирать"
        // даже на большой библиотеке.
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      const rawFiles = [...foundMap.values()];
      books = sortBooks(rawFiles.map(decorateFile));
      cacheRawFiles(rawFiles);
      render();

      if (foundMap.size >= MAX_ITEMS) {
        scanStatus.textContent = `Найдено ${foundMap.size} книг — достигнут лимит каталога.`;
      } else if (hitDirectoryLimit || scannedDirectories >= MAX_DIRECTORIES) {
        scanStatus.textContent = `Найдено ${foundMap.size} книг. Достигнут лимит обхода папок (${MAX_DIRECTORIES}).`;
      } else if (failures) {
        scanStatus.textContent = `Готово: ${foundMap.size} ${booksWord(foundMap.size)}. Некоторые папки (${failures}) Яндекс Диск прочитать не дал.`;
      } else {
        scanStatus.textContent = `Готово: ${foundMap.size} ${booksWord(foundMap.size)}.`;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;

      scanStatus.textContent = 'Не удалось прочитать библиотеку';
      if (!books.length) catalog.innerHTML = '';

      const box = document.createElement('div');
      box.className = 'error';

      if (error instanceof TypeError) {
        box.innerHTML =
          '<strong>Корень публичной папки не удалось прочитать из браузера.</strong> ' +
          'Это похоже на сетевое/CORS-ограничение между GitHub Pages и API Яндекс Диска, ' +
          'а не на отсутствие книг. Ссылка сохранена только в этом браузере.';
      } else {
        const rootPrefix = error.isRootFailure
          ? '<strong>Яндекс Диск не дал прочитать корень этой публичной папки.</strong> '
          : '';
        box.innerHTML = rootPrefix + escapeHtml(error.message) +
          ' Ссылка сохранена только в этом браузере; её можно не вводить заново.';
      }

      const details = document.createElement('details');
      details.className = 'diagnostics';
      const summary = document.createElement('summary');
      summary.textContent = 'Технические сведения';
      const pre = document.createElement('pre');
      const apiProbe = new URL(API_ENDPOINTS[0]);
      apiProbe.searchParams.set('public_key', source);
      apiProbe.searchParams.set('limit', '5');

      pre.textContent = [
        `Версия: ${BUILD_VERSION}`,
        `Источник: ${source}`,
        `Тип ошибки: ${error.name || 'Error'}`,
        `Сообщение: ${error.message || 'нет сообщения'}`,
        `Страница: ${location.href}`,
        `Онлайн: ${navigator.onLine ? 'да' : 'нет'}`,
        `Проверочный API-запрос: ${apiProbe.toString()}`
      ].join('\n');
      details.append(summary, pre);
      box.append(details);

      catalog.prepend(box);
    } finally {
      refreshBtn.disabled = false;
      scanProgress.classList.remove('busy');
    }
  }

  function colorFor(book) {
    const sourceText = `${book.metadataId || ''}${book.title}${book.author}`;
    let hash = 0;
    for (let i = 0; i < sourceText.length; i++) {
      hash = ((hash << 5) - hash + sourceText.charCodeAt(i)) | 0;
    }
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
    const parts = String(book.path || '')
      .replace(/^\/+/, '')
      .split('/')
      .filter(Boolean);

    // Для публичных папок Яндекс Диска вложенный ресурс открывается через
    // тот же share URL с добавленным путём.
    return `${base}/${parts.map(encodeURIComponent).join('/')}`;
  }

  function matchesSearch(book, query) {
    if (!query) return true;

    const text = normalizeText(
      `${book.title} ${book.author} ${book.volume} ${book.subject} ${book.kind} ${book.name} ${book.path}`
    );

    return query
      .split(' ')
      .filter(Boolean)
      .every(part => text.includes(part));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
      empty.textContent = books.length
        ? 'По этому запросу ничего не найдено.'
        : 'Пока книги не найдены. Если идёт сканирование, первые результаты появятся здесь автоматически.';
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

    const preferred = [
      'Математический анализ',
      'Линейная алгебра и аналитическая геометрия',
      'Физика',
      'Химия',
      'Программирование',
      'Другое'
    ];

    const ordered = [...groups.entries()].sort((a, b) => {
      const ai = preferred.indexOf(a[0]);
      const bi = preferred.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a[0].localeCompare(b[0], 'ru');
    });

    for (const [subject, subjectBooks] of ordered) {
      const section = document.createElement('section');
      section.className = 'subject';

      const head = document.createElement('div');
      head.className = 'subject-head';

      const h2 = document.createElement('h2');
      h2.textContent = subject;

      const count = document.createElement('span');
      count.textContent = `${subjectBooks.length} ${booksWord(subjectBooks.length)}`;

      head.append(h2, count);

      const row = document.createElement('div');
      row.className = 'books-row';

      for (const book of subjectBooks) row.append(createBookSpine(book));

      const board = document.createElement('div');
      board.className = 'shelf-board';

      section.append(head, row, board);
      catalog.append(section);
    }
  }

  function createBookSpine(book) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'book';
    button.style.setProperty('--book-color', colorFor(book));
    button.title = [book.title, book.author, book.volume].filter(Boolean).join(' — ');
    button.setAttribute('aria-label', `Открыть сведения о книге «${book.title}»`);

    const spine = document.createElement('span');
    spine.className = 'book-spine';

    const title = document.createElement('strong');
    title.textContent = book.volume ? `${book.title} · ${book.volume}` : book.title;

    const author = document.createElement('small');
    author.textContent = book.author || prettyFilename(book.name);

    spine.append(title, author);

    const mark = document.createElement('span');
    mark.className = 'book-mark';
    mark.setAttribute('aria-hidden', 'true');

    button.append(spine, mark);
    button.addEventListener('click', () => openDetails(book));
    return button;
  }

  function renderList(items) {
    const list = document.createElement('div');
    list.className = 'list-view';

    for (const book of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'list-item';

      const title = document.createElement('div');
      title.className = 'list-title';
      title.textContent = book.volume ? `${book.title} — ${book.volume}` : book.title;

      const author = document.createElement('div');
      author.className = 'list-author';
      author.textContent = book.author || 'Автор не указан';

      const kind = document.createElement('div');
      kind.className = 'list-kind';
      kind.textContent = book.subject;

      const path = document.createElement('div');
      path.className = 'list-path';
      path.textContent = book.path;

      button.append(title, author, kind, path);
      button.addEventListener('click', () => openDetails(book));
      list.append(button);
    }

    catalog.append(list);
  }

  function openDetails(book) {
    selectedBook = book;

    document.getElementById('dialogCover').style.setProperty('--book-color', colorFor(book));
    document.getElementById('coverAuthor').textContent = book.author || book.subject;
    document.getElementById('coverTitle').textContent = book.title;
    document.getElementById('coverVolume').textContent = book.volume || book.kind;

    document.getElementById('detailSubject').textContent = book.subject;
    document.getElementById('detailTitle').textContent =
      book.volume ? `${book.title} — ${book.volume}` : book.title;
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
    source = normalizeSourceUrl(url);
    localStorage.setItem(STORAGE_KEY, source);

    setup.hidden = true;
    library.hidden = false;

    sourceName.textContent = source;
    sourceName.title = source;

    scanLibrary();
  }

  function returnToSetup(forget = false) {
    controller?.abort();

    if (forget) {
      localStorage.removeItem(STORAGE_KEY);
      clearCache();
    }

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
      setupError.textContent =
        'Вставьте публичную ссылку Яндекс Диска вида disk.yandex.ru/d/… или disk.yandex.ru/i/…';
      setupError.hidden = false;
      return;
    }

    setupError.hidden = true;

    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous && previous !== value) clearCache();

    enterLibrary(value);
  });

  searchInput.addEventListener('input', render);
  shelfBtn.addEventListener('click', () => setView('shelf'));
  listBtn.addEventListener('click', () => setView('list'));
  refreshBtn.addEventListener('click', () => {
    clearCache();
    scanLibrary({ force: true });
  });

  changeBtn.addEventListener('click', () => {
    const forget = confirm(
      'Удалить сохранённую ссылку на библиотеку с этого устройства?\n\n' +
      '«ОК» — удалить ссылку и кэш каталога. «Отмена» — оставить их и вернуться к экрану подключения.'
    );
    returnToSetup(forget);
  });

  document.getElementById('closeDialog').addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      dialog.close();
    }
  });

  document.getElementById('copyName').addEventListener('click', async event => {
    if (!selectedBook) return;

    const button = event.currentTarget;

    try {
      await navigator.clipboard.writeText(selectedBook.name);
      const old = button.textContent;
      button.textContent = 'Скопировано';
      setTimeout(() => { button.textContent = old; }, 1200);
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
