import { safeRouter as Router } from '../safeRouter.js';
import QRCode from 'qrcode';
import { config, artUrl, baseUrl } from '../config.js';
import { Submission, STATUS } from '../models/Submission.js';
import { Score } from '../models/Score.js';
import { getSettings } from '../models/Setting.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/leaderboard
 * Returns nothing but IDs and scores until the organizer reveals the board.
 * Names appear only when `revealNames` is switched on.
 */
router.get('/leaderboard', async (req, res) => {
  const settings = await getSettings();
  const isAdmin = req.auth?.role === 'admin' && req.query.preview === '1';

  if (!settings.leaderboardRevealed && !isAdmin) {
    return res.json({
      revealed: false,
      revealNames: false,
      entries: [],
      judged: await Score.countDocuments(),
      totalEntries: await Submission.countDocuments(),
      note: 'The leaderboard will be revealed after the official announcement.',
    });
  }

  const agg = await Score.aggregate([
    { $group: { _id: '$submissionId', judges: { $sum: 1 }, total: { $sum: '$total' } } },
    { $project: { judges: 1, avg: { $divide: ['$total', '$judges'] } } },
    { $sort: { avg: -1 } },
  ]);

  const subs = await Submission.find({ submissionId: { $in: agg.map((a) => a._id) } })
    .select('submissionId title fullName college department year participation teamName teamMembers status isFinalist award flags artwork')
    .lean();

  const subMap = new Map(subs.map((s) => [s.submissionId, s]));

  const entries = [];
  let rank = 0;
  for (const row of agg) {
    const sub = subMap.get(row._id);
    if (!sub || sub.status === 'rejected') continue;
    rank += 1;
    entries.push({
      rank,
      submissionId: row._id,
      score: Math.round(row.avg * 10) / 10,
      judges: row.judges,
      title: sub.title,
      isFinalist: sub.isFinalist,
      award: sub.award,
      artworkUrl: artUrl(`${row._id}`),
      flags: sub.flags,
      participant: settings.revealNames || isAdmin
        ? {
            name: sub.fullName,
            college: sub.college,
            department: sub.department,
            year: sub.year,
            participation: sub.participation,
            teamName: sub.teamName,
            teamMembers: sub.teamMembers,
          }
        : null,
    });
  }

  res.json({
    revealed: true,
    revealNames: settings.revealNames || isAdmin,
    preview: Boolean(isAdmin),
    entries,
    scoring: config.scoring,
    scoringTotal: config.scoring.reduce((s, c) => s + c.max, 0),
    judged: await Score.countDocuments(),
    totalEntries: await Submission.countDocuments(),
  });
});

/**
 * GET /api/gallery?page=&limit=
 * The artwork gallery participants browse. Only released entries show up —
 * submitted / under-verification / rejected stay private, and names follow
 * the same reveal switch as the leaderboard.
 */
const GALLERY_STATUSES = [STATUS.VERIFIED, STATUS.JUDGING_COMPLETED, STATUS.FINALIST];

router.get('/gallery', async (req, res) => {
  const settings = await getSettings();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));

  const released = { status: { $in: GALLERY_STATUSES } };
  const [rows, total, awaiting] = await Promise.all([
    Submission.find(released)
      .select(
        'submissionId title aiTool status isFinalist award createdAt ' +
          'fullName college department year participation teamName'
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Submission.countDocuments(released),
    Submission.countDocuments({ status: { $in: [STATUS.SUBMITTED, STATUS.VERIFYING] } }),
  ]);

  res.json({
    revealNames: settings.revealNames,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    awaiting,
    items: rows.map((r) => ({
      submissionId: r.submissionId,
      title: r.title,
      aiTool: r.aiTool,
      status: r.status,
      isFinalist: r.isFinalist,
      award: r.award || '',
      createdAt: r.createdAt,
      artworkUrl: artUrl(r.submissionId),
      participant: settings.revealNames
        ? {
            name: r.fullName,
            college: r.college,
            department: r.department,
            year: r.year,
            participation: r.participation,
            teamName: r.teamName,
          }
        : null,
    })),
  });
});

/**
 * GET /api/qr?path=/#/submit
 * Generates the event QR code as a PNG (no external services involved).
 */
router.get('/qr', async (req, res) => {
  const path = String(req.query.path || '/#/submit');
  const base = baseUrl(req);
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  const width = Math.min(1200, Math.max(180, Number(req.query.size) || 480));
  const dark = String(req.query.dark || '#0a0a12').replace(/^#/, '');
  const light = String(req.query.light || '#ffffff').replace(/^#/, '');

  try {
    const png = await QRCode.toBuffer(url, {
      type: 'png',
      width,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: `#${dark}`, light: `#${light}` },
    });
    res.set('Content-Type', 'image/png');
    res.set('X-QR-URL', url); // so operators can verify what a code encodes
    res.set('Cache-Control', 'public, max-age=600');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: 'Could not generate QR code.' });
  }
});

/** Admin preview of the board before it goes live. */
router.get('/leaderboard/admin', requireRole('admin'), async (_req, res) => {
  res.json(await getSettings());
});

export default router;
