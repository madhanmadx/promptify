import { api } from '../api.js';
import { esc } from '../ui.js';

export async function rules(root) {
  let scoring = [];
  let total = 100;
  try {
    const meta = await api.get('/meta');
    scoring = meta.scoring || [];
    total = meta.scoringTotal || 100;
  } catch { /* static fallback below */ }

  if (!scoring.length) {
    scoring = [
      { key: 'creativity', label: 'Creativity', max: 25 },
      { key: 'promptQuality', label: 'Prompt Quality', max: 20 },
      { key: 'originality', label: 'Originality', max: 20 },
      { key: 'visualQuality', label: 'Visual Quality', max: 15 },
      { key: 'themeRelevance', label: 'Theme Relevance', max: 10 },
      { key: 'aiUtilization', label: 'AI Utilization', max: 10 },
    ];
  }

  const section = (n, title, body) => `
    <section class="card card-pad" style="margin-bottom:20px">
      <span class="eyebrow">${n}</span>
      <h2 class="display h3">${title}</h2>
      ${body}
    </section>`;

  const ul = (items) =>
    `<ul style="color:var(--muted);padding-left:20px;margin:0">${items.map((i) => `<li style="margin-bottom:8px">${i}</li>`).join('')}</ul>`;

  root.innerHTML = `
    <div class="page">
      <div class="container">
        <div class="page-head">
          <span class="eyebrow">Read before you submit</span>
          <h1 class="display">Event rules</h1>
          <p class="lead" style="max-width:680px">
            Promptify rewards the thinking behind the image. A beautiful render with a borrowed
            prompt will score lower than a modest image that clearly came from great instructions.
          </p>
        </div>

        <div style="max-width:860px">
          ${section('01', 'Eligibility & entry', ul([
            'Open to currently enrolled students — carry your college ID on event day.',
            'Enter as many times as you like — each submission stands alone as its own entry (max 4 members per team).',
            'Register through the submission portal only. Google Forms and WhatsApp entries are not accepted.',
            'Every submission gets its own unique <strong>PF-YYYY-NNN</strong> ID — keep them all.',
          ]))}

          ${section('02', 'Artwork requirements', ul([
            'File format: <strong>JPG or PNG</strong>, maximum <strong>10 MB</strong>.',
            'The image must be AI-generated. Traditional digital edits may be used for minor cleanup only.',
            'No explicit, hateful or plagiarised content of any kind.',
            'The submitted image must be the final version you intend to present.',
            'Mobile uploads are welcome — you can shoot straight from the portal.',
          ]))}

          ${section('03', 'The prompt requirement', `
            <p class="lead" style="font-size:1rem">
              This is what separates Promptify from a normal AI-art competition. Alongside the image
              you must submit three things:
            </p>
            ${ul([
              'The <strong>exact original prompt</strong> you used — copy-paste, do not rewrite it later.',
              'The <strong>AI tool</strong> you used (ChatGPT, Gemini, Midjourney, Firefly, Leonardo, etc.).',
              'Your <strong>concept</strong> explained in 2–5 sentences.',
            ])}
            <div class="notice warn mt-2">
              🔎 <strong>Prompt authenticity check.</strong> Organizers compare your prompt against the
              artwork. Mismatched, generic or reused prompts are flagged and can be rejected.
            </div>
          `)}

          ${section('04', 'Judging rubric', `
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Category</th><th class="right">Maximum</th></tr></thead>
                <tbody>
                  ${scoring.map((c) => `<tr><td>${esc(c.label)}</td><td class="right"><strong>${c.max}</strong></td></tr>`).join('')}
                  <tr><td><strong>Total</strong></td><td class="right"><strong style="color:var(--cyan)">${total}</strong></td></tr>
                </tbody>
              </table>
            </div>
            <p class="muted small mt-2 mb-0">
              Each judge scores independently. Scores are averaged across all assigned judges.
              Judges never see participant names while scoring.
            </p>
          `)}

          ${section('05', 'Pipeline & statuses', `
            <div class="timeline">
              <div class="timeline-item is-done"><div class="node">🟡</div><div class="t-body"><strong>Submitted</strong><small>Entry received, ID generated.</small></div></div>
              <div class="timeline-item"><div class="node">🔵</div><div class="t-body"><strong>Under Verification</strong><small>Organizer checks artwork, prompt and authenticity.</small></div></div>
              <div class="timeline-item"><div class="node">🟢</div><div class="t-body"><strong>Verified</strong><small>Released to the judge dashboard.</small></div></div>
              <div class="timeline-item"><div class="node">🟣</div><div class="t-body"><strong>Judging Completed</strong><small>All required judges have scored the entry.</small></div></div>
              <div class="timeline-item"><div class="node">🏆</div><div class="t-body"><strong>Finalist</strong><small>Selected by the organizers at the end of judging.</small></div></div>
            </div>
          `)}

          ${section('06', 'Disqualification', ul([
            'Submitting someone else\u2019s artwork or prompt as your own.',
            'Providing a prompt that was not actually used to generate the image.',
            'Multiple entries under different names.',
            'Harassment, NSFW content or misuse of any AI tool\u2019s terms of service.',
            'Editing an entry after verification without organizer approval.',
          ]))}

          <div class="cta-band center">
            <h2 class="display h3">Understood everything?</h2>
            <div class="hero-actions mt-2" style="margin-bottom:0">
              <a class="btn btn-primary" href="#/submit">Submit your artwork</a>
              <a class="btn btn-ghost" href="#/check">Check status</a>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}
