import { esc, toast } from '../ui.js';

export async function qrBoard(root) {
  const origin = location.origin;
  const qrSrc = `${origin}/api/qr?path=${encodeURIComponent('/#/submit')}&size=520`;

  root.innerHTML = `
    <div class="page">
      <div class="container">
        <div class="page-head center">
          <span class="eyebrow" style="justify-content:center">Station display</span>
          <h1 class="display">QR submission board</h1>
          <p class="lead" style="max-width:600px;margin:0 auto">
            Print this page or cast it to the venue screen. Participants scan it with their
            phone camera and land straight in the submission portal.
          </p>
        </div>

        <div class="qr-board">
          <div class="qr-kicker">Scan to submit</div>
          <h2>Submit your artwork</h2>
          <div class="qr-sub">Promptify · AI Image Generation Challenge</div>

          <div class="qr-frame">
            <span class="corner c1"></span><span class="corner c2"></span>
            <span class="corner c3"></span><span class="corner c4"></span>
            <img src="${qrSrc}" alt="QR code linking to the Promptify submission portal"
                 onerror="this.src='/api/qr?path=%2F%2F%23%2Fsubmit&size=520'" />
          </div>

          <div class="qr-brand">PROMPTIFY</div>
          <div class="qr-steps">
            <span>Scan</span><span>•</span><span>Upload</span><span>•</span><span>Submit</span>
          </div>

          <div class="qr-actions" style="print:hidden">
            <button class="btn btn-primary" id="printBtn">🖨 Print board</button>
            <button class="btn btn-ghost" id="copyBtn">🔗 Copy portal link</button>
            <a class="btn btn-ghost" href="#/submit">Open portal</a>
          </div>
        </div>

        <div class="grid grid-3 mt-3">
          ${[
            ['📱', 'Works on any phone', 'No app install — the stock camera app opens the portal directly.'],
            ['🎟', 'Instant ID', 'Participants walk away with a PF-2026-001 receipt on screen.'],
            ['🔁', 'Unlimited scans', 'The same board handles every participant, all day.'],
          ]
            .map(([ico, t, d]) => `
              <article class="feature">
                <div class="ico">${ico}</div>
                <h3>${t}</h3>
                <p>${d}</p>
              </article>`)
            .join('')}
        </div>

        <div class="notice mt-3">
          <strong>Station checklist:</strong> print A3 or larger · place at eye level · keep a charged
          spare phone for participants who need help · submission IDs are shown on screen instantly.
        </div>
      </div>
    </div>`;

  root.querySelector('#printBtn').addEventListener('click', () => window.print());
  root.querySelector('#copyBtn').addEventListener('click', async () => {
    const link = `${origin}/#/submit`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Portal link copied to clipboard.', 'success');
    } catch {
      window.prompt('Copy this link:', link);
    }
  });
}
