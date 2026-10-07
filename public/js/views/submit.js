import { api, store } from '../api.js';
import { esc, toast, setLoading, statusBadge, downloadReceipt, fmtBytes } from '../ui.js';

const STEPS = ['Your Details', 'Your Creation', 'Your Prompt', 'Preview'];
const MAX_MB = 10;
const OK_TYPES = ['image/jpeg', 'image/png'];

const blank = {
  fullName: '', college: '', department: '', year: '', participation: 'individual',
  teamName: '', teamMembers: '', email: '', phone: '',
  title: '', aiTool: '', prompt: '', concept: '', theme: '',
};

const state = {
  step: 0,
  meta: null,
  file: null,
  fileUrl: '',
  agree: false,
  result: null,
  submitError: null,   // sticky failure message (a fading toast is easy to miss)
  data: { ...blank },
  // ---- 30-minute challenge window -------------------------------------
  timer: null,        // last /timer/status payload from the server
  timerEndsLocal: 0,  // Date.now() + server remaining, so clocks cannot be gamed
  timerExpired: false,
  tick: null,
};

function saveDraft() {
  store.draft = { step: Math.min(state.step, 2), data: state.data };
}

function loadDraft() {
  const d = store.draft;
  if (!d?.data) return;
  state.data = { ...blank, ...d.data };
  state.step = Math.min(Number(d.step) || 0, 2);
}

function clearDraft() {
  store.draft = null;
}

/* ---------------------------------------------------------------- render */
function stepbar() {
  return `
    <div class="stepbar">
      ${STEPS.map((label, i) => {
        const cls = i === state.step ? 'is-active' : i < state.step ? 'is-done' : '';
        return `<div class="stepbar-item ${cls}"><span class="n">${i + 1}.</span> ${label}</div>`;
      }).join('')}
    </div>`;
}

