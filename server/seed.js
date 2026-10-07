import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { Submission } from './models/Submission.js';
import { Score } from './models/Score.js';
import { User } from './models/User.js';
import { Counter } from './models/Counter.js';
import { getSettings } from './models/Setting.js';

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export async function ensureSeed() {
  const count = await User.countDocuments();

  if (count === 0) {
    await User.create({
      username: config.admin.username,
      passwordHash: await bcrypt.hash(config.admin.password, 10),
      name: 'Event Organizer',
      role: 'admin',
      title: 'Promptify Admin',
    });

    const judges = [
      { username: 'judge1', name: 'Ananya Rao', title: 'Judge · Design' },
      { username: 'judge2', name: 'Kabir Menon', title: 'Judge · AI Research' },
      { username: 'judge3', name: 'Sara Iqbal', title: 'Judge · Creative Tech' },
    ];
    for (const j of judges) {
      await User.create({
        ...j,
        role: 'judge',
        passwordHash: await bcrypt.hash('judge2026', 10),
      });
    }
    console.log('✔ Accounts created');
    console.log(`   admin  ${config.admin.username} / ${config.admin.password}`);
    console.log('   judge  judge1|judge2|judge3 / judge2026');
  }

  await getSettings();
}

/* -------------------------------------------------------------------------- */
/* Placeholder artwork (SVG so the demo looks real without binary assets)      */
/* -------------------------------------------------------------------------- */

const PALETTES = [
  ['#7c5cff', '#35e0ff', '#0a0a18'],
  ['#ff7a59', '#ffc857', '#160f1d'],
  ['#00e5a0', '#0ea5e9', '#04121a'],
  ['#f472b6', '#a78bfa', '#12081c'],
  ['#facc15', '#f97316', '#1a1206'],
  ['#22d3ee', '#818cf8', '#060b1e'],
];

