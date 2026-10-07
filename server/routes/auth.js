import { safeRouter as Router } from '../safeRouter.js';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { signToken, requireRole } from '../middleware/auth.js';

const router = Router();

/** POST /api/auth/login  { username, password } */
router.post('/login', async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  // Trim both halves: usernames are stored lowercase, and passwords come from
  // .env (already trimmed by config.js) — so a stray space picked up while
  // copying credentials must not lock an organizer out mid-event.
  const name = String(username).trim().toLowerCase();
  const secret = String(password).trim();

  // A database blip must NEVER be reported as "wrong password" — that sends
  // organizers hunting for a typo that isn't there. Say what actually happened.
  let user;
  try {
    user = await User.findOne({ username: name });
  } catch (e) {
    console.error('✖ login could not reach the database:', e.message);
    return res
      .status(503)
      .json({ error: 'Cannot reach the database right now — wait a few seconds and try again.' });
  }

  const ok = user && user.active && (await bcrypt.compare(secret, user.passwordHash));
  if (!ok) {
    // Server-side reason only — never log or return which half was wrong.
    const reason = !user ? 'unknown user' : !user.active ? 'account deactivated' : 'wrong password';
    console.warn(`✖ login rejected for "${name}" (${reason})`);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Recording the sign-in time is nice-to-have; a hiccup here must not cost
  // the organizer a working session.
  try {
    user.lastLoginAt = new Date();
    await user.save();
  } catch (e) {
    console.warn('⚠ could not record lastLoginAt:', e.message);
  }

  res.json({
    token: signToken(user),
    user: { id: user._id, username: user.username, name: user.name, role: user.role, title: user.title },
  });
});

/** GET /api/auth/me — who am I? */
router.get('/me', requireRole('admin', 'judge'), (req, res) => {
  res.json({ user: req.auth });
});

export default router;
