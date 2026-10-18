import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimsToRole, mapLegacyRole } from './roles.js';
import { migrateRoles } from './migrate.js';
import { requireRole } from './middleware.js';
import { fakeAuth, fakeDb } from './testFakes.js';

test('claimsToRole keeps only known roles and string college ids', () => {
  assert.deepEqual(claimsToRole({ role: 'lecturer', collegeId: 'cst' }), { role: 'lecturer', collegeId: 'cst' });
  assert.deepEqual(claimsToRole({ role: 'admin', collegeId: 7 }), { role: null, collegeId: null });
  assert.deepEqual(claimsToRole(undefined), { role: null, collegeId: null });
});

test('mapLegacyRole turns admin into superAdmin and drops invalid values', () => {
  assert.equal(mapLegacyRole('admin'), 'superAdmin');
  assert.equal(mapLegacyRole('student'), 'student');
  assert.equal(mapLegacyRole('lecturer'), 'lecturer');
  assert.equal(mapLegacyRole('teacher'), null);
  assert.equal(mapLegacyRole(undefined), null);
});

test('requireRole lets listed roles through only', () => {
  const run = (user) => {
    let status = null;
    let passed = false;
    const res = { status: (s) => ((status = s), { json: () => {} }) };
    requireRole('superAdmin', 'collegeAdmin')({ user }, res, () => (passed = true));
    return passed ? 'next' : status;
  };
  assert.equal(run({ role: 'superAdmin' }), 'next');
  assert.equal(run({ role: 'collegeAdmin' }), 'next');
  assert.equal(run({ role: 'lecturer' }), 403);
  assert.equal(run({ role: null }), 403);
});

test('migrateRoles copies legacy roles into claims and skips the rest', async () => {
  const auth = fakeAuth({
    users: { a: {}, s: {}, done: { customClaims: { role: 'lecturer', collegeId: null } }, bad: {} },
  });
  const db = fakeDb({
    'users/a': { role: 'admin' },
    'users/s': { role: 'student' },
    'users/done': { role: 'student' },
    'users/bad': { role: 'teacher' },
    'users/ghost': { role: 'student' },
  });
  const result = await migrateRoles({ auth, db });
  assert.deepEqual(result.migrated.sort(), ['a', 's']);
  assert.deepEqual(result.skipped, ['done']);
  assert.deepEqual(result.invalid.sort(), ['bad', 'ghost']);
  assert.deepEqual(auth.users.a.customClaims, { role: 'superAdmin', collegeId: null });
  assert.equal(db.store.get('users/a').role, 'superAdmin');
  assert.equal(auth.users.done.customClaims.role, 'lecturer');
});

test('migrateRoles --dry-run changes nothing', async () => {
  const auth = fakeAuth({ users: { s: {} } });
  const db = fakeDb({ 'users/s': { role: 'student' } });
  const result = await migrateRoles({ auth, db, dryRun: true });
  assert.deepEqual(result.migrated, ['s']);
  assert.equal(auth.calls.setCustomUserClaims.length, 0);
});