function svgArtwork(title, seed) {
  const [a, b, bg] = PALETTES[seed % PALETTES.length];
  let rnd = (seed + 1) * 9301;
  const rand = () => {
    rnd = (rnd * 9301 + 49297) % 233280;
    return rnd / 233280;
  };

  const blobs = Array.from({ length: 5 }, () => {
    const cx = Math.round(rand() * 800);
    const cy = Math.round(rand() * 600);
    const r = Math.round(60 + rand() * 180);
    const op = (0.18 + rand() * 0.4).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${rand() > 0.5 ? a : b}" opacity="${op}" filter="url(#blur)"/>`;
  }).join('');

  const lines = Array.from({ length: 7 }, (_, i) => {
    const y = 60 + i * 78;
    const x2 = Math.round(120 + rand() * 620);
    return `<line x1="40" y1="${y}" x2="${x2}" y2="${y + 40}" stroke="${b}" stroke-width="1.5" opacity="0.35"/>`;
  }).join('');

  const safe = String(title).replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <filter id="blur"><feGaussianBlur stdDeviation="34"/></filter>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="${bg}"/>
  ${blobs}${lines}
  <rect x="0" y="470" width="800" height="130" fill="#000" opacity="0.42"/>
  <rect x="40" y="440" width="70" height="4" fill="url(#g)"/>
  <text x="40" y="512" font-family="Helvetica,Arial,sans-serif" font-size="34" font-weight="700" fill="#ffffff" letter-spacing="1">${safe.slice(0, 34)}</text>
  <text x="40" y="546" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="#ffffff" opacity="0.62" letter-spacing="4">PROMPTIFY · AI IMAGE GENERATION CHALLENGE</text>
</svg>`;

  const data = Buffer.from(svg, 'utf8');
  return { data, contentType: 'image/svg+xml', filename: `${safe}.svg`, size: data.length };
}

/* -------------------------------------------------------------------------- */
/* Demo entries                                                                */
/* -------------------------------------------------------------------------- */

const DEMO = [
  {
    fullName: 'Madhan Sachin', college: 'ABC Engineering College', department: 'CSE', year: '3rd',
    participation: 'individual', title: 'The Universe in One Frame', aiTool: 'ChatGPT',
    prompt: 'A single photograph containing an entire universe inside a glass marble held by a child, ultra detailed, cinematic lighting, 8k, volumetric rays, photorealistic skin texture, shallow depth of field.',
    concept: 'The idea is that everything we will ever know fits inside a moment of curiosity. I wanted the marble to act as a lens through which infinity becomes small enough to hold.',
    status: 'judging_completed',
  },
  {
    fullName: 'Ishita Nair', college: 'XYZ Institute of Technology', department: 'IT', year: '2nd',
    participation: 'team', teamName: 'Neon Collective', teamMembers: 'Ishita Nair, Rohan Das',
    title: 'Future City at Blue Hour', aiTool: 'Midjourney',
    prompt: 'Vertical megacity at blue hour, monsoon reflections on chrome walkways, holographic signage in an invented language, drone traffic lanes, matte painting, --ar 3:4 --stylize 400',
    concept: 'A city that grew upwards instead of outwards because the ground was flooded. The invented signage is meant to make the viewer feel like a tourist in their own future.',
    status: 'verified',
  },
  {
    fullName: 'Arjun Varma', college: 'ABC Engineering College', department: 'ECE', year: '4th',
    participation: 'individual', title: 'Ocean of Code', aiTool: 'Leonardo AI',
    prompt: 'An underwater library where the books are made of flowing source code, god rays from the surface, bioluminescent dust, wide angle, concept art, trending on artstation',
    concept: 'Knowledge as something you swim through rather than read. Each glowing glyph represents a line of code that someone once struggled with.',
    status: 'verified', flags: [],
  },
  {
    fullName: 'Priya Krishnan', college: 'State University', department: 'DESIGN', year: '3rd',
    participation: 'individual', title: 'The Last City on Earth', aiTool: 'Adobe Firefly',
    prompt: 'Post apocalyptic city reclaimed by forest, last surviving tower wrapped in vines, golden hour haze, painterly, hopeful mood, no people',
    concept: 'Most apocalypse art is grim. I wanted the ending to feel like a beginning, so the light is warm and the plants are winning.',
    status: 'submitted',
  },
  {
    fullName: 'Dev Patel', college: 'XYZ Institute of Technology', department: 'AI & DS', year: '1st',
    participation: 'individual', title: 'Machine Dreams', aiTool: 'Gemini',
    prompt: 'A robot sleeping under a tree made of circuit boards, soft rim light, storybook illustration style, pastel palette, gentle shadows',
    concept: 'If machines could dream, would they dream of us? The circuit tree suggests that their imagination would still be built from what we taught them.',
    status: 'submitted',
  },
  {
    fullName: 'Sneha Reddy', college: 'ABC Engineering College', department: 'MECH', year: '2nd',
    participation: 'team', teamName: 'Pixel Forge', teamMembers: 'Sneha Reddy, Tanvi Shah, Aman Joshi',
    title: 'Festival of Lights', aiTool: 'ChatGPT',
    prompt: 'Traditional street festival with thousands of floating lanterns, warm tungsten glow, crowd silhouettes, long exposure light trails, 35mm film grain',
    concept: 'We wanted to prove that AI can hold cultural detail rather than flatten it — the lantern shapes and the street architecture are specific, not generic.',
    status: 'verified',
  },
  {
    fullName: 'Rahul Menon', college: 'State University', department: 'EEE', year: '4th',
    participation: 'individual', title: 'Silicon Garden', aiTool: 'Stable Diffusion',
    prompt: 'Macro photograph of flowers blooming from a motherboard, dew drops on capacitors, teal and magenta lighting, extremely detailed',
    concept: 'Technology and nature are usually framed as opposites. This is a third option: a garden that happens to be made of silicon.',
    status: 'rejected', organizerNotes: 'Looks reused from a public gallery — asked the participant for the raw prompt history.',
    flags: ['stock-image'],
  },
  {
    fullName: 'Meera Joseph', college: 'XYZ Institute of Technology', department: 'CIVIL', year: '3rd',
    participation: 'individual', title: 'Bridge Between Worlds', aiTool: 'Midjourney',
    prompt: 'A stone bridge connecting two floating islands, waterfalls pouring into clouds below, epic scale, matte painting, volumetric fog, --ar 16:9',
    concept: 'The bridge is deliberately unfinished on one side. Progress rarely arrives complete.',
    status: 'verified',
  },
  {
    fullName: 'Karthik Subramani', college: 'ABC Engineering College', department: 'IT', year: '2nd',
    participation: 'individual', title: 'Echoes of the Mind', aiTool: 'DALL·E',
    prompt: 'Portrait made of overlapping translucent faces, each expressing a different emotion, dark background, gallery lighting, fine art photography style',
    concept: 'Emotions do not take turns. This portrait shows them layered on top of each other the way they actually arrive.',
    status: 'submitted',
  },
  {
    fullName: 'Zoya Ahmed', college: 'State University', department: 'CSE', year: '1st',
    participation: 'individual', title: 'Deep Field', aiTool: 'Adobe Firefly',
    prompt: 'Telescope deep field image of a galaxy shaped like a human eye, stars as iris details, scientific illustration meets surrealism, ultra sharp',
    concept: 'We keep looking out into space to find out where we came from. The eye is not a metaphor so much as a reminder that observation changes the observer.',
    status: 'verified',
  },
  {
    fullName: 'Nikhil Sharma', college: 'XYZ Institute of Technology', department: 'OTHER', year: '4th',
    participation: 'individual', title: 'Paper Metropolis', aiTool: 'Leonardo AI',
    prompt: 'Entire city folded from white paper, single warm desk lamp as only light source, visible fold creases, macro tilt shift, studio product photography',
    concept: 'Everything around us began as a flat sheet and a set of instructions — much like a prompt.',
    status: 'verifying',
  },
  {
    fullName: 'Ananya Iyer', college: 'ABC Engineering College', department: 'DESIGN', year: '3rd',
    participation: 'team', teamName: 'Half Tone', teamMembers: 'Ananya Iyer, Vikram Bose',
    title: 'Memory Palace', aiTool: 'ChatGPT',
    prompt: 'Endless corridor of doors each opening into a different childhood room, impossible geometry, warm nostalgic colour grade, cinematic wide shot',
    concept: 'Memory is architectural. We walk through it room by room and rearrange the furniture every time we revisit it.',
    status: 'judging_completed',
  },
];

/** Loads demo submissions + judge scores. Safe to run repeatedly on an empty DB. */
export async function seedDemo({ wipe = false } = {}) {
  if (wipe) {
    await Submission.deleteMany({});
    await Score.deleteMany({});
    await Counter.deleteOne({ _id: 'submission' });
    console.log('✔ Wiped submissions and scores');
  }

  if ((await Submission.countDocuments()) > 0) {
    console.log('• Submission data already present — nothing to do.');
    console.log('  Use `npm run reset` first if you want to start clean.');
    return;
  }

  const created = [];
  for (const [i, entry] of DEMO.entries()) {
    const doc = await Submission.create({
      ...entry,
      submissionId: `${config.event.idPrefix}-${config.event.year}-${String(i + 1).padStart(3, '0')}`,
      checkToken: `demo${i}tokenpromptify`,
      theme: 'Turning Imagination Into An Image',
      email: '',
      phone: '',
      teamMembers: entry.teamMembers
        ? entry.teamMembers.split(',').map((m) => m.trim())
        : [],
      artwork: svgArtwork(entry.title, i),
      verifiedAt: ['verified', 'judging_completed', 'finalist'].includes(entry.status)
        ? new Date(Date.now() - 86400000)
        : undefined,
      rejectedAt: entry.status === 'rejected' ? new Date() : undefined,
    });
    created.push(doc);
  }

  await Counter.findOneAndUpdate(
    { _id: 'submission' },
    { seq: DEMO.length },
    { upsert: true }
  );

  // judges score everything that reached the verified stage
  const judges = await User.find({ role: 'judge' }).sort({ username: 1 }).limit(3);
  const scorable = created.filter((d) =>
    ['verified', 'judging_completed', 'finalist'].includes(d.status)
  );

  const rubric = [
    [23, 18, 19, 14, 9, 9],
    [20, 17, 16, 13, 9, 8],
    [25, 20, 20, 15, 10, 10],
    [21, 16, 18, 12, 8, 9],
    [19, 15, 17, 13, 9, 7],
    [24, 19, 18, 14, 9, 9],
  ];
  const keys = config.scoring.map((c) => c.key);

  let n = 0;
  for (const sub of scorable) {
    for (const judge of judges) {
      const row = rubric[n % rubric.length];
      const scores = Object.fromEntries(keys.map((k, i) => [k, row[i]]));
      const total = row.reduce((s, v) => s + v, 0);
      await Score.create({
        submission: sub._id,
        submissionId: sub.submissionId,
        judge: judge._id,
        judgeName: judge.name,
        scores,
        total,
        comment: n % 3 === 0 ? 'Strong concept, the prompt clearly drove the result.' : '',
      });
      n += 1;
    }
  }

  console.log(`✔ Seeded ${DEMO.length} submissions and ${n} judge scores`);
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                          */
/* -------------------------------------------------------------------------- */

const isCli = process.argv[1] && process.argv[1].endsWith('seed.js');

if (isCli) {
  const { connectDB, disconnectDB } = await import('./db.js');
  const args = process.argv.slice(2);
  try {
    await connectDB();
    await ensureSeed();
    if (args.includes('--wipe')) {
      await Submission.deleteMany({});
      await Score.deleteMany({});
      await Counter.deleteOne({ _id: 'submission' });
      console.log('✔ All submissions and scores removed.');
    } else if (args.includes('--demo') || args.includes('--force')) {
      await seedDemo({ wipe: true });
    } else {
      await seedDemo({ wipe: false });
    }
    process.exitCode = 0;
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}
