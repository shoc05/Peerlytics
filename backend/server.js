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
import { startDeadlineReminders } from './services/reminderService.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ── Startup config validation: warn clearly if analysis API keys are missing or
// look like unreplaced placeholders, so failures aren't silent. The server still starts —
// analysis falls back gracefully ("AI checker not available") on any provider error.
function validateConfig() {
  const placeholder = (v) => !v || /your_.*_key_here|YOUR_.*_KEY/i.test(v);
  const checks = [
    ['HF_API_KEY', 'Hugging Face AI detection'],
    ['VWT_API_KEY', 'Virtual Writing Tutor grammar/writing'],
  ];
  const missing = checks.filter(([k]) => placeholder(process.env[k]));
  if (missing.length) {
    console.warn('⚠ Analysis API keys not configured:');
    for (const [k, label] of missing) {
      console.warn(`  • ${k} (${label}) is missing or a placeholder — that provider will show "unavailable".`);
    }
    console.warn('  Submissions still work; affected scores are hidden with a notice.');
  } else {
    console.log('✓ Analysis API keys present (Hugging Face + VWT).');
  }
}
validateConfig();

app.set('trust proxy', 1); // correct req.ip behind Render/hosting proxies (for rate limiting)
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
const analysisLimiter = rateLimit({ windowMs: 60_000, max: 20 });

app.use('/api/check', analysisLimiter, checkRouter);
app.use('/api/analyze', analysisLimiter, analyzeRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Peerlytics API listening on http://localhost:${PORT}`);
  // Optional: scheduled deadline-reminder emails for offline members. Stays dormant
  // (with a one-line log) unless FIREBASE_SERVICE_ACCOUNT + SMTP creds are configured.
  startDeadlineReminders();
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
