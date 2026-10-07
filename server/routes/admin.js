import { safeRouter as Router } from '../safeRouter.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import archiver from 'archiver';
import { config, artUrl } from '../config.js';
import { Submission, STATUS } from '../models/Submission.js';
import { TimerSession } from '../models/TimerSession.js';
import { Score } from '../models/Score.js';
import { User } from '../models/User.js';
import { getSettings } from '../models/Setting.js';
import { requireRole } from '../middleware/auth.js';
import { seedDemo } from '../seed.js';
import { toBuffer } from './submissions.js';

const router = Router();
router.use(requireRole('admin'));

/** submissionId -> { count, total, avg } */
async function scoreSummary(filter = {}) {
  const rows = await Score.aggregate([
    { $match: filter },
    { $group: { _id: '$submissionId', count: { $sum: 1 }, total: { $sum: '$total' } } },
    { $project: { count: 1, total: 1, avg: { $divide: ['$total', '$count'] } } },
  ]);
  const map = new Map();
  for (const r of rows) map.set(r._id, r);
  return map;
}

/** GET /api/admin/stats — dashboard tiles */
router.get('/stats', async (_req, res) => {
  const pipeline = [{ $group: { _id: '$status', n: { $sum: 1 } } }];
  const byStatus = await Submission.aggregate(pipeline);
  const counts = Object.fromEntries(config.statuses.map((s) => [s.key, 0]));
  for (const row of byStatus) counts[row._id] = row.n;

  const total = await Submission.countDocuments();
  const colleges = await Submission.distinct('college');
  const scores = await Score.find().lean();
  const avgScore = scores.length
    ? Math.round((scores.reduce((s, x) => s + x.total, 0) / scores.length) * 10) / 10
    : 0;

  res.json({
    total,
    counts,
    pending: counts.submitted + counts.verifying,
    verified: counts.verified,
    rejected: counts.rejected,
    finalists: counts.finalist,
    colleges: colleges.length,
    judges: await User.countDocuments({ role: 'judge', active: true }),
    scores: scores.length,
    avgScore,
    challengeMinutes: config.event.challengeMinutes,
    activeSessions: await TimerSession.countDocuments({ expiresAt: { $gt: new Date() } }),
    scoringTotal: config.scoring.reduce((s, c) => s + c.max, 0),
  });
});

/**
 * GET /api/admin/timer-sessions — the live challenge clocks.
 *
 * One row per device: when the participant pressed Start, when the 30-minute
 * window closes, and how much of it is left right now. Sessions disappear on
 * their own the moment the entry is uploaded (the submission carries the same
 * times instead).
 */
router.get('/timer-sessions', async (_req, res) => {
  const now = new Date();
  // An expired window stops being interesting quickly — prune it so the panel
  // does not fill with dead rows over a long event day.
  await TimerSession.deleteMany({ expiresAt: { $lt: new Date(now.getTime() - 60 * 60 * 1000) } });

  const rows = await TimerSession.find().sort({ expiresAt: -1 }).limit(200).lean();

  const sessions = rows.map((r) => {
    const remainingMs = new Date(r.expiresAt).getTime() - now.getTime();
    return {
      device: r.deviceToken ? `${String(r.deviceToken).slice(0, 8)}…` : '—',
      startedAt: r.startedAt,
      endsAt: r.expiresAt,
      active: remainingMs > 0,
      remainingMs: Math.max(0, remainingMs),
      updatedAt: r.updatedAt,
    };
  });

  res.json({
    now,
    minutes: config.event.challengeMinutes,
    graceMinutes: config.event.challengeGraceMinutes,
    running: sessions.filter((s) => s.active).length,
    expired: sessions.filter((s) => !s.active).length,
    sessions,
  });
});

/**
 * Query string -> mongo filter. Shared by the list, the CSV export and the
 * ZIP archive so all three always agree on "which entries".
 * `ids=PF-2026-001,PF-2026-002` narrows the set to specific entries.
 */
function listFilter(query = {}) {
  const filter = {};

  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.flag) filter.flags = query.flag;
  const q = String(query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { submissionId: rx },
      { fullName: rx },
      { college: rx },
      { title: rx },
      { teamName: rx },
    ];
  }

  const ids = String(query.ids || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (ids.length) filter.submissionId = { $in: ids };

  return filter;
}

