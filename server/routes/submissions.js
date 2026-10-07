import { safeRouter as Router } from '../safeRouter.js';
import crypto from 'node:crypto';
import multer from 'multer';
import { config, scoringTotal, artUrl, baseUrl } from '../config.js';
import { Submission, STATUS } from '../models/Submission.js';
import { TimerSession } from '../models/TimerSession.js';
import { Counter } from '../models/Counter.js';
import { Setting } from '../models/Setting.js';
import { getSettings } from '../models/Setting.js';

const router = Router();

/**
 * MongoDB may hand back a Buffer, a BSON Binary, an ArrayBuffer view or the
 * JSON-flavoured `{ type: 'Buffer', data: [...] }` shape depending on whether
 * the query was lean. Normalise all of them.
 */
export function toBuffer(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);

  // BSON Binary ({ _bsontype: 'Binary', buffer, position })
  if (value.buffer != null) {
    const inner = ArrayBuffer.isView(value.buffer)
      ? Buffer.from(value.buffer.buffer, value.buffer.byteOffset, value.buffer.byteLength)
      : Buffer.isBuffer(value.buffer)
        ? value.buffer
        : Buffer.from(value.buffer);
    const end = typeof value.position === 'number' ? value.position : inner.length;
    return inner.subarray(0, Math.min(end, inner.length));
  }

  if (Array.isArray(value.data)) return Buffer.from(value.data);

  try {
    return Buffer.from(value);
  } catch {
    return null;
  }
}

/** Public event metadata consumed by the frontend. */
router.get('/meta', async (req, res) => {
  const settings = await getSettings();
  res.json({
    event: config.event,
    scoring: config.scoring,
    scoringTotal,
    statuses: config.statuses,
    loginHints: config.showLoginHints,
    submissionsOpen: settings.submissionsOpen,
    leaderboardRevealed: settings.leaderboardRevealed,
    challengeMinutes: config.event.challengeMinutes,
    challengeGraceMinutes: config.event.challengeGraceMinutes,
    // Where a phone must go. `localhost` here means the QR board would be
    // unscannable — the board shows a warning until PUBLIC_URL is set.
    portalUrl: baseUrl(req),
    publicUrlConfigured: Boolean(config.publicUrl),
  });
});

// -------------------------------------------------------------------------
// Upload handling — memory storage, 10 MB, JPG/PNG only
// -------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.event.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!config.event.acceptedTypes.includes(file.mimetype)) {
      return cb(new Error('Only JPG and PNG images are accepted.'));
    }
    cb(null, true);
  },
});

// naive per-IP throttle so a single device cannot flood the event
const hits = new Map();
function throttle(limit = 12, windowMs = 10 * 60 * 1000) {
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= limit) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}

const YEARS = ['1st', '2nd', '3rd', '4th'];
const FLAGS = ['prompt-mismatch', 'duplicate', 'stock-image', 'low-effort'];

function validate(body) {
  const required = ['fullName', 'college', 'department', 'year', 'title', 'aiTool', 'prompt', 'concept'];
  for (const field of required) {
    if (!String(body[field] ?? '').trim()) return `${field} is required.`;
  }
  if (!YEARS.includes(body.year)) return 'Please select a valid year.';
  if (body.participation === 'team' && !String(body.teamName ?? '').trim()) {
    return 'Team name is required for team participation.';
  }
  if (String(body.prompt).trim().length < 10) return 'Please paste the full prompt you used.';
  if (String(body.concept).trim().length < 10) return 'Please explain your concept (min. 10 characters).';
  if (String(body.agree) !== 'true' && body.agree !== true) {
    return 'You must confirm the originality declaration.';
  }
  return null;
}

/* ----------------------------------------------------------- challenge timer */

const minutesMs = (n) => Math.round(Number(n) * 60 * 1000);

/** The countdown the client renders — all times come from the server clock. */
function timerView(session) {
  const now = Date.now();
  const remainingMs = Math.max(0, session.expiresAt.getTime() - now);
  return {
    active: remainingMs > 0,
    expired: remainingMs <= 0,
    minutes: config.event.challengeMinutes,
    graceMinutes: config.event.challengeGraceMinutes,
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    remainingMs,
    serverTime: new Date(now).toISOString(),
  };
}

