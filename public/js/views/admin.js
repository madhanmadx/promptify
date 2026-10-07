import { api, store, qs } from '../api.js';
import { esc, toast, statusBadge, fmtDate, fmtBytes, modal, closeModal, confirmDialog, downloadText, downloadBlob, setLoading } from '../ui.js';
import { requireAuth } from './auth.js';

const FLAG_LABELS = {
  'prompt-mismatch': 'Prompt mismatch',
  duplicate: 'Possible duplicate',
  'stock-image': 'Reused / stock image',
  'low-effort': 'Low-effort prompt',
};

const FILTERS = [
  ['all', 'All'],
  ['submitted', 'Submitted'],
  ['verifying', 'Verifying'],
  ['verified', 'Verified'],
  ['rejected', 'Rejected'],
  ['judging_completed', 'Judged'],
  ['finalist', 'Finalists'],
];

const state = {
  user: null,
  stats: null,
  items: [],
  total: 0,
  pages: 1,
  page: 1,
  status: 'all',
  q: '',
  selected: null,
  detail: null,
  loading: false,
  // ---- challenge sessions (the 30-minute clocks) ----
  sessions: [],
  sessionInfo: null,
  sessionTick: null,
  sessionAge: 0,
  // ---- live table refresh ----
  listTick: null,
};

/* ------------------------------------------------------------ auth guard */
async function ensureAuth(root) {
  // a stored token may have expired — verify it before trusting the shell
  if (store.token && store.user?.role === 'admin') {
    try {
      await api.get('/auth/me');
    } catch {
      store.clear();
    }
  }

  if (!store.token || store.user?.role !== 'admin') {
    const res = await requireAuth(root, {
      role: 'admin',
      heading: 'Promptify Admin',
      sub: 'Restricted area — organizer access only.',
      demoHint: 'Demo credentials: <strong>admin</strong> / <strong>promptify2026</strong>',
    });
    if (!res) return null;
  }
  state.user = store.user;
  return state.user;
}

/* ---------------------------------------------------------------- render */
function shellHtml() {
  const u = state.user || {};
  const initials = (u.name || u.username || 'A').slice(0, 1).toUpperCase();
  return `
    <div class="page">
      <div class="container">
        <div class="dash-top">
          <div>
            <span class="eyebrow">Promptify admin</span>
            <h1 class="display">Organizer dashboard</h1>
            <div class="sub">Verify entries, run the authenticity check, score the pipeline.</div>
          </div>
          <div class="flex">
            <span class="user-chip"><span class="av">${esc(initials)}</span>${esc(u.name || '')}</span>
            <button class="btn btn-ghost btn-sm" id="judgesBtn">👥 Judges</button>
            <button class="btn btn-ghost btn-sm" id="settingsBtn">⚙ Settings</button>
            <button class="btn btn-ghost btn-sm" id="exportBtn">⬇ Export CSV</button>
            <button class="btn btn-ghost btn-sm" id="zipBtn" title="Download artwork images + prompts + details as one ZIP">⬇ Images + details</button>
            <button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button>
          </div>
        </div>

        <div class="stat-grid" id="stats"></div>

        <div class="panel session-panel">
          <div class="panel-head">
            <h3>⏱ Challenge sessions <span class="muted" style="font-weight:400" id="sessionsWindow"></span></h3>
            <span class="muted small" id="sessionsMeta">Loading…</span>
          </div>
          <div id="sessionsBody" class="session-body"></div>
        </div>

        <div class="toolbar">
          <input class="input search" id="search" placeholder="Search ID, name, college, artwork title…" />
          <div class="flex" id="chips" style="gap:8px"></div>
          <button class="btn btn-ghost btn-sm" id="refreshBtn">⟳ Refresh</button>
        </div>

        <div class="split">
          <div id="tableHost"></div>
          <div id="detailHost" class="sticky-panel"></div>
        </div>
      </div>
    </div>`;
}

function renderStats() {
  const s = state.stats;
  const host = document.getElementById('stats');
  if (!s || !host) return;
  const tiles = [
    ['Total submissions', s.total, `${s.colleges} institutions`, ''],
    ['Verified', s.verified, 'released to judges', ''],
    ['Pending', s.pending, 'awaiting verification', 'gold'],
    ['Rejected', s.rejected, 'disqualified entries', ''],
    ['Finalists', s.finalists, 'promoted by you', 'gold'],
    ['Avg score', `${s.avgScore}`, `of ${s.scoringTotal} · ${s.scores} scores`, ''],
  ];
  host.innerHTML = tiles
    .map(([k, v, sub, cls]) => `
      <div class="stat ${cls}">
        <div class="k">${k}</div>
        <div class="v">${v}</div>
        <div class="s">${sub}</div>
      </div>`)
    .join('');
}

