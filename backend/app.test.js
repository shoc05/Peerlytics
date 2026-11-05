// createApp with a stubbed database. Hugging Face and VWT are never reached: the provider
// keys are unset, so both services answer { available: false } without a network call.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { fakeAuth } from './src/auth/testFakes.js';
import { createMetrics } from './src/metrics/index.js';
import client from 'prom-client';

let server;
let baseUrl;
let dbUp = true;
const fakeDb = { pool: {}, ping: async () => dbUp, close: async () => {} };
const clients = {
  auth: fakeAuth({
    tokens: {
      student: { uid: 'student-1', email: 'student@example.test', role: 'student' },
      unassigned: { uid: 'new-user', email: 'new@example.test' },
    },
  }),
};
const getClients = () => clients;

const savedKeys = { HF_API_KEY: process.env.HF_API_KEY, VWT_API_KEY: process.env.VWT_API_KEY };

before(async () => {
  delete process.env.HF_API_KEY;
  delete process.env.VWT_API_KEY;
  const app = createApp({
    config: loadConfig({}),
    db: fakeDb,
    metrics: createMetrics({ registry: new client.Registry() }),
    getClients,
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(process.env, Object.fromEntries(Object.entries(savedKeys).filter(([, v]) => v !== undefined)));
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, body, { raw, token = 'student' } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json };
}

describe('GET /api/health', () => {
  test('keeps the old fields and reports the database as up', async () => {
    dbUp = true;
    const res = await call('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, status: 'ok', name: 'Peerlytics API', version: '1.0.0', db: 'up' });
  });

  test('still answers 200 when the database is down', async () => {
    dbUp = false;
    const res = await call('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.db, 'down');
    dbUp = true;
  });

  test('leaves out db when no database is configured', async () => {
    const app = createApp({
      config: loadConfig({}),
      db: { pool: null, ping: async () => false, close: async () => {} },
      metrics: createMetrics({ registry: new client.Registry() }),
    });
    const s = await new Promise((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/health`).then((r) => r.json());
    await new Promise((resolve) => s.close(resolve));
    assert.equal('db' in res, false);
    assert.equal(res.ok, true);
  });
});

describe('sign-in on the analysis routes', () => {
  const text = 'Some writing that is long enough.';

  for (const path of ['/api/check', '/api/analyze']) {
    test(`${path} refuses a request with no token`, async () => {
      const res = await call('POST', path, { text }, { token: null });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'NO_TOKEN');
    });

    test(`${path} refuses an invalid token`, async () => {
      const res = await call('POST', path, { text }, { token: 'not-a-token' });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'TOKEN_INVALID');
    });

    test(`${path} refuses a user without a role`, async () => {
      const res = await call('POST', path, { text }, { token: 'unassigned' });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'NO_ROLE');
    });

    test(`${path} checks the token before reading the body`, async () => {
      const res = await call('POST', path, undefined, { raw: '{"text": ', token: null });
      assert.equal(res.status, 401);
    });
  }

  test('answers 503 when the Admin SDK is not configured', async () => {
    const app = createApp({
      config: loadConfig({}),
      db: fakeDb,
      metrics: createMetrics({ registry: new client.Registry() }),
      getClients: () => null,
    });
    const s = await new Promise((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/check`, {
      method: 'POST',
      headers: { Authorization: 'Bearer student' },
    });
    await new Promise((resolve) => s.close(resolve));
    assert.equal(res.status, 503);
  });

  test('requests with no token still count towards the rate limit', async () => {
    const app = createApp({
      config: loadConfig({}),
      db: fakeDb,
      metrics: createMetrics({ registry: new client.Registry() }),
      getClients,
    });
    const s = await new Promise((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    const statuses = [];
    for (let i = 0; i < 21; i += 1) {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/api/check`, { method: 'POST' });
      statuses.push(res.status);
    }
    await new Promise((resolve) => s.close(resolve));
    assert.equal(statuses[0], 401);
    assert.equal(statuses[19], 401);
    assert.equal(statuses[20], 429);
  });
});

test('behind two proxies, each visitor gets their own rate limit', async () => {
  const app = createApp({
    config: loadConfig({ TRUST_PROXY_HOPS: '2' }),
    db: fakeDb,
    metrics: createMetrics({ registry: new client.Registry() }),
    getClients,
  });
  const s = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  const send = (visitor) =>
    fetch(`http://127.0.0.1:${s.address().port}/api/check`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': `${visitor}, 172.18.0.5` },
    });
  for (let i = 0; i < 20; i += 1) await send('203.0.113.1');
  const first = await send('203.0.113.1');
  const second = await send('203.0.113.2');
  await new Promise((resolve) => s.close(resolve));
  assert.equal(first.status, 429);
  assert.equal(second.status, 401);
});

test('security headers are set and Express is not named', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-powered-by'), null);
});

describe('POST /api/check body validation', () => {
  const valid = {
    text: 'This is a long enough piece of student writing to analyse.',
    html: '<p>This is a long enough piece of student writing to analyse.</p>',
    userId: 'stu-1',
    fileId: 'file-1',
    groupId: 'group-1',
    fileName: 'Essay',
    studentName: 'A Student',
    difficulty: 1.5,
    versions: [{ id: 'v1', savedAt: 123, anyOtherField: true }],
    pasteEvents: [{ changeType: 'paste-large', contentSnippet: 'abc', fileId: 'file-1' }],
    tabs: [{ id: 't1', title: 'Intro', depth: 0, wordCount: 10 }],
  };

  test('accepts what the frontend sends and returns a report', async () => {
    const res = await call('POST', '/api/check', valid);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.report);
  });

  test('a bad tab list is still dropped, not rejected', async () => {
    const res = await call('POST', '/api/check', { ...valid, tabs: 'not a list' });
    assert.equal(res.status, 200);
    assert.equal(res.body.report.tabs, undefined);
  });

  test('rejects an unknown top-level field with INVALID_BODY', async () => {
    const res = await call('POST', '/api/check', { ...valid, grade: 10 });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_BODY');
    assert.ok(res.body.details.length > 0);
  });

  test('rejects wrong types', async () => {
    const res = await call('POST', '/api/check', { ...valid, pasteEvents: 'lots' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_BODY');
    assert.deepEqual(res.body.details.map((d) => d.path), ['pasteEvents']);
  });

  test('error details never echo the submitted values', async () => {
    const res = await call('POST', '/api/check', { ...valid, studentName: 12345678 });
    assert.equal(res.status, 400);
    assert.doesNotMatch(JSON.stringify(res.body), /12345678/);
  });

  test('too-short content keeps its old 400 message', async () => {
    const res = await call('POST', '/api/check', { text: 'short' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too short/);
  });

  test('GET /api/check/health is not body-checked', async () => {
    const res = await call('GET', '/api/check/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.service, 'peerlytics-check');
  });
});

describe('POST /api/analyze body validation', () => {
  test('accepts { text }', async () => {
    const res = await call('POST', '/api/analyze', { text: 'Some writing that is long enough.' });
    assert.equal(res.status, 200);
    assert.ok(res.body.providers);
  });

  test('rejects a missing text or an extra field', async () => {
    assert.equal((await call('POST', '/api/analyze', {})).body.code, 'INVALID_BODY');
    assert.equal((await call('POST', '/api/analyze', { text: 'x'.repeat(20), userId: 'u' })).body.code, 'INVALID_BODY');
  });
});

test('malformed JSON is a 400 INVALID_BODY, not a 500', async () => {
  const res = await call('POST', '/api/analyze', undefined, { raw: '{"text": ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_BODY');
});
