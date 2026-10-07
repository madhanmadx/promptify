import { api } from '../api.js';
import { esc, toast } from '../ui.js';

function medal(rank) {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
}

function podium(entries) {
  const top = entries.slice(0, 3);
  if (top.length < 3) return '';
  const cls = ['first', 'second', 'third'];
  return `
    <div class="podium">
      ${top
        .map(
          (e, i) => `
        <div class="podium-col ${cls[i]}">
          <span class="medal">${medal(e.rank)}</span>
          <div class="p-id">${esc(e.submissionId)}</div>
          <div class="p-score">${e.score}<span style="font-size:.45em;opacity:.6">/${100}</span></div>
          <div class="p-name">${e.participant ? esc(e.participant.name) : 'Name hidden'}</div>
          <div class="p-title">${esc(e.title)}</div>
        </div>`
        )
        .join('')}
    </div>`;
}

function list(entries) {
  return `
    <div class="lb-list">
      ${entries
        .map(
          (e) => `
        <div class="lb-row ${e.rank === 1 ? 'top1' : e.rank === 2 ? 'top2' : e.rank === 3 ? 'top3' : ''}">
          <div class="r-num">${medal(e.rank)}</div>
          <div class="r-main">
            <strong>${esc(e.submissionId)}${e.award ? ` · <span class="gold-text">${esc(e.award)}</span>` : ''}</strong>
            <small>
              ${e.participant ? `${esc(e.participant.name)} · ${esc(e.participant.college)}` : 'Participant name hidden'}
              &nbsp;·&nbsp; ${esc(e.title)} &nbsp;·&nbsp; ${e.judges} judge${e.judges === 1 ? '' : 's'}
            </small>
          </div>
          <div class="r-score">${e.score}<span>/100</span></div>
        </div>`
        )
        .join('')}
    </div>`;
}

export async function leaderboard(root, params = {}) {
  const preview = params.query?.get('preview') === '1';
  let data;
  try {
    data = await api.get(`/leaderboard${preview ? '?preview=1' : ''}`);
  } catch (err) {
    data = { revealed: false, entries: [], error: err.message };
  }

  const head = `
    <div class="page-head center">
      <span class="eyebrow" style="justify-content:center">Official standings</span>
      <h1 class="display">Promptify — top creators</h1>
      <p class="lead" style="max-width:600px;margin:0 auto">
        ${data.revealed
          ? `Ranked on the average of every judge's score. ${data.judged || 0} scores across ${data.totalEntries || 0} entries.`
          : 'Scores are being finalised. Names stay hidden until the official announcement.'}
      </p>
    </div>`;

  if (!data.revealed) {
    root.innerHTML = `
      <div class="page">
        <div class="container">
          ${head}
          <div class="form-card">
            <div class="card card-pad center" style="padding-block:56px">
              <div style="font-size:56px">🔒</div>
              <h2 class="display h3 mt-2">Leaderboard not revealed yet</h2>
              <p class="muted">
                ${data.totalEntries
                  ? `${data.totalEntries} entries · ${data.judged || 0} judge scores collected so far.`
                  : 'Submissions are still coming in.'}
              </p>
              <div class="notice mt-2" style="text-align:left">
                The organizer unlocks this board after judging closes. Check back after the announcement.
              </div>
              <div class="hero-actions mt-3" style="margin-bottom:0">
                <a class="btn btn-primary" href="#/submit">Submit your artwork</a>
                <a class="btn btn-ghost" href="#/">Home</a>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    return;
  }

  const entries = data.entries || [];
  root.innerHTML = `
    <div class="page">
      <div class="container">
        ${head}
        ${
          entries.length
            ? `
          ${data.preview ? '<div class="notice warn center mb-2">👁 Preview mode — this is what the public board would show.</div>' : ''}
          ${podium(entries)}
          ${list(entries)}
          <div class="center mt-3 muted small">
            ${data.revealNames ? 'Names are revealed for this announcement.' : 'Participant names are revealed at the award ceremony.'}
          </div>
        `
            : `
          <div class="empty-state">
            <span class="ico">🏆</span>
            <strong style="display:block">No scores published yet</strong>
            <p class="muted">Judge scores will appear here once they are submitted.</p>
          </div>
        `
        }
      </div>
    </div>`;

  if (preview) toast('Previewing the public leaderboard as admin.', 'info');
}