/** GET /api/admin/submissions?status=&q=&page=&limit= */
router.get('/submissions', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = listFilter(req.query);

  const [items, total] = await Promise.all([
    Submission.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Submission.countDocuments(filter),
  ]);

  const summary = await scoreSummary({});
  const data = items.map((doc) => {
    const { artwork, checkToken, deviceToken, ...rest } = doc;
    const s = summary.get(doc.submissionId);
    return {
      ...rest,
      artworkUrl: artUrl(`${doc.submissionId}`),
      score: s ? Math.round(s.avg * 10) / 10 : null,
      judgeCount: s ? s.count : 0,
    };
  });

  res.json({ items: data, total, page, pages: Math.ceil(total / limit) });
});

/** GET /api/admin/submissions/:id — full record for the verification panel */
router.get('/submissions/:id', async (req, res) => {
  const doc = await Submission.findOne({ submissionId: req.params.id.toUpperCase() }).lean();
  if (!doc) return res.status(404).json({ error: 'Submission not found.' });

  const { artwork, checkToken, deviceToken, ...rest } = doc;
  const scores = await Score.find({ submissionId: doc.submissionId })
    .select('judgeName total scores comment createdAt')
    .lean();

  res.json({
    submission: {
      ...rest,
      artworkUrl: artUrl(`${doc.submissionId}`),
      artworkSize: artwork?.size || 0,
      artworkType: artwork?.contentType || '',
    },
    scores,
    scoreAvg: scores.length
      ? Math.round((scores.reduce((s, x) => s + x.total, 0) / scores.length) * 10) / 10
      : null,
  });
});

/** PATCH /api/admin/submissions/:id/status  { status, notes } */
router.patch('/submissions/:id/status', async (req, res) => {
  const id = String(req.params.id).toUpperCase();
  const { status, notes } = req.body || {};
  if (!config.statuses.some((s) => s.key === status)) {
    return res.status(400).json({ error: 'Unknown status.' });
  }

  const update = { status };
  if (typeof notes === 'string') update.organizerNotes = notes;
  if (status === STATUS.VERIFIED) update.verifiedAt = new Date();
  if (status === STATUS.REJECTED) update.rejectedAt = new Date();
  if (status !== STATUS.FINALIST) update.isFinalist = false;

  const doc = await Submission.findOneAndUpdate({ submissionId: id }, update, { new: true });
  if (!doc) return res.status(404).json({ error: 'Submission not found.' });
  res.json({ ok: true, status: doc.status, submission: doc.toPublic() });
});

/** PATCH /api/admin/submissions/:id/flags  { flag, on } — prompt authenticity check */
router.patch('/submissions/:id/flags', async (req, res) => {
  const { flag, on = true } = req.body || {};
  if (!['prompt-mismatch', 'duplicate', 'stock-image', 'low-effort'].includes(flag)) {
    return res.status(400).json({ error: 'Unknown flag.' });
  }
  const update = on ? { $addToSet: { flags: flag } } : { $pull: { flags: flag } };
  const doc = await Submission.findOneAndUpdate(
    { submissionId: String(req.params.id).toUpperCase() },
    update,
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: 'Submission not found.' });
  res.json({ ok: true, flags: doc.flags });
});

/** PATCH /api/admin/submissions/:id/finalist  { isFinalist, award, rank } */
router.patch('/submissions/:id/finalist', async (req, res) => {
  const { isFinalist = false, award = '', rank = 0 } = req.body || {};
  const doc = await Submission.findOneAndUpdate(
    { submissionId: String(req.params.id).toUpperCase() },
    { isFinalist: Boolean(isFinalist), award, finalistRank: Number(rank) || 0 },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: 'Submission not found.' });
  if (doc.isFinalist && doc.status !== STATUS.REJECTED) {
    doc.status = STATUS.FINALIST;
    await doc.save();
  }
  res.json({ ok: true, submission: doc.toPublic() });
});