function renderChips() {
  const host = document.getElementById('chips');
  if (!host) return;
  host.innerHTML = FILTERS.map(
    ([key, label]) =>
      `<button class="chip-filter ${state.status === key ? 'is-active' : ''}" data-status="${key}">${label}</button>`
  ).join('');
  host.querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', () => {
      state.status = b.dataset.status;
      state.page = 1;
      renderChips();
      loadList();
    })
  );
}

/* ------------------------------------------------------ challenge sessions */
const fmtClock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const fmtTime = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/** Minutes used between "clock started" and the upload. */
function minutesUsed(startedAt, submittedAt) {
  if (!startedAt) return null;
  return Math.max(0, Math.round((new Date(submittedAt) - new Date(startedAt)) / 60000));
}

/** "⏱ 23m" in the table's title line — how long the entry took. */
function clockBadge(r) {
  const used = minutesUsed(r.challengeStartedAt, r.createdAt);
  if (used === null) return '';
  const win = r.challengeMinutes || state.sessionInfo?.minutes || 30;
  return ` · <span title="Uploaded ${used} min after the clock started (window ${win} min)"
    style="color:${used > win ? 'var(--amber)' : 'var(--green)'}">⏱ ${used}m</span>`;
}

/** Timing line for the verification panel: started → submitted → used. */
function challengeLine(s) {
  const used = minutesUsed(s.challengeStartedAt, s.createdAt);
  if (used === null) {
    return '<span class="muted">Not recorded — demo or imported entry (made outside the timed flow)</span>';
  }
  const win = s.challengeMinutes || state.sessionInfo?.minutes || 30;
  const over = used > win;
  return (
    `Started <strong>${fmtTime(s.challengeStartedAt)}</strong> → submitted ` +
    `<strong>${fmtTime(s.createdAt)}</strong> · used ` +
    `<strong style="color:${over ? 'var(--amber)' : 'var(--green)'}">${used}/${win} min</strong>` +
    (over ? ' <span class="tag">past deadline</span>' : ' <span class="muted small">within the window</span>')
  );
}

async function loadSessions() {
  try {
    state.sessionInfo = await api.get('/admin/timer-sessions');
    state.sessions = state.sessionInfo.sessions || [];
  } catch {
    state.sessionInfo = null;
    state.sessions = [];
  }
  renderSessions();
}

