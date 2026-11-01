// GET /api/health: the only route without a token. Docker HEALTHCHECK and the Kubernetes
// probes call it. It answers 200 whenever the process is up, so a database outage shows up as
// db: "down" instead of the container being restarted in a loop. `ok`, `name` and `version`
// are the fields the frontend's healthCheck() has always read.
import { Router } from 'express';

export const VERSION = '1.0.0';

export function createHealthRouter({ db }) {
  const router = Router();
  router.get('/health', async (_req, res) => {
    const body = { ok: true, status: 'ok', name: 'Peerlytics API', version: VERSION };
    if (db.pool) body.db = (await db.ping()) ? 'up' : 'down';
    res.json(body);
  });
  return router;
}
