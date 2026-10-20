// Prometheus metrics for the backend (step 5.3). GET /metrics is scraped by the
// kube-prometheus-stack ServiceMonitor in infra/k8s/monitoring/. The route label is the
// Express route pattern (/api/groups/:groupId/extension), never the raw URL, so ids don't
// create a new time series each.
//
// /metrics is meant for Prometheus inside the cluster (the Ingress doesn't route it). If
// METRICS_TOKEN is set, scrapes must send "X-Metrics-Token: <token>". The legacy Bearer
// header remains supported for standalone users of this router.
import express from 'express';
import client from 'prom-client';

export function createMetrics({ service = 'peerlytics-backend', registry = new client.Registry() } = {}) {
  // "app", not "service": Prometheus adds "service" itself from the Kubernetes Service.
  registry.setDefaultLabels({ app: service });
  client.collectDefaultMetrics({ register: registry });

  const requests = new client.Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by method, route and status code.',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Time to answer an HTTP request.',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  /** Express middleware: count and time every request except /metrics itself. */
  function middleware(req, res, next) {
    if (req.path === '/metrics') return next();
    const end = duration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      requests.inc(labels);
      end(labels);
    });
    next();
  }

  function router({ token = process.env.METRICS_TOKEN } = {}) {
    const r = express.Router();
    r.get('/metrics', async (req, res) => {
      if (
        token &&
        req.get('x-metrics-token') !== token &&
        req.get('authorization') !== `Bearer ${token}`
      ) {
        return res.status(401).end();
      }
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    });
    return r;
  }

  return { registry, middleware, router };
}