function renderSessions() {
  const body = document.getElementById('sessionsBody');
  const meta = document.getElementById('sessionsMeta');
  const win = document.getElementById('sessionsWindow');
  if (!body) return;

  const info = state.sessionInfo;
  if (!info) {
    if (meta) meta.textContent = '';
    if (win) win.textContent = '';
    body.innerHTML = `<p class="muted small mb-0">Could not load the challenge sessions — press ⟳ Refresh.</p>`;
    return;
  }

  if (win) win.textContent = `· ${info.minutes}-minute window`;
  if (meta) {
    meta.innerHTML =
      `<strong style="color:var(--green)">${info.running} running</strong> · ` +
      `${info.expired} expired · ${info.minutes} min + ${info.graceMinutes} min upload`;
  }

  if (!state.sessions.length) {
    body.innerHTML = `<p class="muted small mb-0">No clock is running right now. A row appears the moment a
      participant presses <strong>Start</strong> on the submission page, and moves into the table below once
      the artwork is uploaded.</p>`;
    return;
  }

  body.innerHTML = `
    <div class="table-wrap">
      <table class="data sessions">
        <thead>
          <tr><th>Device</th><th>Started</th><th>Ends in</th><th>Time left</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${state.sessions.map((s) => `
            <tr>
              <td class="cell-id">${esc(s.device)}</td>
              <td>${fmtDate(s.startedAt, true)}</td>
              <td>${fmtDate(s.endsAt, true)}</td>
              <td class="clock-cell ${s.active ? '' : 'is-done'}" data-ends="${new Date(s.endsAt).getTime()}">
                ${s.active ? fmtClock(s.remainingMs) : '00:00'}
              </td>
              <td>${s.active ? '<span class="tag tag-green">● running</span>' : '<span class="tag tag-neutral">expired</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Counts the "Time left" column down and picks up new sessions every 20 s. */
function startSessionTicker() {
  if (state.sessionTick) clearInterval(state.sessionTick);
  state.sessionTick = setInterval(() => {
    const body = document.getElementById('sessionsBody');
    if (!body) {
      clearInterval(state.sessionTick);
      state.sessionTick = null;
      return;
    }
    if (++state.sessionAge >= 20) {
      state.sessionAge = 0;
      loadSessions();
      return;
    }
    body.querySelectorAll('[data-ends]').forEach((el) => {
      const left = Number(el.dataset.ends) - Date.now();
      el.textContent = left > 0 ? fmtClock(left) : '00:00';
      el.classList.toggle('is-urgent', left > 0 && left < 60000);
      el.classList.toggle('is-warn', left > 60000 && left <= 5 * 60000);
    });
  }, 1000);
}

/**
 * Pulls new submissions in every 20 s so the organizer never stares at a stale
 * table wondering why an entry "didn't show up". It steps aside whenever an
 * entry is open, a dialog is up, or a filter is being typed, and stops itself
 * the moment the dashboard unmounts.
 */
function startListTicker() {
  if (state.listTick) clearInterval(state.listTick);
  state.listTick = setInterval(() => {
    if (!document.getElementById('tableHost')) {
      clearInterval(state.listTick);
      state.listTick = null;
      return;
    }
    if (state.selected || document.querySelector('.modal-root:not([hidden])')) return;
    const el = document.activeElement;
    if (el && (el.id === 'search' || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    loadList({ silent: true });
    loadStats();
  }, 20000);
}

function renderTable() {
  const host = document.getElementById('tableHost');
  if (!host) return;

  if (state.loading && !state.items.length) {
    host.innerHTML = `<div class="panel"><div class="empty-state"><span class="spinner"></span><div class="mt-2">Loading submissions…</div></div></div>`;
    return;
  }

  if (!state.items.length) {
    host.innerHTML = `
      <div class="panel"><div class="empty-state">
        <span class="ico">🗂️</span>
        <strong style="display:block">No submissions match this filter</strong>
        <p class="muted mb-0">Try another status or clear the search box.</p>
      </div></div>`;
    return;
  }

  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>ID</th><th>Artwork</th><th>Participant</th><th>Title</th>
            <th>Score</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${state.items.map((r) => `
            <tr data-id="${esc(r.submissionId)}" class="${state.selected === r.submissionId ? 'is-selected' : ''}">
              <td class="cell-id">${esc(r.submissionId)}</td>
              <td><img class="cell-thumb" src="${r.artworkUrl}" alt="" loading="lazy" /></td>
              <td class="cell-title">
                <strong>${esc(r.fullName)}</strong>
                <small>${esc(r.college)}${r.participation === 'team' ? ` · ${esc(r.teamName)}` : ''}</small>
              </td>
              <td class="cell-title">
                <strong>${esc(r.title)}</strong>
                <small>${esc(r.aiTool)} · ${fmtDate(r.createdAt)}${clockBadge(r)}</small>
              </td>
              <td>${r.score !== null ? `<strong style="color:var(--cyan)">${r.score}</strong> <span class="muted small">(${r.judgeCount})</span>` : '<span class="muted">—</span>'}</td>
              <td>${statusBadge(r.status)}</td>
              <td class="right">${(r.flags || []).map((f) => `<span class="tag" title="${esc(FLAG_LABELS[f])}">⚠</span>`).join(' ')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${state.pages > 1 ? `
      <div class="pagination">
        <button class="btn btn-ghost btn-sm" id="prevPage" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="muted small">Page ${state.page} of ${state.pages} · ${state.total} entries</span>
        <button class="btn btn-ghost btn-sm" id="nextPage" ${state.page >= state.pages ? 'disabled' : ''}>Next →</button>
      </div>` : `<div class="pagination"><span class="muted small">${state.total} entries</span></div>`}
  `;

  host.querySelectorAll('tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => loadDetail(tr.dataset.id))
  );
  host.querySelector('#prevPage')?.addEventListener('click', () => { state.page--; loadList(); });
  host.querySelector('#nextPage')?.addEventListener('click', () => { state.page++; loadList(); });
}

/** Cheap lexical overlap between the prompt and the concept statement. */
function alignment(a, b) {
  const words = (s) =>
    new Set(
      String(s).toLowerCase().match(/[a-z]{4,}/g) || []
    );
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return Math.round((hit / Math.min(A.size, B.size)) * 100);
}

function renderDetail() {
  const host = document.getElementById('detailHost');
  if (!host) return;

  if (!state.detail) {
    host.innerHTML = `
      <div class="panel"><div class="empty-state">
        <span class="ico">🔍</span>
        <strong style="display:block">Select a submission</strong>
        <p class="muted mb-0">Click any row to open the verification panel.</p>
      </div></div>`;
    return;
  }

  const { submission: s, scores = [], scoreAvg } = state.detail;
  const align = alignment(s.prompt, s.concept);

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3 class="cell-id" style="font-size:15px">${esc(s.submissionId)}</h3>
        ${statusBadge(s.status)}
      </div>

      <div class="panel-body">
        <div class="art-frame"><img src="${s.artworkUrl}" alt="${esc(s.title)}" /></div>

        <dl class="kv-list mt-2">
          <div class="kv"><dt>Participant</dt><dd>${esc(s.fullName)}${s.participation === 'team' ? ` <span class="tag tag-blue">Team · ${esc(s.teamName)}</span>` : ''}</dd></div>
          <div class="kv"><dt>College</dt><dd>${esc(s.college)}</dd></div>
          <div class="kv"><dt>Dept / Year</dt><dd>${esc(`${s.department} · ${s.year}`)}</dd></div>
          ${s.teamMembers?.length ? `<div class="kv"><dt>Members</dt><dd>${esc(s.teamMembers.join(', '))}</dd></div>` : ''}
          <div class="kv"><dt>Artwork</dt><dd>${esc(s.title)} <span class="muted small">· ${esc(s.artworkType)} · ${fmtBytes(s.artworkSize)}</span></dd></div>
          <div class="kv"><dt>AI tool</dt><dd>${esc(s.aiTool)}</dd></div>
          <div class="kv"><dt>Submitted</dt><dd>${fmtDate(s.createdAt, true)}</dd></div>
          <div class="kv"><dt>⏱ Challenge</dt><dd>${challengeLine(s)}</dd></div>
        </dl>

        <div class="mt-2">
          <div class="label small muted" style="letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Original prompt</div>
          <div class="prompt-box">${esc(s.prompt)}</div>
        </div>
        <div class="mt-2">
          <div class="label small muted" style="letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Concept</div>
          <div class="prompt-box concept">${esc(s.concept)}</div>
        </div>

        <div class="divider"></div>

        <strong style="font-size:13px;letter-spacing:.1em;text-transform:uppercase">🔎 Prompt authenticity check</strong>
        <p class="muted small mt-1 mb-0">
          Prompt ↔ concept word alignment: <strong style="color:${align < 20 ? 'var(--red)' : 'var(--green)'}">${align}%</strong>.
          Compare the prompt with the artwork yourself — flag anything that does not belong.
        </p>
        <div class="flag-row mt-1">
          ${Object.entries(FLAG_LABELS).map(([key, label]) => `
            <button class="flag-btn ${(s.flags || []).includes(key) ? 'is-on' : ''}" data-flag="${key}">${label}</button>
          `).join('')}
        </div>

        <div class="field mt-2">
          <label for="notes">Organizer notes</label>
          <textarea class="textarea" id="notes" style="min-height:84px" placeholder="Internal note — not visible to the participant.">${esc(s.organizerNotes || '')}</textarea>
        </div>

        <div class="label small muted" style="letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Judge scores ${scoreAvg !== null ? `· <strong style="color:var(--cyan)">${scoreAvg}/100</strong>` : ''}</div>
        ${
          scores.length
            ? scores.map((sc) => `
                <div class="score-summary" style="margin-top:0;margin-bottom:8px">
                  <span class="score-chip"><strong>${sc.total}</strong>/100 · ${esc(sc.judgeName)}</span>
                  ${Object.entries(sc.scores || {}).map(([k, v]) => `<span class="score-chip">${esc(k.replace(/([A-Z])/g, ' $1').toLowerCase())}: ${v}</span>`).join('')}
                </div>`).join('')
            : '<p class="muted small mb-0">No judge has scored this entry yet.</p>'
        }
      </div>

      <div class="panel-foot">
        <button class="btn btn-success btn-sm" data-act="verified">✅ Verify</button>
        <button class="btn btn-ghost btn-sm" data-act="verifying">🔵 Start verification</button>
        <button class="btn btn-danger btn-sm" data-act="rejected">🗑 Reject</button>
        <button class="btn btn-ghost btn-sm" data-act="submitted">↩ Reset</button>
        <button class="btn ${s.isFinalist ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="finalist">${s.isFinalist ? '★ Finalist' : '☆ Promote to finalist'}</button>
        <button class="btn btn-ghost btn-sm" id="dlEntry" title="Download this artwork with its prompt and details">⬇ Download entry</button>
        <button class="btn btn-ghost btn-sm" id="saveNotes">💾 Save notes</button>
        <button class="btn btn-danger btn-sm" id="deleteBtn" title="Remove this entry permanently">🗑 Delete</button>
      </div>
    </div>`;

  host.querySelectorAll('[data-flag]').forEach((b) =>
    b.addEventListener('click', async () => {
      const flag = b.dataset.flag;
      const on = !b.classList.contains('is-on');
      try {
        await api.patch(`/admin/submissions/${state.selected}/flags`, { flag, on });
        b.classList.toggle('is-on', on);
        toast(on ? `Flagged: ${FLAG_LABELS[flag]}` : `Cleared: ${FLAG_LABELS[flag]}`, on ? 'error' : 'success');
        loadList();
      } catch (e) {
        toast(e.message, 'error');
      }
    })
  );

  host.querySelector('#saveNotes')?.addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true, 'Saving…');
    try {
      await api.patch(`/admin/submissions/${state.selected}/status`, {
        status: state.detail.submission.status,
        notes: host.querySelector('#notes').value,
      });
      toast('Notes saved.', 'success');
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setLoading(e.currentTarget, false);
    }
  });

  host.querySelector('#dlEntry')?.addEventListener('click', (e) =>
    downloadArchive(
      e.currentTarget,
      { ids: state.selected },
      `${state.selected} — artwork, prompt and details downloaded.`
    )
  );

  host.querySelector('#deleteBtn')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      `Delete ${state.selected} permanently? Its artwork and all judge scores will be removed. This cannot be undone.`,
      { title: 'Delete submission?', confirmText: 'Delete forever', danger: true }
    );
    if (!ok) return;
    try {
      await api.del(`/admin/submissions/${state.selected}`);
      toast(`${state.selected} deleted.`, 'success');
      state.selected = null;
      state.detail = null;
      renderDetail();
      loadStats();
      loadList();
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  host.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'finalist') {
        const s2 = state.detail.submission;
        if (s2.isFinalist) {
          await api.patch(`/admin/submissions/${s2.submissionId}/finalist`, { isFinalist: false });
          toast('Finalist status removed.', 'info');
        } else {
          modal({
            title: 'Promote to finalist',
            body: `
              <div class="field">
                <label for="awardSel">Award label (optional)</label>
                <select class="select" id="awardSel">
                  <option value="">— none —</option>
                  <option value="Winner">Winner</option>
                  <option value="Runner-up">Runner-up</option>
                  <option value="Second Runner-up">Second Runner-up</option>
                  <option value="Best Prompt Engineering">Best Prompt Engineering</option>
                  <option value="Best Visual Story">Best Visual Story</option>
                  <option value="Honourable Mention">Honourable Mention</option>
                </select>
              </div>`,
            foot: `
              <button class="btn btn-ghost btn-sm" data-close>Cancel</button>
              <button class="btn btn-gold btn-sm" id="doPromote">Promote</button>`,
          });
          document.getElementById('doPromote').addEventListener('click', async () => {
            const award = document.getElementById('awardSel').value;
            closeModal();
            await api.patch(`/admin/submissions/${s2.submissionId}/finalist`, { isFinalist: true, award });
            toast(`${s2.submissionId} promoted to finalist.`, 'success');
            loadDetail(s2.submissionId);
            loadList();
            loadStats();
          });
        }
        return;
      }

      const labels = {
        verified: 'Entry verified and released to judges.',
        verifying: 'Marked as under verification.',
        rejected: 'Entry rejected.',
        submitted: 'Entry reset to submitted.',
      };
      if (act === 'rejected') {
        const ok = await confirmDialog(
          'The participant will see this entry as rejected. Continue?',
          { title: 'Reject entry?', confirmText: 'Reject', danger: true }
        );
        if (!ok) return;
      }
      try {
        await api.patch(`/admin/submissions/${state.selected}/status`, { status: act });
        toast(labels[act], act === 'rejected' ? 'error' : 'success');
        loadDetail(state.selected);
        loadList();
        loadStats();
      } catch (e) {
        toast(e.message, 'error');
      }
    })
  );
}

/* ------------------------------------------------------------------ data */
async function loadStats() {
  try {
    state.stats = await api.get('/admin/stats');
    renderStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/**
 * Loads the table. `silent` is for the auto-refresh: it leaves the current rows
 * on screen (no "Loading…" flash) and swallows errors instead of toasting them
 * on every tick.
 */
async function loadList({ silent = false } = {}) {
  if (!silent) {
    state.loading = true;
    renderTable();
  }
  try {
    const res = await api.get(`/admin/submissions${qs({ status: state.status, q: state.q, page: state.page, limit: 15 })}`);
    state.items = res.items;
    state.total = res.total;
    state.pages = res.pages;
  } catch (e) {
    if (silent) console.warn('auto-refresh skipped:', e.message);
    else toast(e.message, 'error');
  } finally {
    state.loading = false;
    renderTable();
  }
}

async function loadDetail(id) {
  state.selected = id;
  state.detail = null;
  renderTable();
  document.getElementById('detailHost').innerHTML =
    `<div class="panel"><div class="empty-state"><span class="spinner"></span><div class="mt-2">Loading ${esc(id)}…</div></div></div>`;
  try {
    state.detail = await api.get(`/admin/submissions/${id}`);
    renderDetail();
  } catch (e) {
    toast(e.message, 'error');
    state.detail = null;
    renderDetail();
  }
}

/* -------------------------------------------------------------- settings */
function openSettings() {
  modal({
    title: 'Event settings',
    body: `
      <label class="confirm-box" style="background:rgba(52,211,153,.08);border-color:rgba(52,211,153,.35)">
        <input type="checkbox" id="setOpen" />
        <span><strong>Accept new submissions</strong><br /><span class="muted small">Turn off when the event deadline passes.</span></span>
      </label>

      <label class="confirm-box mt-2">
        <input type="checkbox" id="setReveal" />
        <span><strong>Reveal the leaderboard</strong><br /><span class="muted small">Publishes scores on the public leaderboard page.</span></span>
      </label>

      <label class="confirm-box mt-2">
        <input type="checkbox" id="setNames" />
        <span><strong>Show participant names</strong><br /><span class="muted small">Off = only submission IDs are listed until the announcement.</span></span>
      </label>

      <div class="form-row mt-2">
        <div class="field">
          <label for="setMin">Judges required per entry</label>
          <input class="input" id="setMin" type="number" min="1" max="5" />
        </div>
        <div class="field">
          <label for="setWinners">Winner slots</label>
          <input class="input" id="setWinners" type="number" min="1" max="10" />
        </div>
      </div>`,
    foot: `
      <button class="btn btn-ghost btn-sm" data-close>Cancel</button>
      <button class="btn btn-primary btn-sm" id="saveSettings">Save settings</button>`,
  });

  api.get('/admin/settings').then((s) => {
    document.getElementById('setOpen').checked = s.submissionsOpen;
    document.getElementById('setReveal').checked = s.leaderboardRevealed;
    document.getElementById('setNames').checked = s.revealNames;
    document.getElementById('setMin').value = s.minScores;
    document.getElementById('setWinners').value = s.winnerCount;
  });

  document.getElementById('saveSettings').addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true, 'Saving…');
    try {
      await api.put('/admin/settings', {
        submissionsOpen: document.getElementById('setOpen').checked,
        leaderboardRevealed: document.getElementById('setReveal').checked,
        revealNames: document.getElementById('setNames').checked,
        minScores: Number(document.getElementById('setMin').value),
        winnerCount: Number(document.getElementById('setWinners').value),
      });
      closeModal();
      toast('Settings updated.', 'success');
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setLoading(e.currentTarget, false);
    }
  });
}

async function openJudges() {
  let judges = [];
  try {
    judges = await api.get('/admin/judges');
  } catch (e) {
    toast(e.message, 'error');
    return;
  }

  modal({
    title: 'Judge accounts',
    wide: true,
    body: `
      <div class="table-wrap">
        <table class="data" style="min-width:520px">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Scores</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${judges.map((j) => `
              <tr>
                <td><strong>${esc(j.name)}</strong>${j.title ? `<br /><small class="muted">${esc(j.title)}</small>` : ''}</td>
                <td>${esc(j.username)}</td>
                <td>Judge</td>
                <td>${j.scoresSubmitted}</td>
                <td>${j.active ? '<span class="badge badge-green"><span class="dot"></span>Active</span>' : '<span class="badge badge-neutral">Disabled</span>'}</td>
                <td class="right"><button class="btn btn-ghost btn-sm" data-toggle="${j._id}" data-next="${j.active ? 'false' : 'true'}">${j.active ? 'Disable' : 'Enable'}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <hr class="divider" />
      <strong style="font-size:13px;letter-spacing:.08em;text-transform:uppercase">Add a judge</strong>
      <div class="form-row mt-1">
        <div class="field"><input class="input" id="jName" placeholder="Display name" /></div>
        <div class="field"><input class="input" id="jUser" placeholder="Username" /></div>
      </div>
      <div class="form-row">
        <div class="field"><input class="input" id="jPass" type="text" placeholder="Password (min 6 chars)" /></div>
        <div class="field"><input class="input" id="jTitle" placeholder="Title, e.g. Judge · Design" /></div>
      </div>`,
    foot: `
      <button class="btn btn-ghost btn-sm" data-close>Close</button>
      <button class="btn btn-primary btn-sm" id="addJudge">Add judge</button>`,
  });

  document.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api.patch(`/admin/judges/${b.dataset.toggle}`, { active: b.dataset.next === 'true' });
        closeModal();
        openJudges();
      } catch (e) {
        toast(e.message, 'error');
      }
    })
  );

  document.getElementById('addJudge').addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true, 'Adding…');
    try {
      await api.post('/admin/judges', {
        name: document.getElementById('jName').value.trim(),
        username: document.getElementById('jUser').value.trim(),
        password: document.getElementById('jPass').value,
        title: document.getElementById('jTitle').value.trim(),
      });
      closeModal();
      toast('Judge account created.', 'success');
      openJudges();
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setLoading(e.currentTarget, false);
    }
  });
}

