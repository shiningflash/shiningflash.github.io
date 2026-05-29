/*
 * System Design Concepts — client-side filter for the index page.
 * Search filters by title/tease; section chips filter by section.
 * State is reflected to the URL hash so filtered views are shareable.
 */
(() => {
  const root = document.getElementById('cc-sections');
  if (!root) return;

  const sections = Array.from(root.querySelectorAll('.concept-section'));
  const cards = Array.from(root.querySelectorAll('.concept-card'));
  const searchInput = document.getElementById('cc-search-input');
  const clearBtn = document.getElementById('cc-clear');
  const resetBtn = document.getElementById('cc-reset');
  const empty = document.getElementById('cc-empty');
  const countEl = document.getElementById('cc-count');
  const activeFiltersEl = document.getElementById('cc-active-filters');
  const sectionChips = Array.from(document.querySelectorAll('[data-filter-section]'));
  const total = cards.length;

  const state = {
    search: '',
    sections: new Set(),
  };

  function readHash() {
    const h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    const params = new URLSearchParams(h);
    if (params.get('q')) {
      state.search = params.get('q');
      searchInput.value = state.search;
    }
    (params.getAll('sec') || []).forEach(s => state.sections.add(s));
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.search) params.set('q', state.search);
    state.sections.forEach(s => params.append('sec', s));
    const next = params.toString();
    const url = next ? `#${next}` : window.location.pathname + window.location.search;
    history.replaceState(null, '', url);
  }

  function syncChips() {
    sectionChips.forEach(btn => {
      btn.classList.toggle('pr-chip-active', state.sections.has(btn.dataset.filterSection));
    });
  }

  function matches(card) {
    if (state.sections.size > 0 && !state.sections.has(card.dataset.section)) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const hay = `${card.dataset.title} ${card.dataset.tease} ${card.dataset.section.toLowerCase()}`;
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function apply() {
    let shown = 0;
    cards.forEach(card => {
      const ok = matches(card);
      card.hidden = !ok;
      if (ok) shown++;
    });
    sections.forEach(sec => {
      const anyVisible = sec.querySelectorAll('.concept-card:not([hidden])').length > 0;
      sec.hidden = !anyVisible;
    });
    countEl.textContent = shown;
    empty.hidden = shown !== 0;
    root.hidden = shown === 0;
    const filtered = state.search || state.sections.size > 0;
    resetBtn.hidden = !filtered;
    clearBtn.hidden = !state.search;
    activeFiltersEl.textContent = filtered ? '· filtered' : '';
    syncChips();
    writeHash();
  }

  searchInput.addEventListener('input', e => {
    state.search = e.target.value.trim();
    apply();
  });
  clearBtn.addEventListener('click', () => {
    state.search = '';
    searchInput.value = '';
    searchInput.focus();
    apply();
  });
  sectionChips.forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.filterSection;
      if (state.sections.has(s)) state.sections.delete(s); else state.sections.add(s);
      apply();
    });
  });
  function reset() {
    state.search = '';
    state.sections.clear();
    searchInput.value = '';
    apply();
  }
  resetBtn.addEventListener('click', reset);
  document.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', reset));

  readHash();
  apply();
})();