const emptyTimer = () => ({
  active: false,
  expired: false,
  minutes: config.event.challengeMinutes,
  graceMinutes: config.event.challengeGraceMinutes,
});

/**
 * POST /api/timer/start  { deviceToken }
 * Starts the 30-minute window, or returns the one already running. A live
 * session is never reset from here — the only ways to get fresh time are to
 * let it run out or to submit.
 */
router.post('/timer/start', async (req, res) => {
  const deviceToken = String(req.body?.deviceToken || '').trim();
  if (deviceToken.length < 8) {
    return res.status(400).json({ error: 'This browser is not identified. Refresh the page and try again.' });
  }

  const now = new Date();
  const existing = await TimerSession.findOne({ deviceToken });
  if (existing && existing.expiresAt.getTime() > now.getTime()) {
    return res.json({ ...timerView(existing), resumed: true });
  }

  const session = await TimerSession.findOneAndUpdate(
    { deviceToken },
    {
      $set: {
        startedAt: now,
        expiresAt: new Date(now.getTime() + minutesMs(config.event.challengeMinutes)),
        submissions: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.status(201).json({ ...timerView(session), resumed: false });
});

/** GET /api/timer/status?device=… — what this browser's session looks like. */
router.get('/timer/status', async (req, res) => {
  const deviceToken = String(req.query.device || '').trim();
  if (deviceToken.length < 8) return res.json(emptyTimer());

  const session = await TimerSession.findOne({ deviceToken });
  if (!session) return res.json(emptyTimer());
  res.json(timerView(session));
});

/** Case-insensitive whole-string match with the regex metacharacters escaped. */
const exact = (value) => {
  const s = String(value ?? '').trim();
  return new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
};

/**
 * One entry per participant — enforced server-side, not just in the UI.
 * A new entry conflicts with an existing one when it is the same person
 * (name + college), the same email, a team member who already entered, or the
 * same device. Returns the blocking submission, or null when the way is clear.
 */
async function findExistingEntry(body, deviceToken) {
  const name = String(body.fullName || '').trim();
  const college = String(body.college || '').trim();
  if (!name || !college) return null;

  const conds = [{ fullName: exact(name), college: exact(college) }];

  const email = String(body.email || '').trim();
  if (email) conds.push({ email: exact(email) });

  if (deviceToken) conds.push({ deviceToken });

  if (body.participation === 'team') {
    for (const raw of String(body.teamMembers || '').split(/[,;\n]/)) {
      const member = raw.trim();
      if (member && member.toLowerCase() !== name.toLowerCase()) {
        conds.push({ fullName: exact(member), college: exact(college) });
      }
    }
  }

  return Submission.findOne({ $or: conds })
    .select('submissionId fullName status createdAt')
    .lean();
}

/**
 * POST /api/submissions  (multipart/form-data)
 * Fields: fullName, college, department, year, participation, teamName,
 *         teamMembers, title, aiTool, prompt, concept, theme, agree, artwork
 */
router.post('/submissions', throttle(), (req, res) => {
  upload.single('artwork')(req, res, async (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Image is too large. Maximum size is ${config.event.maxUploadMb} MB.`
          : err.message;
      return res.status(400).json({ error: msg });
    }

    try {
      const settings = await getSettings();
      if (!settings.submissionsOpen) {
        return res.status(403).json({ error: 'Submissions are currently closed.' });
      }

      const problem = validate(req.body || {});
      if (problem) return res.status(400).json({ error: problem });

      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Please upload your artwork (JPG or PNG).' });

      const deviceToken = String(req.body.deviceToken || '').trim();
      const existing = await findExistingEntry(req.body, deviceToken);
      if (existing) {
        return res.status(409).json({
          error:
            `One entry per participant — an entry for this person already exists as ` +
            `${existing.submissionId}. Use Check Submission to view it, or contact the ` +
            `organizer if it needs to be replaced.`,
          submissionId: existing.submissionId,
          status: existing.status,
        });
      }

      // ---- the 30-minute challenge window -------------------------------
      const session = deviceToken ? await TimerSession.findOne({ deviceToken }) : null;
      const m = config.event.challengeMinutes;
      if (!session) {
        return res.status(403).json({
          error: `Start your ${m}-minute challenge timer before uploading.`,
          timerRequired: true,
        });
      }
      const graceMs = minutesMs(config.event.challengeGraceMinutes);
      if (Date.now() > session.expiresAt.getTime() + graceMs) {
        return res.status(403).json({
          error:
            `Time is up — the ${m}-minute window to create and upload your artwork has expired. ` +
            `Start a new session to try again.`,
          expired: true,
          expiresAt: session.expiresAt.toISOString(),
        });
      }

      const seq = await Counter.findByIdAndUpdate(
        { _id: 'submission' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      const submissionId = `${config.event.idPrefix}-${config.event.year}-${String(seq.seq).padStart(3, '0')}`;
      const checkToken = crypto.randomBytes(18).toString('hex');

      const teamMembers = String(req.body.teamMembers || '')
        .split(/[,;\n]/)
        .map((m) => m.trim())
        .filter(Boolean);

      const doc = await Submission.create({
        submissionId,
        checkToken,
        deviceToken,
        fullName: String(req.body.fullName).trim(),
        college: String(req.body.college).trim(),
        department: String(req.body.department).trim(),
        year: req.body.year,
        participation: req.body.participation === 'team' ? 'team' : 'individual',
        teamName: String(req.body.teamName || '').trim(),
        teamMembers,
        email: String(req.body.email || '').trim(),
        phone: String(req.body.phone || '').trim(),
        title: String(req.body.title).trim(),
        aiTool: String(req.body.aiTool).trim(),
        prompt: String(req.body.prompt).trim(),
        concept: String(req.body.concept).trim(),
        theme: String(req.body.theme || '').trim(),
        artwork: {
          data: Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer),
          contentType: file.mimetype,
          filename: file.originalname || 'artwork',
          size: file.size,
        },
        status: STATUS.SUBMITTED,
        // the 30-minute window this entry was made in — the organizer reads
        // these back on the dashboard as "started → submitted"
        challengeStartedAt: session.startedAt,
        challengeEndsAt: session.expiresAt,
        challengeMinutes: config.event.challengeMinutes,
      });

      // the window is spent — a later attempt needs a fresh one
      if (deviceToken) await TimerSession.deleteOne({ deviceToken });

      res.status(201).json({
        submissionId: doc.submissionId,
        checkToken: doc.checkToken,
        status: doc.status,
        title: doc.title,
        participant: doc.fullName,
        college: doc.college,
        createdAt: doc.createdAt,
      });
    } catch (error) {
      console.error('submission error:', error);
      res.status(500).json({ error: 'Something went wrong while saving your entry. Please try again.' });
    }
  });
});

/**
 * GET /api/submissions/check/:id?token=...
 * Without the token you only get the public status. With it you see everything.
 */
router.get('/submissions/check/:id', async (req, res) => {
  const id = String(req.params.id || '').trim().toUpperCase();
  const doc = await Submission.findOne({ submissionId: id }).lean();
  if (!doc) return res.status(404).json({ error: 'No submission found with that ID.' });

  const tokenMatches = req.query.token && req.query.token === doc.checkToken;

  const base = {
    submissionId: doc.submissionId,
    status: doc.status,
    title: doc.title,
    submittedAt: doc.createdAt,
    artworkUrl: artUrl(`${doc.submissionId}`),
    owned: Boolean(tokenMatches),
  };

  if (!tokenMatches) return res.json(base);

  const { checkToken, artwork, deviceToken, ...details } = doc;
  res.json({
    ...base,
    details: {
      ...details,
      teamMembers: doc.teamMembers || [],
    },
  });
});

/** The image itself. */
router.get('/artwork/:id', async (req, res) => {
  const id = String(req.params.id || '').trim().toUpperCase();
  const doc = await Submission.findOne({ submissionId: id })
    .select('artwork')
    .lean();
  if (!doc?.artwork?.data) return res.status(404).send('Not found');

  const buf = toBuffer(doc.artwork.data);
  if (!buf || !buf.length) {
    console.warn(`! artwork payload empty for ${id} (${typeof doc.artwork.data})`);
    return res.status(404).send('Not found');
  }

  res.set('Content-Type', doc.artwork.contentType);
  // artworks are immutable per submission but revalidate so a fixed cache
  // never keeps serving an old/empty response
  res.set('Cache-Control', 'no-cache');
  res.send(buf);
});

export { FLAGS };
export default router;
