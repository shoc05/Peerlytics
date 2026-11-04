// k6 deploy-time load test (step 5.9). Runs a constant load on two read-only routes while a
// deploy happens, and saves failed requests and p95 response time to load/results/.
// Steps to follow: docs/cd-evidence.md.
//
//   k6 run -e BASE_URL=https://<STAGING_DOMAIN> -e LABEL=staging-rolling load/deploy-check.js
//
// Run it from the repo root (the result path is relative). Environment:
//   BASE_URL  the API server, without /api (a trailing /api also works). Required.
//   LABEL     a name for this run, used in the file name (default "run")
//   RATE      requests per second, per route (default 5, so 10 req/s in all)
//   DURATION  default 3m
//   TOKEN     optional Firebase ID token. Without it GET /api/auth/me must answer 401 (the
//             auth middleware rejects it without calling Firebase); with it, 200.
// Both routes only read. Nothing is created, changed or deleted.
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { buildSummary, formatSummary, resultPath } from './summary.js';

const BASE_URL = String(__ENV.BASE_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
if (!/^https?:\/\//.test(BASE_URL)) {
  throw new Error('Set BASE_URL to the API server, e.g. -e BASE_URL=https://<STAGING_DOMAIN>');
}
const LABEL = __ENV.LABEL || 'run';
const RATE = Number(__ENV.RATE || 5);
const DURATION = __ENV.DURATION || '3m';
const TOKEN = String(__ENV.TOKEN || '').trim();
const STARTED_AT = new Date().toISOString();

// The time of every failed request; its min and max bracket the downtime.
const failureTime = new Trend('failure_time');

const scenario = (exec) => ({
  executor: 'constant-arrival-rate',
  exec,
  rate: RATE,
  timeUnit: '1s',
  duration: DURATION,
  preAllocatedVUs: Math.max(5, RATE * 2),
  maxVUs: Math.max(50, RATE * 10),
});

export const options = {
  scenarios: { health: scenario('health'), auth_me: scenario('authMe') },
  // The thresholds are for reading the result. Per-route ones also make k6 report each route.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    'http_req_failed{route:health}': ['rate<0.01'],
    'http_req_failed{route:auth_me}': ['rate<0.01'],
    'http_req_duration{route:health}': ['p(95)<1000'],
    'http_req_duration{route:auth_me}': ['p(95)<1000'],
    'http_reqs{route:health}': ['count>0'],
    'http_reqs{route:auth_me}': ['count>0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function get(path, route, expected, headers = {}) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers,
    tags: { route },
    timeout: '10s',
    // Only the expected status counts as a success in http_req_failed.
    responseCallback: http.expectedStatuses(expected),
  });
  const ok = check(res, { [`${route} answers ${expected}`]: (r) => r.status === expected });
  if (!ok) failureTime.add(Date.now());
  return res;
}

export function health() {
  get('/api/health', 'health', 200);
}

export function authMe() {
  if (TOKEN) get('/api/auth/me', 'auth_me', 200, { Authorization: `Bearer ${TOKEN}` });
  else get('/api/auth/me', 'auth_me', 401);
}

export function handleSummary(data) {
  const finishedAt = new Date().toISOString();
  const summary = buildSummary(data, {
    label: LABEL,
    baseUrl: BASE_URL,
    startedAt: STARTED_AT,
    finishedAt,
    duration: DURATION,
    rate: RATE,
    signedIn: Boolean(TOKEN),
  });
  return {
    stdout: formatSummary(summary),
    [resultPath(LABEL, finishedAt)]: `${JSON.stringify(summary, null, 2)}\n`,
  };
}
