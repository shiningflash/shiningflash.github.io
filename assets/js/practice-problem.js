/*
 * Practice — reveal-solution toggle on the problem page.
 * Hidden by default; revealing scrolls the solution into view and
 * persists a per-problem "I revealed this one" flag in localStorage so
 * navigating away and back doesn't slam the user with the gate again.
 */
(() => {
  const gate = document.getElementById('pr-solution-gate');
  const revealBtn = document.getElementById('pr-reveal-btn');
  const hideBtn = document.getElementById('pr-hide-btn');
  const solution = document.getElementById('pr-solution');
  if (!gate || !revealBtn || !solution) return;

  const slug = location.pathname.replace(/\/$/, '');
  const storageKey = 'pr:revealed:' + slug;

  function show() {
    solution.hidden = false;
    revealBtn.setAttribute('aria-expanded', 'true');
    revealBtn.classList.add('is-revealing');
    gate.style.display = 'none';
    try { localStorage.setItem(storageKey, '1'); } catch (_) {}
    requestAnimationFrame(() => {
      solution.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function hide() {
    solution.hidden = true;
    revealBtn.setAttribute('aria-expanded', 'false');
    revealBtn.classList.remove('is-revealing');
    gate.style.display = '';
    try { localStorage.removeItem(storageKey); } catch (_) {}
    gate.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  revealBtn.addEventListener('click', show);
  hideBtn?.addEventListener('click', hide);

  // If user previously revealed this problem, auto-show on revisit.
  try {
    if (localStorage.getItem(storageKey) === '1') {
      solution.hidden = false;
      revealBtn.setAttribute('aria-expanded', 'true');
      gate.style.display = 'none';
    }
  } catch (_) {}
})();
