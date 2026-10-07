import { api } from '../api.js';
import { esc } from '../ui.js';

export async function landing(root) {
  let meta = null;
  try { meta = await api.get('/meta'); } catch { /* offline — use defaults */ }
  const open = meta ? meta.submissionsOpen !== false : true;
  const year = meta?.event?.year || new Date().getFullYear();

  root.innerHTML = `
    <section class="hero">
      <div class="container">
        <span class="hero-badge ${open ? '' : 'is-closed'}">
          <span class="dot"></span>${open ? 'Submissions open' : 'Submissions closed'} · ${year} edition
        </span>

        <h1>
          Turn your imagination<br />
          <span class="grad-text">into an image</span>
        </h1>

        <p class="lead">
          Create. Experiment. Prompt. <br class="hide-sm" />
          Let your AI imagination speak — then prove the prompt behind it.
        </p>

        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#/submit">Submit your artwork</a>
          <a class="btn btn-ghost btn-lg" href="#/check">Check submission</a>
          <a class="btn btn-ghost btn-lg" href="#/gallery">Artwork gallery</a>
          <a class="btn btn-ghost btn-lg" href="#/rules">Event rules</a>
        </div>

        <div class="pill-row">
          <div class="pill"><span class="ico">📸</span> AI ARTWORK</div>
          <div class="pill"><span class="ico">✍️</span> PROMPT ENGINEERING</div>
          <div class="pill"><span class="ico">🏆</span> COMPETE</div>
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head center">
          <span class="eyebrow">How it works</span>
          <h2 class="display h2">Scan. Prompt. Submit.</h2>
          <p class="lead">Six steps from your phone to the leaderboard — no forms to hunt for, no links to share.</p>
        </div>

        <div class="flow">
          ${[
            ['01', 'Scan QR', 'Point your camera at the Promptify board.'],
            ['02', 'Your details', 'Name, college, department, year, team.'],
            ['03', 'Upload artwork', 'JPG or PNG, up to 10 MB.'],
            ['04', 'Your prompt', 'The exact words that made the image.'],
            ['05', 'Preview & confirm', 'Check everything, then submit.'],
            ['06', 'Submission ID', 'Get your PF-2026-001 receipt.'],
          ]
            .map(
              ([n, t, d]) => `
              <div class="flow-step">
                <span class="num">${n}</span>
                <strong>${t}</strong>
                <small>${d}</small>
              </div>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">Why Promptify</span>
          <h2 class="display h2">Not just another pretty picture contest</h2>
          <p class="lead">
            Every entry ships with the original prompt and the reasoning behind it. Judges score the
            idea and the instruction — not only the render.
          </p>
        </div>

        <div class="grid grid-3">
          ${[
            ['🖼️', 'Artwork first', 'Upload the final image you generated — JPG or PNG, mobile-friendly, ready in seconds.'],
            ['✍️', 'Prompt engineering', 'Submit the exact prompt, the AI tool you used, and the concept in 2–5 sentences.'],
            ['🔍', 'Authenticity check', 'Organizers compare prompt against artwork, so the event stays about the craft.'],
            ['🔐', 'Three access levels', 'Participants, organizers and judges each see exactly what they should — nothing more.'],
            ['📱', 'Built for the QR scan', 'The whole participant flow is mobile-first, because that is how it will be used.'],
            ['🏆', 'Fair, blinded judging', 'Judges see artwork, prompt and concept — never the name behind them.'],
          ]
            .map(
              ([ico, t, d]) => `
              <article class="feature card-hover">
                <div class="ico">${ico}</div>
                <h3>${t}</h3>
                <p>${d}</p>
              </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="cta-band">
          <span class="eyebrow" style="justify-content:center">Ready?</span>
          <h2 class="display h2">Your turn. Make something only you would prompt.</h2>
          <p class="lead" style="max-width:560px;margin:0 auto 28px">
            It takes about three minutes. Bring your artwork, your prompt and your idea.
          </p>
          <div class="hero-actions" style="margin-bottom:0">
            <a class="btn btn-primary btn-lg" href="#/submit">Submit your artwork</a>
            <a class="btn btn-gold btn-lg" href="#/leaderboard">View leaderboard</a>
          </div>
        </div>
      </div>
    </section>
  `;
}
