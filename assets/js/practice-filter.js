/*
 * Practice — client-side filter for the problem index.
 * Reads metadata from data-* attributes on each card and filters in-place.
 * No network calls. Filter state is reflected to the URL hash so links
 * to a filtered view are shareable (e.g. #cat=System+Design&diff=Hard).
 */
(() => {
  const grid = document.getElementById('pr-grid');
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll('.pr-card'));
  const searchInput = document.getElementById('pr-search-input');
  const clearBtn = document.getElementById('pr-clear');
  const resetBtn = document.getElementById('pr-reset');
  const empty = document.getElementById('pr-empty');
  const countEl = document.getElementById('pr-count');
  const activeFiltersEl = document.getElementById('pr-active-filters');
  const diffChips = Array.from(document.querySelectorAll('[data-filter-difficulty]'));
  const catChips = Array.from(document.querySelectorAll('[data-filter-category]'));
  const total = cards.length;

  const state = {
    search: '',
    difficulties: new Set(),
    categories: new Set(),
  };

  // ---------- URL hash sync ----------
  function readHash() {
    const h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    const params = new URLSearchParams(h);
    if (params.get('q')) {
      state.search = params.get('q');
      searchInput.value = state.search;
    }
    (params.getAll('diff') || []).forEach(d => state.difficulties.add(d));
    (params.getAll('cat') || []).forEach(c => state.categories.add(c));
    diffChips.forEach(c => {
      if (state.difficulties.has(c.dataset.filterDifficulty)) c.classList.add('is-active');
    });
    catChips.forEach(c => {
      if (state.categories.has(c.dataset.filterCategory)) c.classList.add('is-active');
    });
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.search) params.set('q', state.search);
    state.difficulties.forEach(d => params.append('diff', d));
    state.categories.forEach(c => params.append('cat', c));
    const s = params.toString();
    const newHash = s ? '#' + s : '';
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', window.location.pathname + window.location.search + newHash);
    }
  }

  // ---------- Filtering ----------
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    let visible = 0;

    cards.forEach(card => {
      const title = card.dataset.title || '';
      const cat = card.dataset.category || '';
      const diff = card.dataset.difficulty || '';
      const topics = card.dataset.topics || '';

      const matchesSearch = !q || title.includes(q) || topics.includes(q);
      const matchesDiff = state.difficulties.size === 0 || state.difficulties.has(diff);
      const matchesCat = state.categories.size === 0 || state.categories.has(cat);

      const show = matchesSearch && matchesDiff && matchesCat;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    countEl.textContent = visible;
    empty.hidden = visible !== 0;
    grid.hidden = visible === 0;

    const anyFilter = state.search || state.difficulties.size || state.categories.size;
    resetBtn.hidden = !anyFilter;
    clearBtn.hidden = !state.search;

    // Active-filters summary text
    const parts = [];
    if (state.difficulties.size) parts.push([...state.difficulties].join(' · '));
    if (state.categories.size) parts.push([...state.categories].join(' · '));
    if (state.search) parts.push(`"${state.search}"`);
    activeFiltersEl.textContent = parts.length ? '· ' + parts.join(' · ') : '';

    writeHash();
  }

  // ---------- Event wiring ----------
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  searchInput.addEventListener('input', debounce(e => {
    state.search = e.target.value;
    applyFilters();
  }, 80));

  clearBtn.addEventListener('click', () => {
    state.search = '';
    searchInput.value = '';
    searchInput.focus();
    applyFilters();
  });

  function toggleChip(chip, set, key) {
    const v = chip.dataset[key];
    if (set.has(v)) {
      set.delete(v);
      chip.classList.remove('is-active');
    } else {
      set.add(v);
      chip.classList.add('is-active');
    }
    applyFilters();
  }
  diffChips.forEach(c => c.addEventListener('click', () => toggleChip(c, state.difficulties, 'filterDifficulty')));
  catChips.forEach(c => c.addEventListener('click', () => toggleChip(c, state.categories, 'filterCategory')));

  function resetAll() {
    state.search = '';
    state.difficulties.clear();
    state.categories.clear();
    searchInput.value = '';
    diffChips.forEach(c => c.classList.remove('is-active'));
    catChips.forEach(c => c.classList.remove('is-active'));
    applyFilters();
  }
  resetBtn.addEventListener('click', resetAll);
  empty.querySelector('[data-reset]')?.addEventListener('click', resetAll);

  // Keyboard: "/" focuses search (skip when typing in another field)
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // Init
  readHash();
  applyFilters();
})();