/** DELETE /api/admin/submissions/:id — remove an entry (with its scores) */
router.delete('/submissions/:id', async (req, res) => {
  const id = String(req.params.id).toUpperCase();
  const doc = await Submission.findOneAndDelete({ submissionId: id });
  if (!doc) return res.status(404).json({ error: 'Submission not found.' });
  await Score.deleteMany({ submissionId: id });
  res.json({ ok: true, deleted: id });
});

/** GET /api/admin/settings */
router.get('/settings', async (_req, res) => res.json(await getSettings()));

/**
 * POST /api/admin/demo-data  { wipe }
 * Loads a sample event (12 entries + judge scores) — handy for rehearsals.
 */
router.post('/demo-data', async (req, res) => {
  const wipe = Boolean(req.body?.wipe);
  await seedDemo({ wipe });
  res.json({
    ok: true,
    submissions: await Submission.countDocuments(),
    scores: await Score.countDocuments(),
  });
});

/** PUT /api/admin/settings */
router.put('/settings', async (req, res) => {  const allowed = [
    'leaderboardRevealed',
    'revealNames',
    'minScores',
    'submissionsOpen',
    'theme',
    'winnerCount',
  ];
  const settings = await getSettings();
  for (const key of allowed) {
    if (key in (req.body || {})) settings[key] = req.body[key];
  }
  settings.minScores = Math.min(5, Math.max(1, Number(settings.minScores) || 1));
  await settings.save();
  res.json(settings);
});

/** CSV shared by /export and the ZIP archive's index file. */
function buildCsv(rows, summary) {
  const head = [
    'Submission ID', 'Name', 'College', 'Department', 'Year', 'Participation',
    'Team', 'Members', 'Title', 'AI Tool', 'Prompt', 'Concept', 'Status',
    'Flags', 'Score', 'Judges', 'Submitted At',
    'Clock Started', 'Challenge Deadline', 'Window (min)', 'Time Used (min)',
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(',')];

  for (const r of rows) {
    const s = summary.get(r.submissionId);
    const iso = (v) => (v ? new Date(v).toISOString() : '');
    const usedMin = r.challengeStartedAt
      ? Math.max(0, Math.round((new Date(r.createdAt).getTime() - new Date(r.challengeStartedAt).getTime()) / 60000))
      : '';
    lines.push(
      [
        r.submissionId, r.fullName, r.college, r.department, r.year, r.participation,
        r.teamName, (r.teamMembers || []).join('; '), r.title, r.aiTool, r.prompt,
        r.concept, r.status, (r.flags || []).join('; '),
        s ? Math.round(s.avg * 10) / 10 : '', s ? s.count : '',
        new Date(r.createdAt).toISOString(),
        iso(r.challengeStartedAt), iso(r.challengeEndsAt),
        r.challengeMinutes ?? '', usedMin,
      ].map(esc).join(',')
    );
  }

  return lines.join('\n');
}

/** GET /api/admin/export — CSV of every entry */
router.get('/export', async (req, res) => {
  const rows = await Submission.find(listFilter(req.query)).sort({ createdAt: 1 }).lean();
  const summary = await scoreSummary({});

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="promptify-submissions.csv"');
  res.send(buildCsv(rows, summary));
});

/* --------------------------------------------------------------------------
 * Artwork archive — one ZIP with every image + its prompt and details
 * ------------------------------------------------------------------------ */

/** Filesystem-safe folder name for one entry. */
function folderName(doc) {
  const raw = `${doc.submissionId} - ${doc.title}`;
  return (
    raw
      .replace(/[\\/:*?"<>|]+/g, '-') // characters Windows/macOS refuse
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90)
      .trim() || doc.submissionId
  );
}

function extensionFor(doc) {
  const type = doc.artwork?.contentType || '';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('bmp')) return '.bmp';
  return '.jpg';
}

/** Judge rubric rows without mongoose's `_id` noise, using the rubric labels. */
function breakdownOf(scores) {
  return Object.entries(scores || {})
    .filter(([k, v]) => k !== '_id' && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const label = config.scoring.find((c) => c.key === k)?.label
        || k.replace(/([A-Z])/g, ' $1').toLowerCase();
      return `${label}: ${v}`;
    })
    .join(', ');
}

