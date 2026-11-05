// The Express app, without listening or starting jobs, so tests can build it with their own
// config and database. server.js wires it to the real environment.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import checkRouter from './routes/check.js';
import analyzeRouter from './routes/analyze.js';
import { createHealthRouter } from './routes/health.js';
import { analyzeBody, checkBody, validateBody } from './routes/schemas.js';
import { createAdminRouter } from './src/admin/routes.js';
import { sendError } from './src/auth/errors.js';
import { getAdmin } from './src/auth/firebaseAdmin.js';
import { createRequireAuth, requireRole } from './src/auth/middleware.js';
import { ROLES } from './src/auth/roles.js';
import { createAuthRouter } from './src/auth/routes.js';
import { createExtensionRouter } from './src/jobs/deadlines/extensions.js';
import { createMetrics } from './src/metrics/index.js';

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

/**
 * @param {{ config: ReturnType<import('./config/index.js').loadConfig>,
 *           db: ReturnType<import('./db/pool.js').createDb>,
 *           metrics?: ReturnType<typeof createMetrics>,
 *           getClients?: typeof getAdmin }} deps
 */
export function createApp({ config, db, metrics = createMetrics(), getClients = getAdmin }) {
  const app = express();

  app.set('trust proxy', 1); // correct req.ip behind Render/hosting proxies (for rate limiting)
  // Prometheus: count and time every request; GET /metrics for the cluster (step 5.3).
  app.use(metrics.middleware);
  app.use(metrics.router());
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));

  // The analysis routes call paid providers, so they need a signed-in user with a role. The limit
  // comes first so bad tokens are limited too, and all of this before a body is parsed.
  const analysisLimiter = rateLimit({ windowMs: 60_000, max: 20 });
  const requireAuth = createRequireAuth(() => getClients()?.auth ?? null);
  const analysisGate = [analysisLimiter, requireAuth, requireRole(...ROLES)];
  app.use('/api/check', analysisGate);
  app.use('/api/analyze', analysisGate);

  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createHealthRouter({ db }));

  app.post('/api/check', validateBody(checkBody));
  app.use('/api/check', checkRouter);
  app.post('/api/analyze', validateBody(analyzeBody));
  app.use('/api/analyze', analyzeRouter);
  app.use('/api', createAuthRouter({ getClients }));
  app.use('/api', createExtensionRouter({ getClients }));
  app.use('/api', createAdminRouter({ db, getClients }));

  app.use((err, _req, res, _next) => {
    // Malformed JSON from express.json() is a bad body, not a server error.
    if (err.type === 'entity.parse.failed') return sendError(res, 400, 'INVALID_BODY');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
