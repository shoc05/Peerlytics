// Load env from the project ROOT .env regardless of the cwd the server is launched from.
// (The .env lives one level up from /backend; loading the bare 'dotenv/config' only finds it
// when started from root, which silently dropped HF_API_KEY/VWT_API_KEY when run from /backend
// and made AI/writing analysis intermittently show "unavailable".)
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
const __dirnameSrv = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirnameSrv, '..', '.env') });
import express from 'express';
import cors from 'cors';
import checkRouter from './routes/check.js';
import analyzeRouter from './routes/analyze.js';
import { createAuthRouter } from './src/auth/routes.js';
import { startDeadlineReminders } from './services/reminderService.js';
import { startServerDeadlines } from './src/jobs/deadlines/index.js';
import { createExtensionRouter } from './src/jobs/deadlines/extensions.js';
import { createMetrics } from './src/metrics/index.js';

const { createApp } = await import('./app.js');
const { createDb } = await import('./db/pool.js');
const { startDeadlineReminders } = await import('./services/reminderService.js');
const { startServerDeadlines } = await import('./src/jobs/deadlines/index.js');

const config = loadConfig();

// ── Startup config validation: warn clearly if analysis API keys are missing or
// look like unreplaced placeholders, so failures aren't silent. The server still starts —
// analysis falls back gracefully ("AI checker not available") on any provider error.
const missing = missingProviderKeys();
if (missing.length) {
  console.warn('⚠ Analysis API keys not configured:');
  for (const [k, label] of missing) {
    console.warn(`  • ${k} (${label}) is missing or a placeholder — that provider will show "unavailable".`);
  }
  console.warn('  Submissions still work; affected scores are hidden with a notice.');
} else {
  console.log('✓ Analysis API keys present (Hugging Face + VWT).');
}
validateConfig();

app.set('trust proxy', 1); // correct req.ip behind Render/hosting proxies (for rate limiting)
// Prometheus: count and time every request; GET /metrics for the cluster (step 5.3).
const metrics = createMetrics();
app.use(metrics.middleware);
app.use(metrics.router());
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Peerlytics API', version: '1.0.0' });
});

// ── Lightweight in-memory rate limiter for the analysis endpoints. Protects the
// external-API quotas (Hugging Face/VWT) from accidental bursts. No extra dependency.
// Per-IP sliding window; resets each window. For multi-instance scale, swap for Redis.
function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref?.();
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'anon';
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) {
      return res.status(429).json({ error: 'Too many analysis requests — please wait a moment and retry.' });
    }
    next();
  };
}

app.use('/api/check', analysisLimiter, checkRouter);
app.use('/api/analyze', analysisLimiter, analyzeRouter);
app.use('/api', createAuthRouter());
app.use('/api', createExtensionRouter());

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Peerlytics API listening on http://localhost:${PORT}`);
  if (!config.runJobs) {
    console.log('RUN_JOBS=false: reminder emails and the deadline lock are off in this process.');
    return;
  }
  // Optional: scheduled deadline-reminder emails for offline members. Stays dormant
  // (with a one-line log) unless FIREBASE_SERVICE_ACCOUNT + SMTP creds are configured.
  startDeadlineReminders();
  // Every minute: submit and lock workspaces past their deadline (dormant without the Admin SDK key).
  startServerDeadlines();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Another Peerlytics API is probably running.\n` +
        `  • Use http://localhost:${PORT}/api/health to verify\n` +
        `  • Or stop the other process, then run npm run dev:server again\n` +
        `  • Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F`
    );
    process.exit(1);
  }
  throw err;
});

// docker stop / Kubernetes send SIGTERM: finish open requests, close the pool, then exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
