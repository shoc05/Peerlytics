import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import checkRouter from '../routes/check.js';
import analyzeRouter from '../routes/analyze.js';
import { createAuthRouter } from './auth/routes.js';
import { createRequireAuth, requireRole } from './auth/middleware.js';
import { getAdmin } from './auth/firebaseAdmin.js';
import { ROLES } from './auth/roles.js';
import { createExtensionRouter } from './jobs/deadlines/extensions.js';
import { createMetrics } from './metrics/index.js';

function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  // Per-IP in-memory window; use shared storage if the backend runs on multiple instances.
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

export function createApp({ env = process.env, getClients = getAdmin } = {}) {
  const app = express();
  const metrics = createMetrics();
  const allowedOrigins = (env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== '*');
  const requireAuth = createRequireAuth(() => getClients()?.auth ?? null);
  const requireAnyRole = requireRole(...ROLES);
  const analysisLimiter = rateLimit({ windowMs: 60_000, max: 20 });

  app.set('trust proxy', 1);
  app.use(metrics.middleware);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, Boolean(origin && allowedOrigins.includes(origin)));
      },
    })
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'Peerlytics API', version: '1.0.0' });
  });

  app.use(requireAuth);
  app.use(express.json({ limit: '2mb' }));

  app.use('/metrics', requireAnyRole);
  app.use(metrics.router({ token: env.METRICS_TOKEN }));
  app.use('/api/check', analysisLimiter, requireAnyRole, checkRouter);
  app.use('/api/analyze', analysisLimiter, requireAnyRole, analyzeRouter);
  app.use('/api', createAuthRouter({ getClients }));
  app.use('/api', createExtensionRouter({ getClients, timeZone: env.DEADLINE_TIMEZONE }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);

    const status = Number.isInteger(err?.status) ? err.status : err?.statusCode;
    console.error('[http] request failed', {
      name: err?.name || 'Error',
      status: Number.isInteger(status) ? status : 500,
    });

    if (status === 400) {
      return res.status(400).json({ error: 'The request is not valid.', code: 'INVALID_BODY' });
    }
    if (status === 413) {
      return res.status(413).json({ error: 'The request is too large.', code: 'PAYLOAD_TOO_LARGE' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