/** The plain-text dossier stored next to each artwork in the archive. */
function dossier(doc, scores = [], avg = null) {
  const row = (k, v) => `${k.padEnd(15, ' ')}| ${v ?? ''}`;
  const names = doc.teamMembers?.length ? doc.teamMembers.join(', ') : '—';
  const ist = (v) => new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const created = ist(doc.createdAt);
  const clockStart = doc.challengeStartedAt ? ist(doc.challengeStartedAt) : '';
  const clockEnd = doc.challengeEndsAt ? ist(doc.challengeEndsAt) : '';
  const usedMin = doc.challengeStartedAt
    ? Math.max(0, Math.round((new Date(doc.createdAt) - new Date(doc.challengeStartedAt)) / 60000))
    : null;

  const out = [
    'PROMPTIFY — AI IMAGE GENERATION CHALLENGE',
    '=========================================',
    '',
    row('Submission ID', doc.submissionId),
    row('Status', doc.status),
    row('Submitted', created),
    row('Clock started', clockStart || '—'),
    row('Clock ends', clockEnd || '—'),
    row('Time used', usedMin === null ? '—' : `${usedMin} of ${doc.challengeMinutes ?? '?'} min`),
    row('Award', doc.award || '—'),
    row('Flags', (doc.flags || []).length ? doc.flags.join(', ') : 'none'),
    '',
    'PARTICIPANT',
    '-----------',
    row('Name', doc.fullName),
    row('College', doc.college),
    row('Department', doc.department),
    row('Year', doc.year),
    row('Participation', doc.participation === 'team' ? `Team — ${doc.teamName}` : 'Individual'),
    row('Team members', names),
    doc.email ? row('Email', doc.email) : '',
    doc.phone ? row('Phone', doc.phone) : '',
    '',
    'ARTWORK',
    '-------',
    row('Title', doc.title),
    row('AI tool', doc.aiTool),
    row('File', `${doc.artwork?.filename || 'artwork'}${extensionFor(doc)} (${doc.artwork?.size || 0} bytes)`),
    '',
    'ORIGINAL PROMPT',
    '---------------',
    doc.prompt,
    '',
    'CONCEPT',
    '-------',
    doc.concept,
    '',
    'ORGANIZER NOTES',
    '---------------',
    doc.organizerNotes || '(none)',
    '',
    'JUDGE SCORES',
    '------------',
  ];

  if (scores.length) {
    out.push(row('Average', `${avg}/100 across ${scores.length} judge(s)`), '');
    for (const s of scores) {
      const breakdown = breakdownOf(s.scores);
      out.push(`  - ${s.judgeName}: ${s.total}/100`);
      if (breakdown) out.push(`      ${breakdown}`);
      if (s.comment) out.push(`      "${s.comment}"`);
    }
  } else {
    out.push('No judge has scored this entry yet.');
  }

  out.push('', `Artwork served at: ${artUrl(doc.submissionId)}`, '');
  return out.filter((l) => l !== undefined).join('\n');
}

/**
 * GET /api/admin/export/archive?ids=&status=&q=
 * Streams a ZIP: `<ID> - <title>/artwork.jpg`, `…/details.txt`, `…/details.json`
 * plus an `index.csv` of the whole set. Without `ids` it follows the same
 * status/search filter as the table, so "export what I am looking at" works.
 */
