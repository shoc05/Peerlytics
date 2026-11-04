// Turns k6's handleSummary data into the small JSON report that load/deploy-check.js saves
// (step 5.9). Plain JavaScript with no k6 or Node imports, so node:test can test it.

export const ROUTES = ['health', 'auth_me'];

function metric(data, name) {
  return data?.metrics?.[name]?.values ?? null;
}

function round(ms) {
  return typeof ms === 'number' ? Math.round(ms * 10) / 10 : null;
}

function iso(ms) {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;
}

/** Requests, failed requests and response times for one route tag (or all routes). */
function routeStats(data, route) {
  const tag = route ? `{route:${route}}` : '';
  const reqs = metric(data, `http_reqs${tag}`);
  const failed = metric(data, `http_req_failed${tag}`);
  const duration = metric(data, `http_req_duration${tag}`);
  const requests = reqs?.count ?? 0;
  // k6's Rate metric counts true values as "passes"; for http_req_failed true means failed.
  const failedCount = failed?.passes ?? 0;
  return {
    requests,
    failed: failedCount,
    failed_percent: requests ? Math.round((failedCount / requests) * 10000) / 100 : 0,
    p95_ms: round(duration?.['p(95)']),
    median_ms: round(duration?.med),
    max_ms: round(duration?.max),
  };
}

/**
 * The saved report: one row per route plus the total, and when the first and last failed
 * request happened (from the failure_time Trend), which brackets any downtime.
 */
export function buildSummary(data, meta = {}) {
  const failures = metric(data, 'failure_time');
  const thresholds = {};
  for (const [name, m] of Object.entries(data?.metrics ?? {})) {
    if (m.thresholds) {
      for (const [rule, result] of Object.entries(m.thresholds)) thresholds[`${name}: ${rule}`] = result.ok;
    }
  }
  return {
    label: meta.label ?? null,
    base_url: meta.baseUrl ?? null,
    started_at: meta.startedAt ?? null,
    finished_at: meta.finishedAt ?? null,
    duration: meta.duration ?? null,
    rate_per_route: meta.rate ?? null,
    signed_in: Boolean(meta.signedIn),
    total: routeStats(data, null),
    routes: Object.fromEntries(ROUTES.map((route) => [route, routeStats(data, route)])),
    first_failure_at: iso(failures?.min),
    last_failure_at: iso(failures?.max),
    thresholds_ok: thresholds,
  };
}

/** load/results/deploy-check-<label>-<time>.json, safe for Windows file names. */
export function resultPath(label, finishedAt) {
  const safeLabel = String(label || 'run').replace(/[^A-Za-z0-9._-]+/g, '-');
  const stamp = String(finishedAt).replace(/[:.]/g, '-');
  return `load/results/deploy-check-${safeLabel}-${stamp}.json`;
}

/** A few lines for the terminal, next to k6's own summary. */
export function formatSummary(summary) {
  const row = (name, s) =>
    `  ${name.padEnd(8)} ${String(s.requests).padStart(6)} requests  ${String(s.failed).padStart(5)} failed (${s.failed_percent}%)  p95 ${s.p95_ms ?? '-'} ms`;
  const lines = [
    `deploy-check "${summary.label}" against ${summary.base_url}`,
    row('total', summary.total),
    ...ROUTES.map((route) => row(route, summary.routes[route])),
  ];
  if (summary.first_failure_at) lines.push(`  failures between ${summary.first_failure_at} and ${summary.last_failure_at}`);
  else lines.push('  no failed requests');
  return `${lines.join('\n')}\n`;
}