async function exportCsv(btn) {
  setLoading(btn, true, 'Exporting…');
  try {
    const res = await fetch('/api/admin/export', {
      headers: { Authorization: `Bearer ${store.token}` },
    });
    if (!res.ok) throw new Error('Export failed.');
    downloadText(await res.text(), 'promptify-submissions.csv', 'text/csv');
    toast('CSV downloaded.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

/**
 * Downloads the ZIP archive (artwork image + prompt + details per entry).
 * Either pass `ids` for specific entries, or the table's `status`/`q` filter
 * to export exactly what the dashboard is showing.
 */
async function downloadArchive(btn, params, label) {
  setLoading(btn, true, 'Building ZIP…');
  try {
    const res = await fetch(`/api/admin/export/archive${qs(params)}`, {
      headers: { Authorization: `Bearer ${store.token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Export failed (${res.status}).`);
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const name = (disposition.match(/filename="?([^"]+)"?/) || [])[1] || 'promptify-export.zip';
    downloadBlob(await res.blob(), name);
    toast(label || `${name} downloaded.`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

/* ------------------------------------------------------------------ view */
export async function admin(root) {
  const user = await ensureAuth(root);
  if (!user) return;

  state.page = 1;
  state.status = 'all';
  state.q = '';
  state.selected = null;
  state.detail = null;

  root.innerHTML = shellHtml();
  renderStats();
  renderChips();
  renderTable();
  renderDetail();

  let debounce;
  document.getElementById('search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = e.target.value.trim();
      state.page = 1;
      loadList();
    }, 280);
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadStats();
    loadList();
    loadSessions();
    toast('Refreshed.', 'success');
  });
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('judgesBtn').addEventListener('click', openJudges);
  document.getElementById('exportBtn').addEventListener('click', (e) => exportCsv(e.currentTarget));
  document.getElementById('zipBtn').addEventListener('click', (e) => {
    const filtered = state.status !== 'all' || state.q;
    downloadArchive(
      e.currentTarget,
      { status: state.status, q: state.q },
      filtered
        ? `Downloaded ${state.total} entr${state.total === 1 ? 'y' : 'ies'} (current filter) — images + prompts + details.`
        : `Downloaded all ${state.total} entries — images + prompts + details.`
    );
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    store.clear();
    location.hash = '#/admin';
    location.reload();
  });

  await Promise.all([loadStats(), loadList(), loadSessions()]);
  startSessionTicker();
  startListTicker();
}
