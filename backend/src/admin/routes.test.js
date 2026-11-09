// The admin routes with a stubbed store and Firebase. The SQL is tested in store.pg.itest.js.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import { fakeAuth } from '../auth/testFakes.js';
import { createAdminRouter } from './routes.js';
import { StoreError } from './store.js';

const COLLEGE_ID = '6f1c2a54-7a0e-4a3b-9d55-0c3e8e9a1b20';
const LICENCE = { plan: 'standard', seats: 100, monthlyAiBudgetUsd: 25.5, startsOn: '2026-01-01', endsOn: '2026-12-31' };

const clients = {
  auth: fakeAuth({
    tokens: {
      admin: { uid: 'admin-1', role: 'superAdmin' },
      collegeAdmin: { uid: 'ca-1', role: 'collegeAdmin', collegeId: 'c1' },
      lecturer: { uid: 'lec-1', role: 'lecturer' },
      unassigned: { uid: 'new-user' },
    },
  }),
};

let enabled;
let calls;
let store;
let server;
let baseUrl;

function listen(options) {
  const app = express();
  app.use(express.json());
  app.use('/api', createAdminRouter({ getClients: () => clients, isEnabled: async (name) => (typeof enabled === 'object' ? Boolean(enabled[name]) : enabled), ...options }));
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function call(path, { method = 'GET', token = 'admin', body, base = baseUrl } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  store = {
    listColleges: async () => {
      calls.push(['list']);
      return [];
    },
    createCollege: async (data, by) => {
      calls.push(['college', data, by]);
      if (data.slug === 'taken') throw new StoreError('SLUG_TAKEN');
      return { id: COLLEGE_ID, ...data, licence: null };
    },
    addLicence: async (id, data, by) => {
      calls.push(['licence', id, data, by]);
      return { id: 'l1', ...data };
    },
  };
  server = await listen({ store });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  enabled = true;
  calls = [];
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('who can use the admin routes', () => {
  const routes = [
    ['/admin/colleges', 'GET'],
    ['/admin/colleges', 'POST'],
    [`/admin/colleges/${COLLEGE_ID}/licences`, 'POST'],
  ];

  for (const [path, method] of routes) {
    test(`${method} ${path} needs a token`, async () => {
      assert.equal((await call(path, { method, token: null, body: method === 'POST' ? {} : undefined })).status, 401);
    });

    test(`${method} ${path} is only for a superAdmin`, async () => {
      for (const token of ['collegeAdmin', 'lecturer', 'unassigned']) {
        assert.equal((await call(path, { method, token, body: method === 'POST' ? {} : undefined })).status, 403, token);
      }
      assert.deepEqual(calls, []);
    });

    test(`${method} ${path} is off while licensing_enabled and billing_enabled are off`, async () => {
      enabled = false;
      const res = await call(path, { method, body: method === 'POST' ? {} : undefined });
      assert.deepEqual([res.status, res.body.code], [404, 'FEATURE_DISABLED']);
      assert.deepEqual(calls, []);
    });
  }

  test('billing_enabled alone turns colleges on, but not licences', async () => {
    enabled = { billing_enabled: true };
    assert.equal((await call('/admin/colleges')).status, 200);
    const licence = await call(`/admin/colleges/${COLLEGE_ID}/licences`, { method: 'POST', body: {} });
    assert.deepEqual([licence.status, licence.body.code], [404, 'FEATURE_DISABLED']);
  });

  test('a superAdmin gets 503 when there is no database', async () => {
    const s = await listen({ db: { pool: null } });
    const res = await call('/admin/colleges', { base: `http://127.0.0.1:${s.address().port}` });
    await new Promise((resolve) => s.close(resolve));
    assert.deepEqual([res.status, res.body.code], [503, 'DATABASE_UNAVAILABLE']);
  });
});

describe('colleges', () => {
  test('lists them', async () => {
    const res = await call('/admin/colleges');
    assert.deepEqual([res.status, res.body], [200, { colleges: [] }]);
  });

  test('creates one and records who did it', async () => {
    const res = await call('/admin/colleges', { method: 'POST', body: { name: '  Science College ', slug: 'cst' } });
    assert.equal(res.status, 201);
    assert.deepEqual(calls, [['college', { name: 'Science College', slug: 'cst' }, 'admin-1']]);
  });

  test('a taken slug is a 409', async () => {
    const res = await call('/admin/colleges', { method: 'POST', body: { name: 'Another', slug: 'taken' } });
    assert.deepEqual([res.status, res.body.code], [409, 'SLUG_TAKEN']);
  });

  test('rejects a bad slug, a short name and extra fields without echoing them', async () => {
    for (const body of [
      { name: 'Science', slug: 'Not Valid' },
      { name: 'x', slug: 'cst' },
      { name: 'Science', slug: 'cst', extra: 'secret-value' },
    ]) {
      const res = await call('/admin/colleges', { method: 'POST', body });
      assert.deepEqual([res.status, res.body.code], [400, 'INVALID_BODY']);
      assert.doesNotMatch(JSON.stringify(res.body), /secret-value|Not Valid/);
    }
    assert.deepEqual(calls, []);
  });
});

describe('licences', () => {
  const path = `/admin/colleges/${COLLEGE_ID}/licences`;

  test('adds one', async () => {
    const res = await call(path, { method: 'POST', body: LICENCE });
    assert.equal(res.status, 201);
    assert.deepEqual(calls, [['licence', COLLEGE_ID, LICENCE, 'admin-1']]);
  });

  test('no end date is stored as null', async () => {
    const open = { ...LICENCE };
    delete open.endsOn;
    await call(path, { method: 'POST', body: open });
    assert.equal(calls[0][2].endsOn, null);
  });

  test('rejects bad values', async () => {
    for (const change of [
      { plan: 'free' },
      { seats: 0 },
      { seats: 1.5 },
      { monthlyAiBudgetUsd: -1 },
      { startsOn: '2026-02-31' },
      { startsOn: '01/02/2026' },
      { endsOn: '2026-01-01' },
      { endsOn: '2025-12-31' },
    ]) {
      const res = await call(path, { method: 'POST', body: { ...LICENCE, ...change } });
      assert.equal(res.status, 400, JSON.stringify(change));
    }
    assert.deepEqual(calls, []);
  });

  test('a college id that is not a uuid is a 404', async () => {
    const res = await call('/admin/colleges/nope/licences', { method: 'POST', body: LICENCE });
    assert.deepEqual([res.status, res.body.code], [404, 'NOT_FOUND']);
  });

  test('a college that does not exist is a 404', async () => {
    store.addLicence = async () => {
      throw new StoreError('NOT_FOUND');
    };
    const res = await call(path, { method: 'POST', body: LICENCE });
    assert.deepEqual([res.status, res.body.code], [404, 'NOT_FOUND']);
  });
});