router.get('/export/archive', async (req, res) => {
  const filter = listFilter(req.query);
  const rows = await Submission.find(filter).sort({ createdAt: 1 }).lean();

  if (!rows.length) {
    return res.status(404).json({ error: 'No submissions match this filter.' });
  }

  const ids = rows.map((r) => r.submissionId);
  const [summary, scoreRows] = await Promise.all([
    scoreSummary({}),
    Score.find({ submissionId: { $in: ids } })
      .select('submissionId judgeName total scores comment createdAt')
      .lean(),
  ]);
  const scoresByEntry = new Map();
  for (const s of scoreRows) {
    if (!scoresByEntry.has(s.submissionId)) scoresByEntry.set(s.submissionId, []);
    scoresByEntry.get(s.submissionId).push(s);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const zipName =
    rows.length === 1
      ? `promptify-${rows[0].submissionId}.zip`
      : `promptify-artworks-${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  let finished = false;
  archive.on('warning', (err) => console.warn('! archive warning:', err.message));
  archive.on('error', (err) => {
    console.error('! archive error:', err.message);
    if (!res.headersSent) res.status(500);
    res.destroy(err);
  });
  // client cancelled the download mid-stream — stop compressing for nothing
  res.on('close', () => {
    if (!finished) archive.abort();
  });
  archive.pipe(res);

  archive.append(buildCsv(rows, summary), { name: 'index.csv' });

  const seen = new Set();
  for (const doc of rows) {
    const folder = folderName(doc);
    const unique = seen.has(folder) ? `${folder} (${doc.submissionId})` : folder;
    seen.add(unique);

    const buf = toBuffer(doc.artwork?.data);
    if (buf?.length) {
      archive.append(buf, { name: `${unique}/artwork${extensionFor(doc)}` });
    } else {
      archive.append('(artwork payload missing)', { name: `${unique}/artwork-MISSING.txt` });
    }

    const entryScores = scoresByEntry.get(doc.submissionId) || [];
    const avg = entryScores.length
      ? Math.round((entryScores.reduce((s, x) => s + x.total, 0) / entryScores.length) * 10) / 10
      : null;

    archive.append(dossier(doc, entryScores, avg), { name: `${unique}/details.txt` });
    archive.append(
      JSON.stringify(
        {
          submissionId: doc.submissionId,
          status: doc.status,
          submittedAt: doc.createdAt,
          participant: {
            fullName: doc.fullName,
            college: doc.college,
            department: doc.department,
            year: doc.year,
            participation: doc.participation,
            teamName: doc.teamName || '',
            teamMembers: doc.teamMembers || [],
            email: doc.email || '',
            phone: doc.phone || '',
          },
          artwork: {
            title: doc.title,
            aiTool: doc.aiTool,
            filename: doc.artwork?.filename,
            contentType: doc.artwork?.contentType,
            size: doc.artwork?.size || 0,
            url: artUrl(doc.submissionId),
          },
          prompt: doc.prompt,
          concept: doc.concept,
          theme: doc.theme || '',
          flags: doc.flags || [],
          organizerNotes: doc.organizerNotes || '',
          isFinalist: Boolean(doc.isFinalist),
          award: doc.award || '',
          scores: entryScores.map((s) => ({
            judge: s.judgeName,
            total: s.total,
            breakdown: Object.fromEntries(
              Object.entries(s.scores || {}).filter(([k]) => k !== '_id')
            ),
            comment: s.comment || '',
            at: s.createdAt,
          })),
          scoreAverage: avg,
        },
        null,
        2
      ),
      { name: `${unique}/details.json` }
    );
  }

  await archive.finalize();
  finished = true;
});

// ---------------------------------------------------------------------------
// Judge accounts
// ---------------------------------------------------------------------------
router.get('/judges', async (_req, res) => {
  const judges = await User.find({ role: 'judge' }).select('-passwordHash').lean();
  const counts = await Score.aggregate([
    { $group: { _id: '$judge', n: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(judges.map((j) => ({ ...j, scoresSubmitted: map.get(String(j._id)) || 0 })));
});

router.post('/judges', async (req, res) => {
  const { username, password, name, title = '' } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, display name and password are required.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const exists = await User.findOne({ username: String(username).toLowerCase() });
  if (exists) return res.status(409).json({ error: 'That username is already taken.' });

  const user = await User.create({
    username,
    name,
    title,
    role: 'judge',
    passwordHash: await bcrypt.hash(password, 10),
  });
  res.status(201).json({ id: user._id, username: user.username, name: user.name, title: user.title });
});

router.patch('/judges/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id.' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Judge not found.' });
  if ('active' in (req.body || {})) user.active = Boolean(req.body.active);
  if ('password' in (req.body || {})) {
    if (String(req.body.password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    user.passwordHash = await bcrypt.hash(req.body.password, 10);
  }
  await user.save();
  res.json({ ok: true, active: user.active });
});

export default router;
