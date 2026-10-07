import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;

export const config = {
  root,
  port: Number(env('PORT', '3000')),
  publicUrl: env('PUBLIC_URL').replace(/\/+$/, ''),
  mongoUri: env('MONGODB_URI'),
  /**
   * Optional: DNS servers for this process only (comma separated), e.g.
   * `10.0.0.1,8.8.8.8`. Needed when Node's resolver is broken — some Windows
   * setups hand Node a loopback DNS server that refuses every query, which
   * makes `mongodb+srv://…` fail instantly with `querySrv ECONNREFUSED`.
   * Leave blank to use the system resolver.
   */
  dnsServers: env('DNS_SERVERS'),
  dbPath: path.resolve(root, env('DB_PATH', './data')),
  jwtSecret: env('JWT_SECRET', 'promptify-change-me-in-production'),
  jwtExpiresIn: '12h',
  /**
   * Print demo credentials on the login screens. Off by default — an event
   * site must never publish a password. Set LOGIN_HINTS=true while rehearsing.
   */
  showLoginHints: env('LOGIN_HINTS', 'false') === 'true',
  admin: {
    username: env('ADMIN_USERNAME', 'admin'),
    password: env('ADMIN_PASSWORD', 'promptify2026'),
  },
  event: {
    name: 'PROMPTIFY',
    tagline: 'AI IMAGE GENERATION CHALLENGE',
    motto: 'Imagine. Prompt. Create.',
    year: Number(env('EVENT_YEAR', '2026')),
    idPrefix: 'PF',
    maxUploadMb: 10,
    acceptedTypes: ['image/jpeg', 'image/png'],
    /**
     * The challenge window: a participant starts a session, creates the
     * artwork, and must finish the upload inside this many minutes.
     * The extra `challengeGraceMinutes` covers the upload itself, so somebody
     * who presses submit at 29:59 is not rejected because the file took a
     * moment to travel.
     */
    challengeMinutes: Math.max(1, Number(env('CHALLENGE_MINUTES', '30')) || 30),
    challengeGraceMinutes: Math.max(0, Number(env('CHALLENGE_GRACE_MINUTES', '2')) || 0),
    departments: [
      'CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AI & DS', 'DESIGN', 'OTHER',
    ],
    aiTools: [
      'ChatGPT', 'Gemini', 'Midjourney', 'Adobe Firefly',
      'Leonardo AI', 'Stable Diffusion', 'DALL·E', 'Other',
    ],
  },
  scoring: [
    { key: 'creativity', label: 'Creativity', max: 25 },
    { key: 'promptQuality', label: 'Prompt Quality', max: 20 },
    { key: 'originality', label: 'Originality', max: 20 },
    { key: 'visualQuality', label: 'Visual Quality', max: 15 },
    { key: 'themeRelevance', label: 'Theme Relevance', max: 10 },
    { key: 'aiUtilization', label: 'AI Utilization', max: 10 },
  ],
  statuses: [
    { key: 'submitted', label: 'Submitted', emoji: '🟡', color: 'amber' },
    { key: 'verifying', label: 'Under Verification', emoji: '🔵', color: 'blue' },
    { key: 'verified', label: 'Verified', emoji: '🟢', color: 'green' },
    { key: 'rejected', label: 'Rejected', emoji: '🔴', color: 'red' },
    { key: 'judging_completed', label: 'Judging Completed', emoji: '🟣', color: 'purple' },
    { key: 'finalist', label: 'Finalist', emoji: '🏆', color: 'gold' },
  ],
};

export const scoringTotal = config.scoring.reduce((sum, c) => sum + c.max, 0);
export const statusKeys = config.statuses.map((s) => s.key);

/** Bump when the artwork response format changes, so caches refresh themselves. */
export const ART_VERSION = '2';
export const artUrl = (id) => `/api/artwork/${encodeURIComponent(id)}?v=${ART_VERSION}`;

const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s));

/** Every non-loopback IPv4 this machine currently holds. */
function localIPv4s() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

/**
 * The URL a phone must type to reach this server — what goes into the QR code.
 *
 * Priority:
 *   1. PUBLIC_URL, but only while it still points at *this* machine. DHCP hands
 *      out a new address every time you join a different hotspot, and a stale
 *      one prints a dead link on every poster — so an IP that is no longer ours
 *      is ignored (with a warning) rather than encoded.
 *   2. The host the organizer is browsing from, if it is not loopback — always
 *      current, because they had to reach us through it.
 *   3. This machine's first LAN address.
 *   4. localhost (development only — phones can never use this).
 */
export function baseUrl(req) {
  const configured = config.publicUrl;
  if (configured) {
    let hostname = '';
    try {
      hostname = new URL(configured).hostname;
    } catch {
      hostname = '';
    }
    if (!hostname || !isIPv4(hostname) || localIPv4s().includes(hostname)) return configured;
    console.warn(`⚠ PUBLIC_URL points at ${hostname}, which this machine no longer has — ignoring it`);
  }

  if (req) {
    const host = req.get('host');
    if (host && !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(host)) {
      return `${req.protocol}://${host}`;
    }
  }

  const ip = localIPv4s()[0];
  if (ip) return `http://${ip}:${config.port}`;
  return `http://localhost:${config.port}`;
}