function detailsStep() {
  const d = state.data;
  const departments = state.meta?.event?.departments || [];
  const years = ['1st', '2nd', '3rd', '4th'];
  const isTeam = d.participation === 'team';

  return `
    <div class="card card-pad">
      <span class="eyebrow">Step 1 — Your details</span>
      <h2 class="display h3">Tell us who you are</h2>

      <div class="field">
        <label for="fullName">Full name</label>
        <input class="input" id="fullName" data-k="fullName" value="${esc(d.fullName)}" placeholder="Madhan Sachin" autocomplete="name" />
      </div>

      <div class="field">
        <label for="college">College / Institution</label>
        <input class="input" id="college" data-k="college" value="${esc(d.college)}" placeholder="ABC Engineering College" />
      </div>

      <div class="form-row">
        <div class="field">
          <label for="department">Department</label>
          <select class="select" id="department" data-k="department">
            <option value="">Select department ▼</option>
            ${departments.map((x) => `<option value="${esc(x)}" ${d.department === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Year</label>
          <div class="pill-group" data-group="year">
            ${years.map((y) => `<button type="button" class="pill-opt ${d.year === y ? 'is-active' : ''}" data-v="${y}">${y}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="field">
        <span class="label">Participation</span>
        <div class="radio-group">
          <label class="radio-card ${!isTeam ? 'is-active' : ''}">
            <input type="radio" name="participation" value="individual" ${!isTeam ? 'checked' : ''} />
            Individual
          </label>
          <label class="radio-card ${isTeam ? 'is-active' : ''}">
            <input type="radio" name="participation" value="team" ${isTeam ? 'checked' : ''} />
            Team
          </label>
        </div>
      </div>

      <div id="teamBox" style="${isTeam ? '' : 'display:none'}">
        <div class="field">
          <label for="teamName">Team name</label>
          <input class="input" id="teamName" data-k="teamName" value="${esc(d.teamName)}" placeholder="Neon Collective" />
        </div>
        <div class="field">
          <label for="teamMembers">Team members</label>
          <textarea class="textarea" id="teamMembers" data-k="teamMembers" style="min-height:96px"
            placeholder="One per line, or separated by commas">${esc(d.teamMembers)}</textarea>
          <div class="hint">Include yourself as the first member.</div>
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label for="email">Email <span class="muted" style="text-transform:none">(optional)</span></label>
          <input class="input" id="email" data-k="email" type="email" value="${esc(d.email)}" placeholder="you@college.edu" />
        </div>
        <div class="field">
          <label for="phone">Phone <span class="muted" style="text-transform:none">(optional)</span></label>
          <input class="input" id="phone" data-k="phone" value="${esc(d.phone)}" placeholder="+91 ..." />
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-lg" id="goNext">Continue →</button>
      </div>
    </div>`;
}

function artworkStep() {
  const hasFile = Boolean(state.file);
  return `
    <div class="card card-pad">
      <span class="eyebrow">Step 2 — Your creation</span>
      <h2 class="display h3">Upload your AI artwork</h2>

      <div class="dropzone" id="dropzone">
        ${
          hasFile
            ? `
          <div class="file-preview">
            <img src="${state.fileUrl}" alt="Artwork preview" />
            <div class="meta">
              <strong>${esc(state.file.name)}</strong>
              <small>${fmtBytes(state.file.size)} · ${esc(state.file.type)}</small>
              <div class="actions">
                <button type="button" class="btn btn-ghost btn-sm" id="replaceBtn">Replace</button>
                <button type="button" class="btn btn-danger btn-sm" id="removeBtn">Remove</button>
              </div>
            </div>
          </div>`
            : `
          <span class="dz-ico">🖼️</span>
          <strong>Drop your image here</strong>
          <small>JPG / PNG · MAX ${MAX_MB} MB</small>
          <div class="dz-buttons">
            <button type="button" class="btn btn-primary" id="pickBtn">⬆ Upload image</button>
            <button type="button" class="btn btn-ghost mobile-only" id="camBtn">📷 Take photo</button>
            <button type="button" class="btn btn-ghost mobile-only" id="galBtn">🖼️ Choose from gallery</button>
          </div>`
        }
        <input type="file" class="file-input" id="fileDesktop" accept="${OK_TYPES.join(',')}" />
        <input type="file" class="file-input" id="fileCamera" accept="${OK_TYPES.join(',')}" capture="environment" />
        <input type="file" class="file-input" id="fileGallery" accept="${OK_TYPES.join(',')}" />
      </div>

      <p class="hint small muted mt-2" style="text-align:center">
        Only the final generated image. Screenshot of your prompt is not required — you will type it next.
      </p>

      <div class="form-actions">
        <button class="btn btn-ghost btn-lg" id="goBack">← Back</button>
        <button class="btn btn-primary btn-lg" id="goNext" ${hasFile ? '' : 'disabled'}>Continue →</button>
      </div>
    </div>`;
}

function promptStep() {
  const d = state.data;
  const tools = state.meta?.event?.aiTools || [];
  return `
    <div class="card card-pad">
      <span class="eyebrow">Step 3 — Your prompt</span>
      <h2 class="display h3">The words behind the image</h2>

      <div class="field">
        <label for="title">Artwork title</label>
        <input class="input" id="title" data-k="title" value="${esc(d.title)}" placeholder="The Last City on Earth" />
      </div>

      <div class="field">
        <label for="aiTool">AI tool used</label>
        <select class="select" id="aiTool" data-k="aiTool">
          <option value="">Select your tool ▼</option>
          ${tools.map((t) => `<option value="${esc(t)}" ${d.aiTool === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label for="prompt">Original prompt</label>
        <textarea class="textarea tall" id="prompt" data-k="prompt"
          placeholder="Describe the exact prompt you used to generate your final artwork...">${esc(d.prompt)}</textarea>
        <div class="counter"><span id="promptCount">${d.prompt.length}</span> characters</div>
        <div class="hint">Paste it exactly as typed — including parameters, style words and aspect ratios.</div>
      </div>

      <div class="field">
        <label for="concept">What is your concept?</label>
        <textarea class="textarea" id="concept" data-k="concept"
          placeholder="Explain your idea in 2–5 sentences...">${esc(d.concept)}</textarea>
        <div class="hint">Why this image? What were you trying to say?</div>
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost btn-lg" id="goBack">← Back</button>
        <button class="btn btn-primary btn-lg" id="goNext">Preview →</button>
      </div>
    </div>`;
}

function previewStep() {
  const d = state.data;
  const rows = [
    ['Participant', d.participation === 'team' && d.teamName ? `${d.fullName} · ${d.teamName}` : d.fullName],
    ['College', d.college],
    ['Department / Year', `${d.department} · ${d.year}`],
    d.participation === 'team' ? ['Team members', d.teamMembers] : null,
    ['Artwork title', d.title],
    ['AI tool', d.aiTool],
  ].filter(Boolean);

  return `
    <div class="card card-pad">
      <span class="eyebrow">Final step</span>
      <h2 class="display h3">Check your submission</h2>

      <div class="grid grid-2" style="align-items:start">
        <div class="art-frame">
          <img src="${state.fileUrl}" alt="${esc(d.title)}" />
        </div>

        <dl class="kv-list">
          ${rows.map(([k, v]) => `<div class="kv"><dt>${k}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}
        </dl>
      </div>

      <div class="mt-3">
        <div class="label" style="font-size:12.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:9px">Prompt</div>
        <div class="prompt-box">${esc(d.prompt)}</div>
      </div>

      <div class="mt-2">
        <div class="label" style="font-size:12.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:9px">Concept</div>
        <div class="prompt-box concept">${esc(d.concept)}</div>
      </div>

      <div class="divider"></div>

      <label class="confirm-box">
        <input type="checkbox" id="agree" ${state.agree ? 'checked' : ''} />
        <span>
          <strong>⚠️ Final confirmation</strong><br />
          I confirm that this is my original submission and that the prompt and artwork
          information provided is accurate.
        </span>
      </label>

      ${state.submitError
        ? `<div class="notice danger" role="alert" style="margin-top:14px">
             <strong>⚠️ Your entry has NOT been sent</strong><br />${esc(state.submitError)}
           </div>`
        : ''}
      <div class="form-actions">
        <button class="btn btn-ghost btn-lg" id="goBack">← Edit</button>
        <button class="btn btn-primary btn-lg" id="submitBtn"
          ${state.agree && !state.timerExpired ? '' : 'disabled'}>🚀 Submit artwork</button>
      </div>
      ${state.timerExpired
        ? `<p class="muted small center mt-2 mb-0">Locked — start a new session above to submit.</p>`
        : `<p class="muted small center mt-2 mb-0">Your artwork must be uploaded before the timer
             reaches 00:00.</p>`}
    </div>`;
}

function successView() {
  const r = state.result;
  return `
    <div class="success">
      <div class="success-ring">✓</div>
      <h2 class="display h2">Submission Successful!</h2>
      <p class="lead">Your artwork has been submitted to Promptify.</p>

      <div class="id-box">
        <div class="label">Submission ID</div>
        <div class="value">${esc(r.submissionId)}</div>
      </div>

      <div class="receipt">
        <div class="kv"><dt>Participant</dt><dd>${esc(r.participant)}</dd></div>
        <div class="kv"><dt>Artwork</dt><dd>${esc(r.title)}</dd></div>
        <div class="kv"><dt>Submitted</dt><dd>${new Date(r.createdAt).toLocaleString('en-GB')}</dd></div>
        <div class="kv"><dt>Status</dt><dd>${statusBadge(r.status)}</dd></div>
      </div>

      <div class="notice mt-2">
        Save this ID — it is how you check your status, and how the organizers find your entry.
        Your earlier submissions stay exactly as they were:
        <strong>you can submit as many times as you like.</strong>
      </div>

      <div class="form-actions" style="justify-content:center">
        <button class="btn btn-primary btn-lg" id="againBtn">➕ Submit another entry</button>
        <button class="btn btn-gold btn-lg" id="dlBtn">⬇ Download / save ID</button>
        <a class="btn btn-ghost btn-lg" href="#/check">Check status</a>
        <a class="btn btn-ghost btn-lg" href="#/gallery">Browse the gallery</a>
      </div>
    </div>`;
}

/* -------------------------------------------------------- challenge timer */
const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const challengeMinutes = () => state.meta?.challengeMinutes || 30;

/** "30 minutes" / "1 minute" — used everywhere the window length is written out. */
const mins = (n) => `${n} minute${Number(n) === 1 ? '' : 's'}`;

/** Server timing in, local countdown out — only elapsed time is trusted locally. */
function applyTimer(status) {
  state.timer = status;
  state.timerEndsLocal = Date.now() + Math.max(0, status.remainingMs || 0);
  state.timerExpired = !(status.remainingMs > 0);
}

function stopTicker() {
  if (state.tick) clearInterval(state.tick);
  state.tick = null;
}

function startTicker() {
  stopTicker();
  if (!state.timer || state.timerExpired) return;

  state.tick = setInterval(() => {
    const chip = document.getElementById('timerChip');
    if (!chip) return stopTicker(); // user navigated away from the submit page

    const left = state.timerEndsLocal - Date.now();
    const val = document.getElementById('timerVal');
    if (left <= 0) {
      if (val) val.textContent = '00:00';
      chip.classList.add('is-urgent');
      if (!state.timerExpired) {
        state.timerExpired = true;
        stopTicker();
        toast('Time is up — start a new session to submit.', 'error');
        render();
      }
      return;
    }
    if (val) val.textContent = clock(left);
    chip.classList.toggle('is-warn', left <= 5 * 60 * 1000 && left > 60 * 1000);
    chip.classList.toggle('is-urgent', left <= 60 * 1000);
  }, 1000);
}

/** The gate: nothing to fill in until the participant starts the clock. */
function timerGateView() {
  const m = challengeMinutes();
  return `
    <div class="page">
      <div class="container">
        <div class="page-head center">
          <span class="eyebrow" style="justify-content:center">Promptify submission portal</span>
          <h1 class="display">${m}-minute challenge</h1>
          <p class="lead" style="max-width:560px;margin:0 auto">
            Start the clock, create your artwork, and upload it before it runs out.
          </p>
        </div>

        <div class="form-card">
          <div class="card card-pad center">
            <div class="timer-big">
              <span class="tb-ico">⏱</span>
              <span class="tb-val">${clock(m * 60000)}</span>
            </div>

            ${state.timerExpired
              ? `<div class="notice danger mt-2" style="text-align:left">
                   <strong>Time ran out on your last session.</strong> Start a new one for a fresh
                   ${mins(m)} — everything you typed so far is kept.
                 </div>`
              : ''}

            <ul class="timer-rules mt-2">
              <li>Pressing <strong>Start</strong> begins your ${mins(m)} — the deadline is kept on
                the server, so refreshing or closing the page does not give you extra time.</li>
              <li>Use the time to generate your image in your chosen AI tool, then fill in the four
                steps and upload it.</li>
              <li>When it reaches zero the submit button locks. You can start a new session
                afterwards.</li>
            </ul>

            <div class="hero-actions mt-3" style="margin-bottom:0">
              <button class="btn btn-primary btn-lg" id="startTimer">⏱ Start my ${mins(m)}</button>
            </div>

            <p class="muted small mt-3 mb-0">
              Your draft is saved on this device as you go, so a dropped connection does not cost you
              the text you have written.
            </p>
          </div>
        </div>
      </div>
    </div>`;
}

/** Floating countdown shown on every step of the form. */
function timerChipHtml() {
  if (!state.timer || state.result) return '';
  const left = state.timerEndsLocal - Date.now();
  return `
    <div class="timer-chip ${state.timerExpired ? 'is-urgent' : left <= 5 * 60000 ? 'is-warn' : ''}"
         id="timerChip" role="timer" aria-label="Time remaining to submit">
      <span class="t-ico">⏱</span>
      <span class="t-val" id="timerVal">${state.timerExpired ? '00:00' : clock(left)}</span>
      <span class="t-lab">left to create &amp; upload</span>
    </div>`;
}

function expiredNoticeHtml() {
  if (!state.timerExpired || state.result) return '';
  const m = challengeMinutes();
  return `
    <div class="notice danger" style="display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <span><strong>⏱ Time's up.</strong> The ${mins(m)} ran out, so this entry can no longer be
        sent. Start a new session to continue — your draft is kept.</span>
      <button class="btn btn-ghost btn-sm" id="restartTimer">Start new ${mins(m)}</button>
    </div>`;
}

/** Bound on both the gate and the expired notice. */
function bindTimerStart(root) {
  root.querySelectorAll('#startTimer, #restartTimer').forEach((btn) =>
    btn.addEventListener('click', async () => {
      setLoading(btn, true, 'Starting…');
      try {
        const res = await api.post('/timer/start', { deviceToken: store.deviceId });
        applyTimer(res);
        toast(
          res.resumed
            ? `Session already running — ${clock(res.remainingMs)} left.`
            : `${res.minutes}-minute challenge started. Good luck!`,
          res.resumed ? 'info' : 'success'
        );
        render();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setLoading(btn, false);
      }
    })
  );
}

/* ---------------------------------------------------------------- logic */
function validate(step) {
  const d = state.data;
  const bad = (msg, id) => {
    document.getElementById(id)?.closest('.field')?.classList.add('has-error');
    toast(msg, 'error');
    document.getElementById(id)?.focus();
    return false;
  };

  if (step === 0) {
    if (!d.fullName.trim()) return bad('Please enter your full name.', 'fullName');
    if (!d.college.trim()) return bad('Please enter your college or institution.', 'college');
    if (!d.department.trim()) return bad('Please select your department.', 'department');
    if (!d.year) return bad('Please select your year of study.', 'year');
    if (d.participation === 'team' && !d.teamName.trim()) return bad('Please enter a team name.', 'teamName');
  }

  if (step === 1 && !state.file) {
    toast('Please upload your artwork first.', 'error');
    return false;
  }

  if (step === 2) {
    if (!d.title.trim()) return bad('Please give your artwork a title.', 'title');
    if (!d.aiTool.trim()) return bad('Please select the AI tool you used.', 'aiTool');
    if (d.prompt.trim().length < 10) return bad('Please paste the full prompt you used.', 'prompt');
    if (d.concept.trim().length < 10) return bad('Please explain your concept.', 'concept');
  }
  return true;
}

function bindFields(scope) {
  scope.querySelectorAll('[data-k]').forEach((el) => {
    const handler = () => {
      state.data[el.dataset.k] = el.value;
      el.closest('.field')?.classList.remove('has-error');
      if (el.dataset.k === 'prompt') {
        const c = document.getElementById('promptCount');
        if (c) c.textContent = el.value.length;
      }
      saveDraft();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  scope.querySelectorAll('[data-group="year"] .pill-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.data.year = btn.dataset.v;
      btn.parentElement.querySelectorAll('.pill-opt').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      saveDraft();
    });
  });

  scope.querySelectorAll('input[name="participation"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.data.participation = r.value;
      scope.querySelectorAll('.radio-card').forEach((c) => c.classList.toggle('is-active', c.contains(r)));
      const box = scope.querySelector('#teamBox');
      if (box) box.style.display = r.value === 'team' ? '' : 'none';
      saveDraft();
    });
  });
}

function acceptFile(file) {
  if (!file) return;
  if (!OK_TYPES.includes(file.type)) {
    toast('Only JPG and PNG images are accepted.', 'error');
    return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`Image is too large — maximum ${MAX_MB} MB.`, 'error');
    return;
  }
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.file = file;
  state.fileUrl = URL.createObjectURL(file);
  render();
}

function bindUpload(scope) {
  const dz = scope.querySelector('#dropzone');
  const inputs = {
    fileDesktop: scope.querySelector('#fileDesktop'),
    fileCamera: scope.querySelector('#fileCamera'),
    fileGallery: scope.querySelector('#fileGallery'),
  };
  const onPick = (e) => acceptFile(e.target.files?.[0]);

  Object.values(inputs).forEach((i) => i?.addEventListener('change', onPick));

  scope.querySelector('#pickBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    inputs.fileDesktop.click();
  });
  scope.querySelector('#camBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    inputs.fileCamera.click();
  });
  scope.querySelector('#galBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    inputs.fileGallery.click();
  });
  scope.querySelector('#replaceBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    inputs.fileDesktop.click();
  });
  scope.querySelector('#removeBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.file = null;
    state.fileUrl = '';
    render();
  });

  dz?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (!state.file) inputs.fileDesktop.click();
  });
  ['dragenter', 'dragover'].forEach((t) =>
    dz?.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); })
  );
  ['dragleave', 'drop'].forEach((t) =>
    dz?.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('is-over'); })
  );
  dz?.addEventListener('drop', (e) => acceptFile(e.dataTransfer?.files?.[0]));
}

