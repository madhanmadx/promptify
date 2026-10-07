import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { config } from './config.js';
import { connectDB, disconnectDB } from './db.js';
import { loadUser } from './middleware/auth.js';
import { ensureSeed } from './seed.js';

import authRoutes from './routes/auth.js';
import submissionRoutes from './routes/submissions.js';
import adminRoutes from './routes/admin.js';
import judgeRoutes from './routes/judge.js';
import publicRoutes from './routes/public.js';

const app = express();

app.disable('x-powered-by');
// Behind Render/NGINX this makes req.protocol report https, so the QR code
// never encodes an http:// link to an https site.
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// minimal safety headers
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use('/api', loadUser);

// Audit every API write. At a live event the question is always "did the
// participant's entry arrive?" — so record status, the server's own message
// and where it came from, for successes AND rejections alike.
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const t0 = Date.now();
  const original = res.json.bind(res);
  res.json = (body) => {
    try {
      const ok = res.statusCode < 400;
      const detail =
        (body && (body.error || body.submissionId || body.username || body.message)) || '';
      const line = `${ok ? '✓' : '✖'} ${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${detail} · ${req.ip} · ${Date.now() - t0}ms`;
      (ok ? console.log : console.warn)(line);
    } catch {
      /* logging must never break a response */
    }
    return original(body);
  };
  next();
});

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, event: config.event.name, time: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api', submissionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/judge', judgeRoutes);
app.use('/api', publicRoutes);

// unknown API route
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// frontend
const publicDir = path.join(config.root, 'public');
app.use(express.static(publicDir, { index: 'index.html', etag: true, maxAge: 0 }));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

// central error handler
app.use((err, _req, res, _next) => {
  console.error('✖', err.message);
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: err.message || 'Unexpected server error.' });
});

async function main() {
  await connectDB();
  await ensureSeed();

  // last-resort guards: log, never crash the event
  process.on('unhandledRejection', (err) => console.error('✖ unhandled rejection:', err));
  process.on('uncaughtException', (err) => console.error('✖ uncaught exception:', err));

  const server = app.listen(config.port, () => {
    console.log('');
    console.log('  ┌──────────────────────────────────────────────┐');
    console.log('  │  PROMPTIFY  ·  AI Image Generation Challenge │');
    console.log('  └──────────────────────────────────────────────┘');
    console.log(`  Participant  http://localhost:${config.port}/`);
    console.log(`  Organizer    http://localhost:${config.port}/#/admin`);
    console.log(`  Judge        http://localhost:${config.port}/#/judge`);
    console.log(`  Leaderboard  http://localhost:${config.port}/#/leaderboard`);
    console.log('');
  });

  const shutdown = async () => {
    server.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
