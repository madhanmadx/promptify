import { landing } from './views/landing.js';
import { submit } from './views/submit.js';
import { check } from './views/check.js';
import { gallery } from './views/gallery.js';
import { rules } from './views/rules.js';
import { leaderboard } from './views/leaderboard.js';
import { qrBoard } from './views/qr.js';
import { admin } from './views/admin.js';
import { judge } from './views/judge.js';

const routes = {
  '/': { view: landing, title: 'Promptify · AI Image Generation Challenge' },
  '/submit': { view: submit, title: 'Submit Artwork · Promptify' },
  '/check': { view: check, title: 'Check Submission · Promptify' },
  '/gallery': { view: gallery, title: 'Artwork Gallery · Promptify' },
  '/rules': { view: rules, title: 'Event Rules · Promptify' },
  '/leaderboard': { view: leaderboard, title: 'Leaderboard · Promptify' },
  '/qr': { view: qrBoard, title: 'QR Submission Board · Promptify' },
  '/admin': { view: admin, title: 'Organizer Dashboard · Promptify' },
  '/judge': { view: judge, title: 'Judge Dashboard · Promptify' },
};

const root = document.getElementById('app');

export function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const idx = raw.indexOf('?');
  const path = idx === -1 ? raw : raw.slice(0, idx);
  const query = new URLSearchParams(idx === -1 ? '' : raw.slice(idx + 1));
  return { path: path || '/', query };
}

export function navigate(to, { replace = false } = {}) {
  const next = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (location.hash === next) render();
  else if (replace) location.replace(next);
  else location.hash = next;
}

function markNav(path) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.nav === path);
  });
}

function shell(html) {
  return `<div class="page"><div class="container">${html}</div></div>`;
}

async function render() {
  const { path, query } = parseRoute();
  const route = routes[path] || routes['/'];

  document.body.classList.remove('nav-open');
  markNav(path);
  document.title = route.title;
  root.innerHTML = shell(
    `<div class="empty-state"><span class="spinner" style="width:26px;height:26px"></span><div class="mt-2">Loading…</div></div>`
  );

  try {
    await route.view(root, { query, path, shell });
  } catch (err) {
    console.error(err);
    root.innerHTML = shell(`
      <div class="empty-state">
        <span class="ico">⚠️</span>
        <strong style="display:block;margin-bottom:8px">Something went wrong</strong>
        <p class="muted">${err.message || 'Unexpected error'}</p>
        <a class="btn btn-ghost btn-sm mt-2" href="#/">Back to home</a>
      </div>`);
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
}

document.getElementById('navToggle')?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  document.getElementById('navToggle').setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (a) document.body.classList.remove('nav-open');
});

window.addEventListener('hashchange', render);
render();

export { shell };