async function submitEntry(btn) {
  if (!state.agree) {
    toast('Please accept the confirmation statement.', 'error');
    return;
  }
  if (state.timerExpired || state.timerEndsLocal - Date.now() <= 0) {
    state.timerExpired = true;
    render();
    toast('Time is up — start a new session to submit.', 'error');
    return;
  }
  const d = state.data;
  const fd = new FormData();
  Object.entries(d).forEach(([k, v]) => fd.append(k, v));
  fd.append('agree', 'true');
  fd.append('deviceToken', store.deviceId);
  fd.append('artwork', state.file, state.file.name);

  setLoading(btn, true, 'Submitting…');
  state.submitError = null;
  try {
    const res = await api.upload('/submissions', fd);
    state.result = res;
    store.lastSubmission = res;
    // the receipt replaces the form, so wipe the used-up inputs at the same
    // moment: coming back to #/submit later must show a blank form, never the
    // details or the image of the entry that was just accepted
    state.file = null;
    state.fileUrl = '';
    state.agree = false;
    state.data = { ...blank };
    clearDraft();
    stopTicker();
    state.timer = null;
    state.step = 3;
    history.replaceState(null, '', '#/submit?done=1');
    render();
    toast(`Submission Successful! ${res.submissionId}`, 'success');
  } catch (err) {
    // the server owns the deadline: it can expire mid-upload
    state.submitError = err.data?.expired
      ? 'Your 30 minutes ran out before the upload finished. Start a new session and try again.'
      : err.message;
    if (err.data?.expired) {
      state.timerExpired = true;
      stopTicker();
    }
    render(); // keep the reason on screen — a toast alone is too easy to miss
    toast(err.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

/**
 * "Submit another entry" — throw away everything from the submission that was
 * just accepted (form values, file, preview, draft) and open a brand-new
 * 30-minute window so the participant can go straight to a blank form.
 * Nothing from the previous entry is reused or overwritten: the server has
 * already given it its own id, and this only resets the local view.
 */
async function startAnother(root) {
  root.dataset.fresh = '1';
  try {
    await api.post('/timer/start', { deviceToken: store.deviceId });
  } catch {
    /* offline: the timer gate at the bottom of submit() will ask to start */
  }
  if (location.hash.startsWith('#/submit?')) history.replaceState(null, '', '#/submit');
  await submit(root);
}

function render() {
  const root = document.getElementById('app');
  const view =
    state.step === 3 && state.result ? successView() : null;

  root.innerHTML = `
    <div class="page">
      <div class="container">
        <div class="page-head center">
          <span class="eyebrow" style="justify-content:center">Promptify submission portal</span>
          <h1 class="display">${state.result ? 'All set.' : 'Submit your artwork'}</h1>
          <p class="lead" style="max-width:560px;margin:0 auto">
            ${state.result ? 'Keep your submission ID safe.' : 'Four short steps. Your draft is saved automatically on this device.'}
          </p>
        </div>
        ${state.result ? '' : stepbar()}
        ${state.result ? '' : expiredNoticeHtml()}
        <div class="form-card">
          ${
            view ||
            [detailsStep, artworkStep, promptStep, previewStep][state.step]()
          }
        </div>
        ${timerChipHtml()}
      </div>
    </div>`;

  const scope = root;

  bindTimerStart(root);
  startTicker();

  if (state.step === 3 && state.result) {
    document.getElementById('dlBtn').addEventListener('click', () => downloadReceipt(state.result));
    document.getElementById('againBtn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      setLoading(btn, true, 'Starting…');
      startAnother(root).finally(() => setLoading(btn, false));
    });
    return;
  }

  bindFields(scope);
  if (state.step === 1) bindUpload(scope);

  scope.querySelector('#goNext')?.addEventListener('click', () => {
    if (!validate(state.step)) return;
    state.step = Math.min(state.step + 1, 3);
    saveDraft();
    render();
  });

  scope.querySelector('#goBack')?.addEventListener('click', () => {
    state.step = Math.max(state.step - 1, 0);
    saveDraft();
    render();
  });

  if (state.step === 3) {
    scope.querySelector('#agree').addEventListener('change', (e) => {
      state.agree = e.target.checked;
      scope.querySelector('#submitBtn').disabled = !e.target.checked || state.timerExpired;
    });
    scope.querySelector('#submitBtn').addEventListener('click', (e) => submitEntry(e.currentTarget));
  }
}

export async function submit(root, params = {}) {
  stopTicker();
  try {
    state.meta = await api.get('/meta');
  } catch {
    state.meta = null;
  }
  loadDraft();

  const done = Boolean(params.query?.get('done'));
  if (!done) {
    state.result = null;
    state.submitError = null;
    if (state.step === 3) state.step = 0;
  }

  // "submit another entry" starts from a completely fresh state
  if (root.dataset.fresh === '1') {
    state.result = null;
    state.submitError = null;
    state.step = 0;
    state.file = null;
    state.fileUrl = '';
    state.agree = false;
    state.data = { ...blank };
    clearDraft();
    delete root.dataset.fresh;
  }

  // Repeat submissions are allowed: holding an earlier ID in this browser
  // never blocks the form. The receipt is shown only while ?done=1 is in the
  // URL, so simply reopening #/submit always gives a clean form.
  if (done && state.result) {
    render();
    return;
  }

  // ---- 30-minute challenge window -------------------------------------
  let status = null;
  try {
    status = await api.get(`/timer/status?device=${encodeURIComponent(store.deviceId)}`);
  } catch {
    /* server unreachable — keep whatever we already know about the clock */
  }

  if (status && !status.active) {
    state.timer = null;
    state.timerExpired = Boolean(status.expired);
    stopTicker();
    root.innerHTML = timerGateView();
    bindTimerStart(root);
    return;
  }
  if (status) applyTimer(status);

  render();
}
