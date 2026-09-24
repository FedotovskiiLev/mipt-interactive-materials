/* The catalog remains usable when JavaScript is disabled. */
(() => {
  const search = document.querySelector('#material-search');
  if (!search) return;
  const cards = [...document.querySelectorAll('[data-material]')];
  const filters = [...document.querySelectorAll('[data-filter]')];
  let subject = 'all';
  const normalize = value => value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  function update() {
    const words = normalize(search.value).split(/\s+/).filter(Boolean);
    let count = 0;
    cards.forEach(card => {
      const matches = (subject === 'all' || card.dataset.subject === subject)
        && words.every(word => normalize(card.textContent + ' ' + card.dataset.material).includes(word));
      card.hidden = !matches;
      if (matches) count++;
    });
    document.querySelector('#catalog-count').textContent = `Показано: ${count} из ${cards.length}`;
    document.querySelector('#catalog-empty').hidden = count !== 0;
  }
  filters.forEach(button => button.addEventListener('click', () => {
    subject = button.dataset.filter;
    filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    update();
  }));
  search.addEventListener('input', update);
  document.querySelector('#reset-search').addEventListener('click', () => {
    search.value = '';
    subject = 'all';
    filters.forEach(item => item.setAttribute('aria-pressed', String(item.dataset.filter === 'all')));
    update();
    search.focus();
  });
  document.querySelector('.catalog-tools-home').hidden = false;
})();
