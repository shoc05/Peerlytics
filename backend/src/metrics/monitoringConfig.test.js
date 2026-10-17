// The monitoring config in infra/k8s/monitoring must only use metrics the services export,
// and must keep the three required alerts. Catches a renamed metric silently breaking alerts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import client from 'prom-client';
import { createMetrics } from './index.js';

const dir = new URL('../../../infra/k8s/monitoring/', import.meta.url);
const rules = readFileSync(new URL('alert-rules.yaml', dir), 'utf8');
const dashboard = JSON.parse(readFileSync(new URL('dashboards/peerlytics-overview.json', dir), 'utf8'));
const collabMetrics = readFileSync(new URL('../../../collab/src/metrics.js', dir), 'utf8');

// Provided by Prometheus or kube-state-metrics, not by our services.
const PLATFORM = new Set(['up', 'kube_pod_container_status_restarts_total']);

async function exported() {
  const { registry } = createMetrics({ registry: new client.Registry() });
  const names = new Set((await registry.getMetricsAsJSON()).map((m) => m.name));
  for (const m of collabMetrics.matchAll(/name: '([a-z_]+)'/g)) names.add(m[1]);
  return names;
}

function metricNames(expr) {
  const out = new Set();
  for (const m of expr.matchAll(/\b([a-z_]+(?:_total|_seconds_bucket|_connections|_documents)|up)\{/g)) {
    out.add(m[1].replace(/_bucket$/, ''));
  }
  return out;
}

test('alerts and the dashboard use only metrics that exist', async () => {
  const names = await exported();
  const exprs = [rules, ...dashboard.panels.flatMap((p) => p.targets.map((t) => t.expr))];
  const used = new Set(exprs.flatMap((e) => [...metricNames(e)]));
  for (const name of ['http_requests_total', 'http_request_duration_seconds', 'collab_active_connections', 'up']) {
    assert.ok(used.has(name), `the check should see ${name}`);
  }
  for (const expr of exprs) {
    for (const name of metricNames(expr)) {
      assert.ok(PLATFORM.has(name) || names.has(name), `unknown metric ${name}`);
    }
  }
});

test('the three required alerts are there with the agreed thresholds', () => {
  assert.match(rules, /alert: PeerlyticsHighErrorRate[\s\S]*?> 0\.05\s*\n\s*for: 5m/);
  assert.match(rules, /alert: PeerlyticsPodRestarting[\s\S]*?kube_pod_container_status_restarts_total/);
  assert.match(rules, /alert: PeerlyticsBackendDown[\s\S]*?up\{namespace="peerlytics", service="peerlytics-backend"\} == 0/);
});

test('the dashboard covers requests, errors and response time', () => {
  const titles = dashboard.panels.map((p) => p.title);
  for (const t of ['Requests per second', 'Errors (5xx share of requests)', 'Response time p95']) assert.ok(titles.includes(t), t);
  assert.equal(new Set(dashboard.panels.map((p) => p.id)).size, dashboard.panels.length);
});

// ——— Status page (step 5.5) ———
const kumaDir = new URL('uptime-kuma/', dir);

test('the status page checks all four services every minute', () => {
  const plan = JSON.parse(readFileSync(new URL('monitors.json', kumaDir), 'utf8'));
  assert.equal(plan.interval, 60);
  assert.deepEqual(plan.monitors.map((m) => m.name), ['Website', 'Backend API', 'Live editing (collab)', 'Notifications (notifier)']);
  assert.ok(plan.monitors.find((m) => m.name === 'Backend API').url.endsWith('/api/health'));
  assert.ok(plan.monitors.find((m) => m.name.startsWith('Live editing')).url.endsWith('/health'));
});

test('Uptime Kuma runs as one pinned pod with its data on a volume, and the Ingress is separate', () => {
  const manifest = readFileSync(new URL('uptime-kuma.yaml', kumaDir), 'utf8');
  assert.match(manifest, /image: louislam\/uptime-kuma:\d+\.\d+\.\d+/);
  assert.match(manifest, /replicas: 1/);
  assert.match(manifest, /type: Recreate/);
  assert.match(manifest, /mountPath: \/app\/data/);
  assert.doesNotMatch(manifest, /kind: Ingress/);
  assert.match(readFileSync(new URL('ingress.yaml', kumaDir), 'utf8'), /kind: Ingress/);
});
