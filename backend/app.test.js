// createApp with a stubbed database. Hugging Face and VWT are never reached: the provider
// keys are unset, so both services answer { available: false } without a network call.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createMetrics } from './src/metrics/index.js';
import client from 'prom-client';

let server;
let baseUrl;
let dbUp = true;
const fakeDb = { pool: {}, ping: async () => dbUp, close: async () => {} };

const savedKeys = { HF_API_KEY: process.env.HF_API_KEY, VWT_API_KEY: process.env.VWT_API_KEY };

before(async () => {
  delete process.env.HF_API_KEY;
  delete process.env.VWT_API_KEY;
  const app = createApp({
    config: loadConfig({}),
    db: fakeDb,
    metrics: createMetrics({ registry: new client.Registry() }),
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

async function call(method, path, body, { raw } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
