// The Express app, without listening or starting jobs, so tests can build it with their own
// config and database. server.js wires it to the real environment.
import express from 'express';
import cors from 'cors';
import checkRouter from './routes/check.js';
import analyzeRouter from './routes/analyze.js';
import { createHealthRouter } from './routes/health.js';
import { analyzeBody, checkBody, validateBody } from './routes/schemas.js';
import { createAssignmentRouter } from './routes/assignments.js';
import { createCourseContext } from './routes/courseContext.js';
import { createCourseRouter } from './routes/courses.js';
import { createSubmissionRouter } from './routes/submissions.js';
import { createGradeRouter } from './routes/grades.js';
import { createReportRouter } from './routes/reports.js';
import { createTaskRouter } from './routes/tasks.js';
import { createAnalysisService } from './services/analysis/analysisService.js';
import { createLegacyProvider } from './services/analysis/legacyProvider.js';
import { createOpenAIProvider } from './services/analysis/openaiProvider.js';
import { createWorkspaceStore } from './services/submissions/workspaceStore.js';
import { sendError } from './src/auth/errors.js';
import { createAuthRouter } from './src/auth/routes.js';
import { getAdmin } from './src/auth/firebaseAdmin.js';
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
 *           courseDeps?: object, submissionDeps?: object }} deps
 *   courseDeps: overrides for createCourseContext; submissionDeps: { analysis, store, ... } for
 *   createSubmissionRouter. Tests pass fakes for Firebase, Firestore and the AI providers.
 */
export function createApp({ config, db, metrics = createMetrics(), courseDeps = {}, submissionDeps = {} }) {
  const app = express();

  app.set('trust proxy', 1); // correct req.ip behind Render/hosting proxies (for rate limiting)
  // Prometheus: count and time every request; GET /metrics for the cluster (step 5.3).
  app.use(metrics.middleware);
  app.use(metrics.router());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createHealthRouter({ db }));

  const analysisLimiter = rateLimit({ windowMs: 60_000, max: 20 });
  app.use('/api/check', analysisLimiter);
  app.post('/api/check', validateBody(checkBody));
  app.use('/api/check', checkRouter);
  app.use('/api/analyze', analysisLimiter);
  app.post('/api/analyze', validateBody(analyzeBody));
  app.use('/api/analyze', analyzeRouter);
  app.use('/api', createAuthRouter());
  app.use('/api', createExtensionRouter());
  const courses = createCourseContext({ db, ...courseDeps });
  app.use('/api', createCourseRouter(courses));
  app.use('/api', createAssignmentRouter(courses));
  app.use('/api', createTaskRouter(courses));
  app.use('/api', createGradeRouter(courses));
  app.use('/api', createReportRouter(courses));
  app.use(
    '/api',
    createSubmissionRouter(courses, {
      analysis:
        submissionDeps.analysis ??
        createAnalysisService({ openai: createOpenAIProvider(config.openai), legacy: createLegacyProvider() }),
      store: submissionDeps.store ?? createWorkspaceStore(courseDeps.getClients ?? getAdmin),
      submitLimit: submissionDeps.submitLimit,
      eventLimit: submissionDeps.eventLimit,
    })
  );

  app.use((err, _req, res, _next) => {
    // Malformed JSON from express.json() is a bad body, not a server error.
    if (err.type === 'entity.parse.failed') return sendError(res, 400, 'INVALID_BODY');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
