import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, formatSummary, resultPath } from './summary.js';

// The shape k6 passes to handleSummary, trimmed to what buildSummary reads.
const data = {
  metrics: {
    http_reqs: { values: { count: 1800 } },
    http_req_failed: { values: { passes: 12, fails: 1788, rate: 12 / 1800 }, thresholds: { 'rate<0.01': { ok: true } } },
    http_req_duration: { values: { med: 41.23, 'p(95)': 180.04, max: 9000 } },
    'http_reqs{route:health}': { values: { count: 900 } },
    'http_req_failed{route:health}': { values: { passes: 8, fails: 892 } },
    'http_req_duration{route:health}': { values: { med: 30, 'p(95)': 120.55, max: 9000 } },
    'http_reqs{route:auth_me}': { values: { count: 900 } },
    'http_req_failed{route:auth_me}': { values: { passes: 4, fails: 896 } },
    'http_req_duration{route:auth_me}': { values: { med: 50, 'p(95)': 200, max: 800 } },
    failure_time: { values: { min: Date.UTC(2026, 10, 3, 10, 0, 5), max: Date.UTC(2026, 10, 3, 10, 0, 17) } },
  },
};

test('buildSummary counts failed requests and p95 per route and in total', () => {
  const s = buildSummary(data, { label: 'staging-rolling', baseUrl: 'https://staging.example.org', rate: 5 });
  assert.deepEqual(s.total, { requests: 1800, failed: 12, failed_percent: 0.67, p95_ms: 180, median_ms: 41.2, max_ms: 9000 });
  assert.equal(s.routes.health.failed, 8);
  assert.equal(s.routes.health.p95_ms, 120.6);
  assert.equal(s.routes.auth_me.requests, 900);
  assert.equal(s.first_failure_at, '2026-11-03T10:00:05.000Z');
  assert.equal(s.last_failure_at, '2026-11-03T10:00:17.000Z');
  assert.equal(s.thresholds_ok['http_req_failed: rate<0.01'], true);
  assert.equal(s.label, 'staging-rolling');
});

test('a run with no failures has no failure window', () => {
  const clean = { metrics: { ...data.metrics, http_req_failed: { values: { passes: 0, fails: 1800 } } } };
  delete clean.metrics.failure_time;
  const s = buildSummary(clean, {});
  assert.equal(s.total.failed, 0);
  assert.equal(s.first_failure_at, null);
  assert.match(formatSummary(s), /no failed requests/);
});

test('missing metrics give zeros, not a crash', () => {
  const s = buildSummary({}, {});
  assert.equal(s.total.requests, 0);
  assert.equal(s.total.failed_percent, 0);
  assert.equal(s.routes.health.p95_ms, null);
});

test('resultPath is a safe file name under load/results/', () => {
  assert.equal(
    resultPath('prod blue/green', '2026-11-03T10:00:05.123Z'),
    'load/results/deploy-check-prod-blue-green-2026-11-03T10-00-05-123Z.json',
  );
  assert.equal(resultPath('', 'x'), 'load/results/deploy-check-run-x.json');
});
