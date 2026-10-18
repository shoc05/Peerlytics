import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionUser, isTokenRevoked, resolveRole, roleFlags } from './authRole.js';

test('resolveRole prefers the custom claim over the profile mirror', () => {
  assert.equal(resolveRole({ role: 'lecturer' }, { role: 'student' }), 'lecturer');
});

test('resolveRole falls back to a legacy profile role and maps admin to superAdmin', () => {
  assert.equal(resolveRole({}, { role: 'student' }), 'student');
  assert.equal(resolveRole(undefined, { role: 'admin' }), 'superAdmin');
});

test('resolveRole returns null (show the picker) when there is no valid role', () => {
  assert.equal(resolveRole({}, {}), null);
  assert.equal(resolveRole({ role: 'owner' }, { role: 'teacher' }), null);
  assert.equal(resolveRole(null, null), null);
});

test('buildSessionUser never invents a role for an account without one', () => {
  const user = buildSessionUser({ fbUser: { uid: 'u1', email: 'a@b.com', displayName: 'A B' }, claims: {}, profile: null });
  assert.deepEqual(user, {
    uid: 'u1',
    email: 'a@b.com',
    name: 'A B',
    role: null,
    collegeId: null,
    groupId: null,
    classSection: '',
  });
});

test('buildSessionUser takes role and college from the claims', () => {
  const user = buildSessionUser({
    fbUser: { uid: 'u2', email: 'c@d.com' },
    claims: { role: 'collegeAdmin', collegeId: 'cst' },
    profile: { name: 'C', groupId: 'g1', role: 'student' },
  });
  assert.equal(user.role, 'collegeAdmin');
  assert.equal(user.collegeId, 'cst');
  assert.equal(user.groupId, 'g1');
});

test('roleFlags: admin dashboard is for superAdmin only; null role needs the picker', () => {
  assert.equal(roleFlags('superAdmin').isAdmin, true);
  assert.equal(roleFlags('collegeAdmin').isAdmin, false);
  assert.equal(roleFlags('lecturer').isLecturer, true);
  assert.equal(roleFlags(null).needsRole, true);
  assert.equal(roleFlags('student').needsRole, false);
});

test('isTokenRevoked only matches 401 TOKEN_REVOKED', () => {
  assert.equal(isTokenRevoked(401, { code: 'TOKEN_REVOKED' }), true);
  assert.equal(isTokenRevoked(401, { code: 'TOKEN_EXPIRED' }), false);
  assert.equal(isTokenRevoked(403, { code: 'TOKEN_REVOKED' }), false);
});
