import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import client from 'prom-client';
import { createMetrics } from './index.js';

async function serve(token) {
  const metrics = createMetrics({ registry: new client.Registry() });
  const app = express();
  app.use(metrics.middleware);
  app.use(metrics.router({ token }));
  const api = express.Router();
  api.get('/groups/:groupId', (_req, res) => res.json({ ok: true }));
  api.get('/boom', (_req, res) => res.status(500).json({ error: 'x' }));
  app.use('/api', api);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

test('requests are counted by route pattern and status; /metrics serves Prometheus text', async () => {
  const { base, close } = await serve();
  await fetch(`${base}/api/groups/g1`);
  await fetch(`${base}/api/groups/g2`);
  await fetch(`${base}/api/boom`);
  await fetch(`${base}/nowhere`);
  const res = await fetch(`${base}/metrics`);
  const body = await res.text();
  await close();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.match(body, /http_requests_total\{method="GET",route="\/api\/groups\/:groupId",status="200",app="peerlytics-backend"\} 2/);
  assert.match(body, /http_requests_total\{method="GET",route="\/api\/boom",status="500",app="peerlytics-backend"\} 1/);
  assert.match(body, /route="unmatched",status="404"/);
  assert.match(body, /http_request_duration_seconds_bucket/);
  assert.match(body, /process_cpu_seconds_total/);
  assert.doesNotMatch(body, /g1|g2/);
  assert.doesNotMatch(body, /route="\/metrics"/);
});

test('with METRICS_TOKEN set, scrapes need the token', async () => {
  const { base, close } = await serve('s3cret');
  assert.equal((await fetch(`${base}/metrics`)).status, 401);
  assert.equal((await fetch(`${base}/metrics`, { headers: { Authorization: 'Bearer s3cret' } })).status, 200);
  await close();
});
