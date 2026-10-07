import { api, store } from '../api.js';
import { esc, statusBadge, toast, setLoading, fmtDate } from '../ui.js';

const FLOW = [
  { key: 'submitted', label: 'Submitted', ico: '🟡', note: 'We received your entry and it is queued for review.' },
  { key: 'verifying', label: 'Under Verification', ico: '🔵', note: 'An organizer is checking your artwork and prompt.' },
  { key: 'verified', label: 'Verified', ico: '🟢', note: 'Your entry passed verification and is ready for judging.' },
  { key: 'judging_completed', label: 'Judging Completed', ico: '🟣', note: 'The judges have finished scoring your entry.' },
  { key: 'finalist', label: 'Finalist', ico: '🏆', note: 'Congratulations — you made the final list!' },
];

function timeline(status) {
  if (status === 'rejected') {
    return `
      <div class="timeline">
        <div class="timeline-item is-done">
          <div class="node">✓</div>
          <div class="t-body"><strong>Submitted</strong><small>Your entry was received.</small></div>
        </div>
        <div class="timeline-item is-error">
          <div class="node">✕</div>
          <div class="t-body"><strong>Rejected after verification</strong>
            <small>Organizers could not verify this entry. Please contact the event desk with your ID.</small>
          </div>
        </div>
      </div>`;
  }

  const currentIdx = FLOW.findIndex((f) => f.key === status);
  return `
    <div class="timeline">
      ${FLOW.map((step, i) => {
        const cls = i < currentIdx ? 'is-done' : i === currentIdx ? 'is-current' : '';
        return `
          <div class="timeline-item ${cls}">
            <div class="node">${i < currentIdx ? '✓' : step.ico}</div>
            <div class="t-body">
              <strong>${step.label}</strong>
              <small>${i <= currentIdx ? step.note : 'Pending'}</small>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function detailsCard(data, artworkUrl) {
  const d = data.details || {};
  return `
    <div class="card card-pad mt-3">
      <div class="grid grid-2" style="align-items:start">
        <div class="art-frame"><img src="${artworkUrl}" alt="${esc(d.title || '')}" /></div>
        <dl class="kv-list">
          <div class="kv"><dt>Participant</dt><dd>${esc(d.fullName || '—')}</dd></div>
          <div class="kv"><dt>College</dt><dd>${esc(d.college || '—')}</dd></div>
          <div class="kv"><dt>Department</dt><dd>${esc(`${d.department || ''} · ${d.year || ''}`)}</dd></div>
          ${d.participation === 'team'
            ? `<div class="kv"><dt>Team</dt><dd>${esc(d.teamName || '—')}<br /><span class="muted small">${esc((d.teamMembers || []).join(', '))}</span></dd></div>`
            : ''}
          <div class="kv"><dt>AI tool</dt><dd>${esc(d.aiTool || '—')}</dd></div>
        </dl>
      </div>

      <div class="mt-3">
        <div class="label small muted" style="letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Prompt</div>
        <div class="prompt-box">${esc(d.prompt || '—')}</div>
      </div>
      <div class="mt-2">
        <div class="label small muted" style="letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Concept</div>
        <div class="prompt-box concept">${esc(d.concept || '—')}</div>
      </div>
    </div>`;
}

export async function check(root, params = {}) {
  const preset = params.query?.get('id') || store.lastSubmission?.submissionId || '';

  root.innerHTML = `
    <div class="page">
      <div class="container">
        <div class="page-head center">
          <span class="eyebrow" style="justify-content:center">Submission tracker</span>
          <h1 class="display">Check your submission</h1>
          <p class="lead" style="max-width:560px;margin:0 auto">
            Enter the ID you received after submitting — for example
            <strong style="color:var(--cyan)">PF-${new Date().getFullYear()}-047</strong>.
          </p>
        </div>

        <div class="form-card">
          <div class="card card-pad">
            <div class="field">
              <label for="subId">Submission ID</label>
              <input class="input" id="subId" placeholder="PF-${new Date().getFullYear()}-001"
                value="${esc(preset)}" style="text-transform:uppercase;font-family:var(--font-display);letter-spacing:.06em" />
            </div>
            <button class="btn btn-primary btn-lg btn-block" id="checkBtn">Check status</button>
          </div>

          <div id="result" class="mt-3"></div>
        </div>
      </div>
    </div>`;

  const out = root.querySelector('#result');
  const input = root.querySelector('#subId');
  const btn = root.querySelector('#checkBtn');

  async function run() {
    const id = input.value.trim().toUpperCase();
    if (!id) {
      toast('Enter a submission ID first.', 'error');
      input.focus();
      return;
    }

    setLoading(btn, true, 'Checking…');
    out.innerHTML = '';
    try {
      const known = store.lastSubmission?.submissionId === id ? store.lastSubmission?.checkToken : '';
      const res = await api.get(`/submissions/check/${encodeURIComponent(id)}${known ? `?token=${known}` : ''}`);
      renderResult(res);
    } catch (err) {
      out.innerHTML = `
        <div class="card card-pad center">
          <div style="font-size:40px">🔎</div>
          <h3 class="display h3 mt-1">${err.status === 404 ? 'No such submission' : 'Lookup failed'}</h3>
          <p class="muted mb-0">${esc(err.message)}</p>
        </div>`;
    } finally {
      setLoading(btn, false);
    }
  }

  function renderResult(res) {
    const ownedBit = res.owned
      ? `<div class="notice mt-2">🔒 Verified on this device — full details unlocked.</div>`
      : `<div class="notice mt-2">Status only. Open this page on the device you submitted from to see your prompt and concept.</div>`;

    out.innerHTML = `
      <div class="card card-pad">
        <div class="flex between">
          <div>
            <div class="label small muted" style="letter-spacing:.18em;text-transform:uppercase">Submission</div>
            <div class="display" style="font-size:clamp(1.6rem,6vw,2.4rem);color:var(--cyan);letter-spacing:.04em">${esc(res.submissionId)}</div>
            <div class="muted small">“${esc(res.title)}” · ${fmtDate(res.submittedAt)}</div>
          </div>
          ${statusBadge(res.status)}
        </div>

        ${timeline(res.status)}
        ${ownedBit}
      </div>
      ${res.owned && res.details ? detailsCard(res, res.artworkUrl) : ''}
      <div class="center mt-3">
        <a class="btn btn-ghost btn-sm" href="#/submit">Submit another entry</a>
      </div>`;
  }

  btn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  if (preset) run();
}
