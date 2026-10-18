import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import { createAuthRouter } from './routes.js';
import { fakeAuth, fakeDb } from './testFakes.js';

let clients = null;
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createAuthRouter({ getClients: () => clients }));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function setup({ users = {}, tokens = {}, docs = {} } = {}) {
  clients = { auth: fakeAuth({ users, tokens }), db: fakeDb(docs) };
  return clients;
}

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const newUser = { uid: 'new-1', email: 'new@example.com' };
const student = { uid: 'stu-1', email: 's@example.com', role: 'student', collegeId: null };
const admin = { uid: 'sa-1', email: 'a@example.com', role: 'superAdmin', collegeId: null };

function standardSetup(extra = {}) {
  return setup({
    users: {
      'new-1': {},
      'stu-1': { customClaims: { role: 'student', collegeId: null } },
      'sa-1': { customClaims: { role: 'superAdmin', collegeId: null } },
      ...extra.users,
    },
    tokens: { newTok: newUser, stuTok: student, adminTok: admin, ...extra.tokens },
    docs: extra.docs,
  });
}

describe('requireAuth', () => {
  beforeEach(() => standardSetup({ tokens: { old: 'auth/id-token-expired', revoked: 'auth/id-token-revoked' } }));

  test('401 NO_TOKEN without a Bearer header', async () => {
    const r = await call('GET', '/api/auth/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'NO_TOKEN');
    assert.ok(r.body.error);
  });

  test('401 TOKEN_INVALID for a bad token', async () => {
    const r = await call('GET', '/api/auth/me', { token: 'garbage' });
    assert.deepEqual([r.status, r.body.code], [401, 'TOKEN_INVALID']);
  });

  test('401 TOKEN_EXPIRED and TOKEN_REVOKED from the Admin SDK codes', async () => {
    assert.equal((await call('GET', '/api/auth/me', { token: 'old' })).body.code, 'TOKEN_EXPIRED');
    assert.equal((await call('GET', '/api/auth/me', { token: 'revoked' })).body.code, 'TOKEN_REVOKED');
  });

  test('503 AUTH_UNAVAILABLE when the Admin SDK is not configured', async () => {
    clients = null;
    const r = await call('GET', '/api/auth/me', { token: 'stuTok' });
    assert.deepEqual([r.status, r.body.code], [503, 'AUTH_UNAVAILABLE']);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => standardSetup());

  test('works before a role is picked', async () => {
    const r = await call('GET', '/api/auth/me', { token: 'newTok' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { uid: 'new-1', email: 'new@example.com', role: null, collegeId: null });
  });

  test('returns the role from the claims and ignores unknown roles', async () => {
    assert.equal((await call('GET', '/api/auth/me', { token: 'stuTok' })).body.role, 'student');
    clients.auth = fakeAuth({ tokens: { odd: { uid: 'x', role: 'admin' } } });
    assert.equal((await call('GET', '/api/auth/me', { token: 'odd' })).body.role, null);
  });
});

describe('POST /api/auth/role', () => {
  beforeEach(() => standardSetup());

  for (const role of ['student', 'lecturer']) {
    test(`a new user can pick ${role} once`, async () => {
      const r = await call('POST', '/api/auth/role', { token: 'newTok', body: { role } });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { role, collegeId: null });
      assert.deepEqual(clients.auth.users['new-1'].customClaims, { role, collegeId: null });
      assert.equal(clients.db.store.get('users/new-1').role, role);
    });
  }

  for (const role of ['collegeAdmin', 'superAdmin', 'admin', '']) {
    test(`400 INVALID_BODY for role "${role}"`, async () => {
      const r = await call('POST', '/api/auth/role', { token: 'newTok', body: { role } });
      assert.deepEqual([r.status, r.body.code], [400, 'INVALID_BODY']);
      assert.equal(clients.auth.calls.setCustomUserClaims.length, 0);
    });
  }

  test('400 INVALID_BODY for extra fields such as collegeId', async () => {
    const r = await call('POST', '/api/auth/role', { token: 'newTok', body: { role: 'student', collegeId: 'c1' } });
    assert.deepEqual([r.status, r.body.code], [400, 'INVALID_BODY']);
  });

  test('409 ROLE_ALREADY_SET when the token already has a role', async () => {
    const r = await call('POST', '/api/auth/role', { token: 'stuTok', body: { role: 'lecturer' } });
    assert.deepEqual([r.status, r.body.code], [409, 'ROLE_ALREADY_SET']);
    assert.equal(clients.auth.calls.setCustomUserClaims.length, 0);
  });

  test('409 when the live record has a role the token does not show yet', async () => {
    clients.auth.users['new-1'].customClaims = { role: 'student', collegeId: null };
    const r = await call('POST', '/api/auth/role', { token: 'newTok', body: { role: 'lecturer' } });
    assert.equal(r.status, 409);
  });

  test('409 when a different role is already mirrored in users/{uid} (legacy account)', async () => {
    clients.db.store.set('users/new-1', { role: 'student' });
    const r = await call('POST', '/api/auth/role', { token: 'newTok', body: { role: 'lecturer' } });
    assert.equal(r.status, 409);
    assert.equal(clients.auth.calls.setCustomUserClaims.length, 0);
  });

  test('finishes a half-done pick when the mirror matches and the claim is missing', async () => {
    clients.db.store.set('users/new-1', { role: 'lecturer', name: 'N' });
    const r = await call('POST', '/api/auth/role', { token: 'newTok', body: { role: 'lecturer' } });
    assert.equal(r.status, 200);
    assert.equal(clients.auth.users['new-1'].customClaims.role, 'lecturer');
    assert.equal(clients.db.store.get('users/new-1').name, 'N');
  });

  test('a second pick after the first one is refused', async () => {
    assert.equal((await call('POST', '/api/auth/role', { token: 'newTok', body: { role: 'student' } })).status, 200);
    const r = await call('POST', '/api/auth/role', { token: 'newTok', body: { role: 'lecturer' } });
    assert.equal(r.status, 409);
    assert.equal(clients.auth.users['new-1'].customClaims.role, 'student');
  });
});

describe('POST /api/admin/users/:uid/role', () => {
  beforeEach(() => standardSetup());

  test('403 NO_ROLE for a user without a role', async () => {
    const r = await call('POST', '/api/admin/users/stu-1/role', { token: 'newTok', body: { role: 'lecturer' } });
    assert.deepEqual([r.status, r.body.code], [403, 'NO_ROLE']);
  });

  test('403 FORBIDDEN for a student, including on themselves', async () => {
    for (const uid of ['new-1', 'stu-1']) {
      const r = await call('POST', `/api/admin/users/${uid}/role`, { token: 'stuTok', body: { role: 'superAdmin' } });
      assert.deepEqual([r.status, r.body.code], [403, 'FORBIDDEN']);
    }
    assert.equal(clients.auth.calls.setCustomUserClaims.length, 0);
  });

  test('a superAdmin sets any role, writes the mirror and revokes the old tokens', async () => {
    const r = await call('POST', '/api/admin/users/stu-1/role', {
      token: 'adminTok',
      body: { role: 'collegeAdmin', collegeId: 'cst' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { uid: 'stu-1', role: 'collegeAdmin', collegeId: 'cst' });
    assert.deepEqual(clients.auth.users['stu-1'].customClaims, { role: 'collegeAdmin', collegeId: 'cst' });
    assert.equal(clients.db.store.get('users/stu-1').role, 'collegeAdmin');
    assert.deepEqual(clients.auth.calls.revokeRefreshTokens, ['stu-1']);
  });

  test('collegeId defaults to null', async () => {
    const r = await call('POST', '/api/admin/users/new-1/role', { token: 'adminTok', body: { role: 'lecturer' } });
    assert.deepEqual(r.body, { uid: 'new-1', role: 'lecturer', collegeId: null });
  });

  test('403 CANNOT_CHANGE_OWN_ROLE for a superAdmin on themselves', async () => {
    const r = await call('POST', '/api/admin/users/sa-1/role', { token: 'adminTok', body: { role: 'student' } });
    assert.deepEqual([r.status, r.body.code], [403, 'CANNOT_CHANGE_OWN_ROLE']);
    assert.equal(clients.auth.users['sa-1'].customClaims.role, 'superAdmin');
  });

  test('404 USER_NOT_FOUND for an unknown uid', async () => {
    const r = await call('POST', '/api/admin/users/nobody/role', { token: 'adminTok', body: { role: 'student' } });
    assert.deepEqual([r.status, r.body.code], [404, 'USER_NOT_FOUND']);
  });

  test('400 INVALID_BODY for an unknown role, extra fields, or a superAdmin with a college', async () => {
    for (const body of [{ role: 'admin' }, { role: 'student', name: 'x' }, { role: 'superAdmin', collegeId: 'cst' }, {}]) {
      const r = await call('POST', '/api/admin/users/stu-1/role', { token: 'adminTok', body });
      assert.deepEqual([r.status, r.body.code], [400, 'INVALID_BODY'], JSON.stringify(body));
    }
    assert.equal(clients.auth.calls.setCustomUserClaims.length, 0);
  });
});
