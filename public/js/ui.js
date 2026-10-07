/* UI helpers: escaping, rendering, toasts, modals, status badges. */

export const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const STATUS = {
  submitted: { label: 'Submitted', emoji: '🟡', cls: 'badge-amber' },
  verifying: { label: 'Under Verification', emoji: '🔵', cls: 'badge-blue' },
  verified: { label: 'Verified', emoji: '🟢', cls: 'badge-green' },
  rejected: { label: 'Rejected', emoji: '🔴', cls: 'badge-red' },
  judging_completed: { label: 'Judging Completed', emoji: '🟣', cls: 'badge-purple' },
  finalist: { label: 'Finalist', emoji: '🏆', cls: 'badge-gold' },
};

export function statusBadge(status) {
  const s = STATUS[status] || { label: status, emoji: '•', cls: 'badge-neutral' };
  return `<span class="badge ${s.cls}"><span class="dot"></span>${esc(s.label)}</span>`;
}

export function fmtDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('en-GB', opts).replace(',', ' ·');
}

export const fmtBytes = (n) => {
  if (!n) return '0 KB';
  return n < 1024 * 1024
    ? `${Math.round(n / 1024)} KB`
    : `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/* ---------------------------------------------------------------- toasts */
export function toast(message, type = 'info') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  const ico = type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ';
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ico">${ico}</span><span>${esc(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

/* ----------------------------------------------------------------- modal */
export function closeModal() {
  const root = document.getElementById('modalRoot');
  root.hidden = true;
  root.innerHTML = '';
  document.body.style.overflow = '';
}

export function modal({ title, body = '', foot = '', wide = false, onClose } = {}) {
  const root = document.getElementById('modalRoot');
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="${wide ? 'width:min(980px,100%)' : ''}">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close" data-close aria-label="Close">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;

  const close = () => { closeModal(); onClose?.(); };
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); }, { once: true });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return close;
}

export function confirmDialog(message, { title = 'Are you sure?', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = modal({
      title,
      body: `<p style="margin:0;color:var(--muted)">${esc(message)}</p>`,
      foot: `
        <button class="btn btn-ghost btn-sm" data-close>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" data-yes>${esc(confirmText)}</button>`,
      onClose: () => resolve(false),
    });
    document.querySelector('[data-yes]')?.addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
  });
}

/* ------------------------------------------------------------ form utils */
export function setLoading(btn, loading, loadingText = 'Working…') {
  if (!btn) return;
  if (loading) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${esc(loadingText)}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

/** Marks the first invalid field and returns a readable message. */
export function firstInvalid(form, rules) {
  for (const [selector, test] of rules) {
    const el = form.querySelector(selector);
    if (!el) continue;
    const wrap = el.closest('.field') || el.parentElement;
    const ok = test(el);
    wrap?.classList.toggle('has-error', !ok);
    if (!ok) {
      el.focus?.();
      return el.dataset.error || 'Please complete the highlighted field.';
    }
  }
  return null;
}

export function inputVal(selector, fallback = '') {
  return document.querySelector(selector)?.value?.trim() ?? fallback;
}

/* -------------------------------------------------- receipt / ID download */
export function downloadReceipt(entry) {
  const w = 1000;
  const h = 620;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0a0b14');
  bg.addColorStop(1, '#141032');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // decorative glows
  const glow = (x, y, r, color) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(140, 90, 340, 'rgba(124,92,255,.55)');
  glow(880, 520, 340, 'rgba(53,224,255,.4)');
  glow(500, 300, 420, 'rgba(255,200,87,.16)');

  g.strokeStyle = 'rgba(255,255,255,.18)';
  g.lineWidth = 3;
  g.strokeRect(40, 40, w - 80, h - 80);

  g.fillStyle = '#35e0ff';
  g.font = '700 24px Space Grotesk, Arial';
  g.textAlign = 'center';
  g.letterSpacing = '10px';
  g.fillText('SUBMISSION ID', w / 2, 160);

  g.fillStyle = '#ffc857';
  g.font = '700 96px Space Grotesk, Arial';
  g.letterSpacing = '6px';
  g.fillText(entry.submissionId, w / 2, 280);

  g.letterSpacing = '0px';
  g.fillStyle = '#eef1f8';
  g.font = '600 30px Inter, Arial';
  g.fillText(entry.participant || entry.title, w / 2, 360);

  g.fillStyle = 'rgba(238,241,248,.65)';
  g.font = '400 24px Inter, Arial';
  const title = entry.title ? `“${entry.title}”` : '';
  g.fillText([title, entry.college].filter(Boolean).join('  ·  '), w / 2, 405);

  // status pill
  const status = (entry.status || 'submitted').replace('_', ' ');
  g.font = '700 22px Inter, Arial';
  const label = `STATUS: ${status.toUpperCase()}`;
  const tw = g.measureText(label).width + 56;
  const px = (w - tw) / 2;
  g.fillStyle = 'rgba(52,211,153,.16)';
  g.strokeStyle = 'rgba(52,211,153,.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(px, 450, tw, 54, 27);
  g.fill();
  g.stroke();
  g.fillStyle = '#7ef0c8';
  g.fillText(label, w / 2, 485);

  g.fillStyle = 'rgba(255,255,255,.5)';
  g.font = '700 20px Inter, Arial';
  g.letterSpacing = '6px';
  g.fillText('PROMPTIFY · IMAGINE. PROMPT. CREATE.', w / 2, 555);

  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `Promptify-${entry.submissionId}.png`;
  a.click();
}

/** Triggers a text/CSV file download. */
export function downloadText(text, filename, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Saves a binary response (ZIP, image, PDF) as a file. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const placeholder = (label) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#11131c"/><text x="200" y="155" font-family="sans-serif" font-size="17" fill="#5b6377" text-anchor="middle">${label}</text></svg>`
  )}`;
