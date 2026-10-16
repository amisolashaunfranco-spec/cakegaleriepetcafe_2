// A small progressive enhancement shared by the café and management screens.
// Content remains usable without animation support or with reduced motion.
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const selector = [
  '.hero-copy > *', '.hero-art', '.feature', '.section-head',
  '.product-card', '.story-photo', '.story-copy > *', '.visit-banner',
  '.page-head > *', '.form-panel', '.summary-panel', '.record-card',
  '.page-heading', '.welcome-strip', '.metric', '.panel', '.pet-card',
  '.auth-card'
].join(',');
const seen = new WeakSet();
const pending = new Set();
const pulses = new Set();
let frame = 0;
let observer;

function show(element, immediately = false) {
  if (immediately) element.style.setProperty('--reveal-delay', '0ms');
  element.classList.add('motion-visible');
  observer?.unobserve(element);
}

function makeObserver() {
  if (!('IntersectionObserver' in window) || preference.matches) return;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) show(entry.target);
  }, { threshold: 0, rootMargin: '0px 0px -20px 0px' });
}

function collect(branch, instant = false) {
  if (!(branch instanceof Element)) return;
  // Map tiles/markers move independently and must never receive reveal effects.
  if (branch.closest('.leaflet-container, .map, .tracking-map')) return;
  const candidates = [...(branch.matches(selector) ? [branch] : []), ...branch.querySelectorAll(selector)];
  const groups = new Map();
  for (const element of candidates) {
    if (seen.has(element) || !element.getClientRects().length) continue;
    seen.add(element);
    if (instant || preference.matches || !observer || element.getBoundingClientRect().bottom <= 0) continue;
    // Do not animate a child independently when its card/panel is revealing.
    if (element.parentElement?.closest('.motion-ready')) continue;
    const order = groups.get(element.parentElement) || 0;
    groups.set(element.parentElement, order + 1);
    element.style.setProperty('--reveal-delay', `${(order % 4) * 65}ms`);
    element.classList.add('motion-ready');
    if (element.contains(document.activeElement)) show(element, true);
    else observer.observe(element);
  }
}

function schedule(branch) {
  pending.add(branch);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const node of pending) {
      if (!node.isConnected) continue;
      // The orders page refreshes in the background every 20 seconds.
      // Quiet refreshes and search-result replacement should stay steady.
      collect(node, Boolean(node.closest('[data-motion-quiet="true"], #menu-grid[data-motion-filtering], #record-list')));
    }
    pending.clear();
  });
}

makeObserver();
collect(document.body);

const changes = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.removedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.motion-ready')) observer?.unobserve(node);
      for (const element of node.querySelectorAll('.motion-ready')) observer?.unobserve(element);
    }
    for (const node of record.addedNodes) if (node instanceof Element) schedule(node);
  }
});
for (const root of document.querySelectorAll('#main, #page-content, #auth-gate')) {
  changes.observe(root, { childList: true, subtree: true });
}
// The management sign-in panel is initially hidden while the session loads.
const gate = document.querySelector('#auth-gate');
if (gate) new MutationObserver(() => { if (!gate.hidden) schedule(gate); })
  .observe(gate, { attributes: true, attributeFilter: ['hidden'] });

document.addEventListener('focusin', event => {
  const element = event.target.closest?.('.motion-ready:not(.motion-visible)');
  if (element) show(element, true);
});

const count = document.querySelector('#cart-count');
if (count) new MutationObserver(() => {
  if (preference.matches || !count.animate) return;
  for (const active of pulses) active.cancel();
  const animation = count.animate([
    { scale: 1 }, { scale: 1.28, offset: .45 }, { scale: 1 }
  ], { duration: 360, easing: 'cubic-bezier(.22,1,.36,1)' });
  pulses.add(animation);
  const cleanup = () => pulses.delete(animation);
  animation.addEventListener('finish', cleanup, { once: true });
  animation.addEventListener('cancel', cleanup, { once: true });
}).observe(count, { childList: true, characterData: true, subtree: true });

preference.addEventListener('change', () => {
  observer?.disconnect();
  observer = undefined;
  if (preference.matches) {
    for (const element of document.querySelectorAll('.motion-ready')) show(element, true);
    for (const animation of pulses) animation.cancel();
    pulses.clear();
  } else makeObserver();
});
