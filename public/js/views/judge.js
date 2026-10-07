import { api, store } from '../api.js';
import { esc, toast, statusBadge, fmtDate, setLoading, placeholder } from '../ui.js';
import { requireAuth } from './auth.js';

const state = {
  user: null,
  items: [],
  scoring: [],
  scoringTotal: 100,
  totals: {},
  selected: null,
  detail: null,
  scores: {},
  comment: '',
  dirty: false,
};

async function ensureAuth(root) {
  if (store.token && store.user?.role === 'judge') {
    try {
      await api.get('/auth/me');
    } catch {
      store.clear();
    }
  }

  if (!store.token || store.user?.role !== 'judge') {
    const res = await requireAuth(root, {
      role: 'judge',
      heading: 'Promptify Judging',
      sub: 'Blinded scoring — identities stay hidden until judging closes.',
      demoHint: 'Demo credentials: <strong>judge1</strong> (or judge2 / judge3) / <strong>judge2026</strong>',
    });
    if (!res) return null;
  }
  state.user = store.user;
  return state.user;
}

function shellHtml() {
  const u = state.user || {};
  const initials = (u.name || 'J').slice(0, 1).toUpperCase();
  return `
    <div class="page">
      <div class="container">
        <div class="dash-top">
          <div>
            <span class="eyebrow">Promptify judging</span>
            <h1 class="display">Judge dashboard</h1>
            <div class="sub">Artwork · prompt · concept — never the name behind them.</div>
          </div>
          <div class="flex">
            <span class="user-chip"><span class="av">${esc(initials)}</span>${esc(u.name || '')}</span>
            <button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button>
          </div>
        </div>

        <div class="stat-grid" id="judgeStats"></div>

        <div class="judge-head">
          <div class="flex">
            <span class="badge badge-neutral">Entries open for judging: <strong id="availCount">0</strong></span>
            <span class="badge badge-green">You have scored: <strong id="doneCount">0</strong></span>
            <span class="badge badge-blue">Still to score: <strong id="todoCount">0</strong></span>
          </div>
          <button class="btn btn-ghost btn-sm" id="refreshBtn">⟳ Refresh queue</button>
        </div>

        <div class="split">
          <div>
            <div class="queue-list" id="queueHost"></div>
          </div>
          <div class="sticky-panel" id="panelHost"></div>
        </div>
      </div>
    </div>`;
}

function renderStats() {
  const host = document.getElementById('judgeStats');
  if (!host) return;
  const t = state.totals || {};
  const mine = state.items.filter((i) => i.myScore !== null);
  const avg = mine.length
    ? Math.round((mine.reduce((s, i) => s + i.myScore, 0) / mine.length) * 10) / 10
    : 0;
  host.innerHTML = [
    ['Available', t.available ?? 0, 'verified entries'],
    ['Scored by you', t.scored ?? 0, 'your submissions'],
    ['Pending', t.pending ?? 0, 'waiting for you'],
    ['Your average', avg, `of ${state.scoringTotal} given`, 'gold'],
  ]
    .map(([k, v, s, cls]) => `
      <div class="stat ${cls || ''}">
        <div class="k">${k}</div>
        <div class="v">${v}</div>
        <div class="s">${s}</div>
      </div>`)
    .join('');

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('availCount', t.available ?? 0);
  set('doneCount', t.scored ?? 0);
  set('todoCount', t.pending ?? 0);
}

