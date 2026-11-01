import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createApp } from './app.js';
import { fakeAuth } from './auth/testFakes.js';
import { fakeFirestore } from './jobs/deadlines/fakeFirestore.js';

const ENV = {
  CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:5173',
  METRICS_TOKEN: 'metrics-test-token',
  NODE_ENV: 'production',
};
const STUDENT = { uid: 'student-1', email: 'student@example.test', role: 'student' };
const LECTURER = { uid: 'lecturer-1', email: 'lecturer@example.test', role: 'lecturer' };
const SUPER_ADMIN = { uid: 'admin-1', email: 'admin@example.test', role: 'superAdmin' };

let clients;
let server;
let baseUrl;
let verifyCalls;

function setup() {
  const auth = fakeAuth({
    users: {
      'student-1': { customClaims: { role: 'student' } },
      'lecturer-1': { customClaims: { role: 'lecturer' } },
      'admin-1': { customClaims: { role: 'superAdmin' } },
    },
    tokens: {
      student: STUDENT,
      lecturer: LECTURER,
      admin: SUPER_ADMIN,
      unassigned: { uid: 'new-user', email: 'new@example.test' },
      expired: 'auth/id-token-expired',
    },
  });
  const verifyIdToken = auth.verifyIdToken.bind(auth);
  verifyCalls = 0;
  auth.verifyIdToken = async (...args) => {
    verifyCalls += 1;
    return verifyIdToken(...args);
  };
  clients = {
    auth,
    db: fakeFirestore({
      'groups/g1': {
        name: 'G1',
        memberIds: ['student-1'],
        lecturerIds: ['lecturer-1'],
        deadline: '2099-01-01T00:00:00.000Z',
      },
    }),
  };
  return clients;
}

before(async () => {
  setup();
  const app = createApp({ env: ENV, getClients: () => clients });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => setup());

after(() => new Promise((resolve) => server.close(resolve)));

async function request(path, { method = 'GET', token, authorization, origin, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (authorization) requestHeaders.Authorization = authorization;
  if (origin) requestHeaders.Origin = origin;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => null),
  };
}

test('only GET /api/health is public; nested health paths remain protected', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const nestedHealth = await request('/api/check/health');
  assert.equal(nestedHealth.status, 401);
  assert.equal(nestedHealth.body.code, 'NO_TOKEN');
});

test('auth onboarding routes accept authenticated users who have no role yet', async () => {
  const response = await request('/api/auth/me', { token: 'unassigned' });
  assert.equal(response.status, 200);
  assert.equal(response.body.role, null);
});

test('missing, malformed, invalid, and expired bearer tokens return 401', async () => {
  const missing = await request('/api/check/health');
  assert.deepEqual([missing.status, missing.body.code], [401, 'NO_TOKEN']);

  const malformed = await request('/api/check/health', { authorization: 'Bearer' });
  assert.deepEqual([malformed.status, malformed.body.code], [401, 'NO_TOKEN']);

  const invalid = await request('/api/check/health', { token: 'not-a-valid-token' });
  assert.deepEqual([invalid.status, invalid.body.code], [401, 'TOKEN_INVALID']);

  const expired = await request('/api/check/health', { token: 'expired' });
  assert.deepEqual([expired.status, expired.body.code], [401, 'TOKEN_EXPIRED']);
});

test('a valid student token can access role-gated analysis and a wrong role gets 403', async () => {
  const allowed = await request('/api/check/health', { token: 'student' });
  assert.deepEqual([allowed.status, allowed.body.service], [200, 'peerlytics-check']);
  assert.equal(verifyCalls, 1);

  const denied = await request('/api/admin/users/target-user/role', {
    method: 'POST',
    token: 'student',
    body: { role: 'lecturer' },
  });
  assert.deepEqual([denied.status, denied.body.code], [403, 'FORBIDDEN']);
});

test('a valid lecturer token can use the lecturer-only extension route', async () => {
  const response = await request('/api/groups/g1/extension', {
    method: 'POST',
    token: 'lecturer',
    body: { deadline: '2099-01-02T00:00:00.000Z', reason: 'Approved accommodation' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.groupId, 'g1');
  assert.equal(verifyCalls, 1);
});

test('Firebase authentication is also required for /metrics', async () => {
  const missing = await request('/metrics', { authorization: 'Bearer metrics-test-token' });
  assert.equal(missing.status, 401);

  const allowed = await request('/metrics', {
    token: 'admin',
    headers: { 'X-Metrics-Token': 'metrics-test-token' },
  });
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get('content-type'), /text\/plain/);
});

test('CORS reflects only configured origins and Helmet sets security headers', async () => {
  const allowed = await request('/api/health', { origin: 'http://localhost:3000' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');

  const denied = await request('/api/health', { origin: 'https://unlisted.example' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const appWithoutAllowList = createApp({ env: {}, getClients: () => clients });
  const unconfiguredServer = await new Promise((resolve) => {
    const nextServer = appWithoutAllowList.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${unconfiguredServer.address().port}/api/health`, {
      headers: { Origin: 'https://any-origin.example' },
    });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve) => unconfiguredServer.close(resolve));
  }
});

test('production errors return no stack or internal details', async () => {
  clients.auth.getUser = async () => {
    throw new Error('internal database detail');
  };

  const response = await request('/api/admin/users/target-user/role', {
    method: 'POST',
    token: 'admin',
    body: { role: 'student' },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Internal server error' });
  assert.equal(JSON.stringify(response.body).includes('internal database detail'), false);
  assert.equal(JSON.stringify(response.body).includes('stack'), false);
});
