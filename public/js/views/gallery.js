import { api, qs } from '../api.js';
import { esc, toast, statusBadge, fmtDate, modal } from '../ui.js';

/**
 * Artwork gallery — every participant can browse what everyone else entered.
 * Only released entries (verified / judged / finalist) come back from the API,
 * and names follow the leaderboard's reveal switch.
 */
const state = {
  items: [],
  page: 1,
  pages: 1,
  total: 0,
  revealNames: false,
  awaiting: 0,
  loading: false,
};

function card(entry, index) {
  return `
    <button class="gal-card" data-idx="${index}" type="button">
      <img class="gal-thumb" src="${entry.artworkUrl}" alt="${esc(entry.title)}" loading="lazy" decoding="async" />
      <span class="gal-cap">
        <strong>${esc(entry.title)}</strong>
        <small>
          ${esc(entry.submissionId)}${entry.award ? ` · <span class="gold-text">${esc(entry.award)}</span>` : ''}
          ${entry.participant ? `<br />${esc(entry.participant.name)}` : ''}
        </small>
      </span>
    </button>`;
}

function lightbox(entry) {
  const p = entry.participant;
  modal({
    title: esc(entry.title),
    wide: true,
    body: `
      <div class="gal-zoom">
        <img src="${entry.artworkUrl}" alt="${esc(entry.title)}" />
      </div>
      <div class="receipt mt-2">
        <div class="kv"><dt>Submission</dt><dd>${esc(entry.submissionId)} · ${statusBadge(entry.status)}</dd></div>
        <div class="kv"><dt>AI tool</dt><dd>${esc(entry.aiTool || '—')}</dd></div>
        ${entry.award ? `<div class="kv"><dt>Award</dt><dd class="gold-text">${esc(entry.award)}</dd></div>` : ''}
        ${
          p
            ? `<div class="kv"><dt>Participant</dt><dd>${esc(p.name)} · ${esc(p.college)}${p.participation === 'team' ? ` · Team ${esc(p.teamName)}` : ''}</dd></div>`
            : '<div class="kv"><dt>Participant</dt><dd class="muted">Hidden until the award ceremony</dd></div>'
        }
        <div class="kv"><dt>Submitted</dt><dd>${fmtDate(entry.createdAt, true)}</dd></div>
      </div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close>Close</button>`,
  });
}

function bindCards(root) {
  root.querySelectorAll('.gal-card').forEach((btn) =>
    btn.addEventListener('click', () => {
      const entry = state.items[Number(btn.dataset.idx)];
      if (entry) lightbox(entry);
    })
  );
}

function paint(root) {
  const host = document.getElementById('galHost');
  if (!host) return;

  if (!state.items.length) {
    host.innerHTML = `
      <div class="panel">
        <div class="empty-state">
          <span class="ico">🖼️</span>
          <strong style="display:block">No artwork published yet</strong>
          <p class="muted mb-0">
            ${state.awaiting
              ? `${state.awaiting} entr${state.awaiting === 1 ? 'y is' : 'ies are'} still waiting for verification.`
              : 'Entries appear here as soon as the organizers verify them.'}
          </p>
        </div>
      </div>`;
    return;
  }

  host.innerHTML = `
    <div class="gallery-grid">
      ${state.items.map(card).join('')}
    </div>
    <div class="pagination">
      ${state.page < state.pages
        ? `<button class="btn btn-ghost btn-sm" id="galMore">Load more</button>`
        : ''}
      <span class="muted small">${state.items.length} of ${state.total} entries shown</span>
    </div>`;

  bindCards(root);
  document.getElementById('galMore')?.addEventListener('click', loadMore);
}

async function loadMore() {
  const btn = document.getElementById('galMore');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Loading…';
  }
  state.page += 1;
  try {
    const res = await api.get(`/gallery${qs({ page: state.page, limit: 24 })}`);
    state.items = state.items.concat(res.items);
    state.pages = res.pages;
    state.total = res.total;
    paint();
  } catch (e) {
    state.page -= 1;
    toast(e.message, 'error');
    paint();
  }
}

export async function gallery(root) {
  state.page = 1;
  state.items = [];
  state.loading = true;

  root.innerHTML = `
    <div class="page">
      <div class="container">
        <div class="page-head center">
          <span class="eyebrow" style="justify-content:center">Artwork gallery</span>
          <h1 class="display">See what everyone created</h1>
          <p class="lead" style="max-width:620px;margin:0 auto">
            Every verified entry, side by side. Tap an image to view it full size.
          </p>
        </div>
        <div id="galHost">
          <div class="panel">
            <div class="empty-state">
              <span class="spinner"></span>
              <div class="mt-2">Loading the gallery…</div>
            </div>
          </div>
        </div>
        <div class="center mt-3 muted small" id="galFoot"></div>
      </div>
    </div>`;

  try {
    const res = await api.get(`/gallery${qs({ page: 1, limit: 24 })}`);
    state.items = res.items;
    state.page = res.page;
    state.pages = res.pages;
    state.total = res.total;
    state.revealNames = res.revealNames;
    state.awaiting = res.awaiting || 0;

    const foot = document.getElementById('galFoot');
    if (foot) {
      foot.textContent = state.revealNames
        ? 'Names are revealed for this announcement. Prompts stay private until judging closes.'
        : 'Participant names stay hidden until the official announcement. Prompts stay private until judging closes.';
    }
    paint(root);
  } catch (e) {
    state.items = [];
    paint(root);
    toast(e.message, 'error');
  } finally {
    state.loading = false;
  }
}