function renderQueue() {
  const host = document.getElementById('queueHost');
  if (!host) return;

  if (!state.items.length) {
    host.innerHTML = `
      <div class="panel"><div class="empty-state">
        <span class="ico">🖼️</span>
        <strong style="display:block">Nothing to score yet</strong>
        <p class="muted mb-0">Entries appear here as soon as the organizers verify them.</p>
      </div></div>`;
    return;
  }

  host.innerHTML = state.items
    .map(
      (i) => `
      <button class="queue-item ${state.selected === i.submissionId ? 'is-active' : ''}" data-id="${esc(i.submissionId)}">
        <img src="${i.artworkUrl}" alt="" loading="lazy" onerror="this.src='${placeholder('no image')}'" />
        <span class="qi-body">
          <strong>${esc(i.submissionId)} — ${esc(i.title)}</strong>
          <small>${esc(i.aiTool)} · ${fmtDate(i.createdAt)}${
            i.flags?.length ? ` · <span style="color:#ff9aa4">⚠ flagged by organizer</span>` : ''
          }</small>
        </span>
        <span class="badge ${i.myScore !== null ? 'badge-green' : 'badge-neutral'}">
          ${i.myScore !== null ? `${i.myScore}` : '—'}
        </span>
      </button>`
    )
    .join('');

  host.querySelectorAll('[data-id]').forEach((b) =>
    b.addEventListener('click', () => loadDetail(b.dataset.id))
  );
}

function total() {
  return Math.round(
    state.scoring.reduce((sum, c) => sum + (Number(state.scores[c.key]) || 0), 0) * 10
  ) / 10;
}

function renderPanel() {
  const host = document.getElementById('panelHost');
  if (!host) return;

  if (!state.detail) {
    host.innerHTML = `
      <div class="panel"><div class="empty-state">
        <span class="ico">🖌️</span>
        <strong style="display:block">Pick an entry from the queue</strong>
        <p class="muted mb-0">Your scores are private until you submit them.</p>
      </div></div>`;
    return;
  }

  const { submission: s, myScore, others = [], scoreCount, average } = state.detail;
  const locked = Boolean(myScore);

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <span class="cell-id" style="font-size:15px">SUBMISSION ${esc(s.submissionId)}</span>
          <div class="muted small">${esc(s.aiTool)}${s.flags?.length ? ' · ⚠ organizer flag' : ''}</div>
        </div>
        ${statusBadge(s.status)}
      </div>

      <div class="panel-body">
        <div class="art-frame"><img src="${s.artworkUrl}" alt="${esc(s.title)}" /></div>

        <h3 class="display h3 mt-2" style="font-size:1.15rem">${esc(s.title)}</h3>

        <div class="mt-2">
          <div class="label small muted" style="letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Prompt</div>
          <div class="prompt-box">${esc(s.prompt)}</div>
        </div>
        <div class="mt-2">
          <div class="label small muted" style="letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Concept</div>
          <div class="prompt-box concept">${esc(s.concept)}</div>
        </div>

        ${
          locked
            ? `<div class="notice warn mt-2">🔒 You already scored this entry. Editing your score is allowed until the round closes.</div>`
            : ''
        }

        <div class="divider"></div>

        <div class="rubric">
          ${state.scoring
            .map((c) => {
              const v = Number(state.scores[c.key]) || 0;
              return `
                <div class="score-row">
                  <div class="top">
                    <div>
                      <strong>${esc(c.label)}</strong>
                      <div class="max">maximum ${c.max}</div>
                    </div>
                    <div class="val" id="val-${c.key}">${v}</div>
                  </div>
                  <input type="range" min="0" max="${c.max}" step="0.5" value="${v}" data-key="${c.key}" data-max="${c.max}" />
                </div>`;
            })
            .join('')}
        </div>

        <div class="total-bar">
          <span class="t-label">Total score</span>
          <span class="t-value" id="totalVal">${total()}<span>/${state.scoringTotal}</span></span>
        </div>

        <div class="field mt-2">
          <label for="comment">Feedback for the participant <span class="muted" style="text-transform:none">(optional)</span></label>
          <textarea class="textarea" id="comment" style="min-height:96px" placeholder="What worked, what could be stronger...">${esc(state.comment)}</textarea>
        </div>

        ${
          others.length
            ? `
          <div class="notice mt-1">
            <strong>Other judges (visible because you submitted yours):</strong>
            <div class="score-summary">
              ${others.map((o) => `<span class="score-chip"><strong>${o.total}</strong>/100 · ${esc(o.judgeName)}</span>`).join('')}
            </div>
            <div class="small mt-1">Current average: <strong>${average ?? '—'}</strong>/100 across ${scoreCount} judge${scoreCount === 1 ? '' : 's'}.</div>
          </div>`
            : `<div class="notice mt-1">🔒 Other judges' scores stay hidden until you submit your own.</div>`
        }
      </div>

      <div class="panel-foot">
        <button class="btn btn-primary" id="saveScore">${locked ? 'Update score' : 'Submit score'}</button>
        <button class="btn btn-ghost btn-sm" id="resetScore">Reset sliders</button>
        <span class="muted small" style="align-self:center">Your total: <strong style="color:var(--cyan)">${total()}/100</strong></span>
      </div>
    </div>`;

  host.querySelectorAll('input[type=range]').forEach((r) => {
    r.addEventListener('input', () => {
      state.scores[r.dataset.key] = Number(r.value);
      state.dirty = true;
      const label = host.querySelector(`#val-${r.dataset.key}`);
      if (label) label.textContent = r.value;
      host.querySelector('#totalVal').innerHTML = `${total()}<span>/${state.scoringTotal}</span>`;
      const side = host.querySelector('.panel-foot .muted strong');
      if (side) side.textContent = `${total()}/${state.scoringTotal}`;
      state.comment = host.querySelector('#comment')?.value ?? state.comment;
    });
  });

  host.querySelector('#comment').addEventListener('input', (e) => { state.comment = e.target.value; });

  host.querySelector('#resetScore').addEventListener('click', () => {
    state.scores = Object.fromEntries(state.scoring.map((c) => [c.key, 0]));
    renderPanel();
  });

  host.querySelector('#saveScore').addEventListener('click', async (e) => {
    state.comment = host.querySelector('#comment').value;
    setLoading(e.currentTarget, true, 'Submitting…');
    try {
      await api.post('/judge/scores', {
        submissionId: s.submissionId,
        scores: state.scores,
        comment: state.comment,
      });
      state.dirty = false;
      toast(`Score saved for ${s.submissionId} — ${total()}/100`, 'success');
      await loadQueue();
      await loadDetail(s.submissionId, true);
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setLoading(e.currentTarget, false);
    }
  });
}

