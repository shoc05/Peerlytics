// The admin store against a real PostgreSQL (npm run test:db). Each run creates its own migrated
// throwaway database and drops it afterwards. Rows inserted here are test fixtures, not app data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { createAdminStore } from './store.js';

const adminUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
const dbName = `peerlytics_itest_${randomBytes(4).toString('hex')}`;
const LICENCE = { plan: 'trial', seats: 30, monthlyAiBudgetUsd: 12.5, startsOn: '2026-01-01', endsOn: null };

let pool;
let store;

async function adminQuery(sql) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

before(async () => {
  assert.ok(adminUrl, 'Set TEST_DATABASE_URL (or DATABASE_URL) to run the database tests.');
  await adminQuery(`CREATE DATABASE ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  await runner({ databaseUrl: url.toString(), dir: migrationsDir, direction: 'up', migrationsTable: 'pgmigrations', log: () => {} });
  pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
  store = createAdminStore(pool);
});

after(async () => {
  await pool?.end();
  if (adminUrl) await adminQuery(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

const auditRows = (targetId) =>
  pool.query('SELECT actor_id, action, target_type, details FROM audit_log WHERE target_id = $1 ORDER BY id', [targetId]).then((r) => r.rows);

describe('admin store on PostgreSQL', () => {
  test('a new college has no licence, and creating it is audited', async () => {
    const college = await store.createCollege({ name: 'Audit College', slug: 'audit' }, 'admin-1');
    assert.equal(college.licence, null);
    const listed = (await store.listColleges()).find((c) => c.id === college.id);
    assert.equal(listed.licence, null);
    const [row] = await auditRows(college.id);
    assert.equal(row.action, 'college.created');
    assert.equal(row.details.by, 'admin-1');
  });

  test('a repeated slug is SLUG_TAKEN and writes nothing', async () => {
    await store.createCollege({ name: 'First', slug: 'same' }, 'admin-1');
    await assert.rejects(store.createCollege({ name: 'Second', slug: 'same' }, 'admin-1'), { code: 'SLUG_TAKEN' });
    const names = (await store.listColleges()).map((c) => c.name);
    assert.equal(names.includes('Second'), false);
  });

  test('stores a licence with plain dates and a numeric budget, and audits it', async () => {
    const college = await store.createCollege({ name: 'Licence College', slug: 'licence' }, 'admin-1');
    const licence = await store.addLicence(college.id, LICENCE, 'admin-1');
    assert.equal(licence.startsOn, '2026-01-01');
    assert.equal(licence.endsOn, null);
    assert.equal(licence.monthlyAiBudgetUsd, 12.5);
    const rows = await auditRows(college.id);
    assert.deepEqual(rows.map((r) => r.action), ['college.created', 'licence.created']);
    assert.equal(rows[1].details.seats, 30);
  });

  test('the licence with the latest start date is current, and the older one is kept', async () => {
    const college = await store.createCollege({ name: 'History College', slug: 'history' }, 'admin-1');
    await store.addLicence(college.id, { ...LICENCE, startsOn: '2027-01-01', seats: 200 }, 'admin-1');
    await store.addLicence(college.id, { ...LICENCE, startsOn: '2026-01-01', seats: 50 }, 'admin-1');
    const listed = (await store.listColleges()).find((c) => c.id === college.id);
    assert.equal(listed.licence.seats, 200);
    assert.equal(listed.licence.startsOn, '2027-01-01');
    assert.equal(listed.licence.monthlyAiBudgetUsd, 12.5);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM licences WHERE college_id = $1', [college.id]);
    assert.equal(rows[0].n, 2);
  });

  test('a licence for a college that does not exist is NOT_FOUND and leaves no audit row', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await assert.rejects(store.addLicence(missing, LICENCE, 'admin-1'), { code: 'NOT_FOUND' });
    assert.deepEqual(await auditRows(missing), []);
  });
});
