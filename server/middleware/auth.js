import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';

export function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role, name: user.name, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/** Reads `Authorization: Bearer <jwt>` and attaches req.user. Never throws. */
export function loadUser(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.auth = verifyToken(token);
  } catch {
    /* expired / tampered token → treated as anonymous */
  }
  next();
}

/** Gate a route behind one or more roles: requireRole('admin') | requireRole('admin','judge') */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Login required.', code: 'UNAUTHENTICATED' });
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'You do not have access to this area.', code: 'FORBIDDEN' });
    }
    next();
  };
}

export async function findUser(id) {
  return User.findById(id).select('-passwordHash');
}
