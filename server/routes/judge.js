import { safeRouter as Router } from '../safeRouter.js';
import { config, artUrl } from '../config.js';
import { Submission, STATUS } from '../models/Submission.js';
import { Score } from '../models/Score.js';
import { getSettings } from '../models/Setting.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireRole('judge', 'admin'));

/** Statuses a judge is allowed to score. */
const SCORABLE = [STATUS.VERIFIED, STATUS.JUDGING_COMPLETED, STATUS.FINALIST];

/**
 * GET /api/judge/queue
 * Anonymised list — no name, no college, nothing that could bias scoring.
 */
router.get('/queue', async (req, res) => {
  const filter = { status: { $in: SCORABLE } };
  if (req.query.status) filter.status = req.query.status;

  const [subs, mine, allCounts] = await Promise.all([
    Submission.find(filter).sort({ createdAt: 1 }).lean(),
    Score.find({ judge: req.auth.id }).lean(),
    Score.aggregate([
      { $group: { _id: '$submissionId', n: { $sum: 1 } } },
    ]),
  ]);

  const myMap = new Map(mine.map((s) => [s.submissionId, s]));
  const countMap = new Map(allCounts.map((c) => [c._id, c.n]));
  const settings = await getSettings();

  const items = subs.map((s) => ({
    submissionId: s.submissionId,
    title: s.title,
    aiTool: s.aiTool,
    prompt: s.prompt,
    concept: s.concept,
    theme: s.theme,
    status: s.status,
    flags: s.flags,
    artworkUrl: artUrl(`${s.submissionId}`),
    createdAt: s.createdAt,
    myScore: myMap.get(s.submissionId)?.total ?? null,
    myScores: myMap.get(s.submissionId)?.scores ?? null,
    scoreCount: countMap.get(s.submissionId) || 0,
    minScores: settings.minScores,
  }));

  res.json({
    items,
    totals: {
      available: items.length,
      scored: items.filter((i) => i.myScore !== null).length,
      pending: items.filter((i) => i.myScore === null).length,
    },
    scoring: config.scoring,
    scoringTotal: config.scoring.reduce((s, c) => s + c.max, 0),
  });
});

/** GET /api/judge/queue/:id — one entry in full, still anonymised. */
router.get('/queue/:id', async (req, res) => {
  const submissionId = String(req.params.id).toUpperCase();
  const sub = await Submission.findOne({ submissionId, status: { $in: SCORABLE } });
  if (!sub) return res.status(404).json({ error: 'Submission not found or not open for judging.' });

  const mine = await Score.findOne({ submission: sub._id, judge: req.auth.id }).lean();
  const others = mine
    ? await Score.find({ submission: sub._id, judge: { $ne: req.auth.id } })
        .select('judgeName total scores comment')
        .lean()
    : [];

  const all = await Score.find({ submission: sub._id }).select('total').lean();

  res.json({
    submission: sub.toAnonymised(),
    myScore: mine
      ? { total: mine.total, scores: mine.scores, comment: mine.comment }
      : null,
    others,
    scoreCount: all.length,
    average: all.length
      ? Math.round((all.reduce((s, x) => s + x.total, 0) / all.length) * 10) / 10
      : null,
    scoring: config.scoring,
    scoringTotal: config.scoring.reduce((s, c) => s + c.max, 0),
  });
});

/**
 * POST /api/judge/scores
 * { submissionId, scores: { creativity: 22, ... }, comment }
 */
router.post('/scores', async (req, res) => {
  const { submissionId, scores = {}, comment = '' } = req.body || {};
  const sub = await Submission.findOne({ submissionId: String(submissionId || '').toUpperCase() });
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });
  if (!SCORABLE.includes(sub.status)) {
    return res.status(409).json({ error: 'This entry is not open for judging.' });
  }

  const clean = {};
  let total = 0;
  for (const cat of config.scoring) {
    const raw = scores[cat.key];
    if (raw === undefined || raw === null || raw === '') {
      return res.status(400).json({ error: `Please score "${cat.label}".` });
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > cat.max) {
      return res.status(400).json({ error: `"${cat.label}" must be between 0 and ${cat.max}.` });
    }
    clean[cat.key] = Math.round(value * 10) / 10;
    total += clean[cat.key];
  }
  total = Math.round(total * 10) / 10;

  const score = await Score.findOneAndUpdate(
    { submission: sub._id, judge: req.auth.id },
    {
      $set: {
        submission: sub._id,
        submissionId: sub.submissionId,
        judge: req.auth.id,
        judgeName: req.auth.name,
        scores: clean,
        total,
        comment: String(comment).slice(0, 1000),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Move the pipeline forward once enough judges have scored.
  const settings = await getSettings();
  const count = await Score.countDocuments({ submission: sub._id });
  if (count >= settings.minScores && sub.status === STATUS.VERIFIED) {
    sub.status = STATUS.JUDGING_COMPLETED;
    await sub.save();
  }

  res.status(201).json({ ok: true, total, scoreCount: count, minScores: settings.minScores });
});

/** GET /api/judge/scores/mine — everything I have scored so far. */
router.get('/scores/mine', async (req, res) => {
  const mine = await Score.find({ judge: req.auth.id }).sort({ createdAt: -1 }).lean();
  const totals = await Score.aggregate([
    { $match: { judge: req.auth._id ?? undefined } },
    { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$total' } } },
  ]);
  res.json({
    items: mine.map((s) => ({
      submissionId: s.submissionId,
      total: s.total,
      scores: s.scores,
      comment: s.comment,
      at: s.createdAt,
    })),
    count: mine.length,
    averageGiven: totals[0]?.avg ? Math.round(totals[0].avg * 10) / 10 : 0,
  });
});

export default router;