async function loadQueue() {
  try {
    const res = await api.get('/judge/queue');
    state.items = res.items;
    state.totals = res.totals;
    state.scoring = res.scoring;
    state.scoringTotal = res.scoringTotal;
    renderStats();
    renderQueue();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadDetail(id, force = false) {
  if (!force && state.selected === id && state.detail) return;
  state.selected = id;
  state.detail = null;
  renderQueue();
  document.getElementById('panelHost').innerHTML =
    `<div class="panel"><div class="empty-state"><span class="spinner"></span><div class="mt-2">Loading entry…</div></div></div>`;

  try {
    const res = await api.get(`/judge/queue/${encodeURIComponent(id)}`);
    state.detail = res;
    state.scoring = res.scoring;
    state.scoringTotal = res.scoringTotal;
    state.scores = res.myScore
      ? { ...res.myScore.scores }
      : Object.fromEntries(res.scoring.map((c) => [c.key, 0]));
    state.comment = res.myScore?.comment || '';
    renderPanel();
    renderQueue();
  } catch (e) {
    toast(e.message, 'error');
    state.detail = null;
    renderPanel();
  }
}

export async function judge(root) {
  const user = await ensureAuth(root);
  if (!user) return;

  state.selected = null;
  state.detail = null;
  state.scores = {};
  state.comment = '';

  root.innerHTML = shellHtml();
  renderQueue();
  renderPanel();

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await loadQueue();
    if (state.selected) await loadDetail(state.selected, true);
    toast('Queue refreshed.', 'success');
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    store.clear();
    location.hash = '#/judge';
    location.reload();
  });

  await loadQueue();
}
