import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideAccess, documentName, parseDocumentName } from './access.js';

const group = { memberIds: ['stu'], lecturerIds: ['lec'], submittedToLecturers: [] };
const file = { name: 'Report', submitted: false };

test('document names round-trip and reject anything else', () => {
  assert.equal(documentName('g1', 'file-1'), 'group:g1:file:file-1');
  assert.deepEqual(parseDocumentName('group:g1:file:file-1'), { groupId: 'g1', fileId: 'file-1' });
  for (const bad of ['', 'g1/file-1', 'group:g1', 'group:../x:file:y', 'group:g1:file:f1:extra', null]) {
    assert.equal(parseDocumentName(bad), null, String(bad));
  }
});

test('a student member writes', () => {
  assert.deepEqual(decideAccess({ uid: 'stu', role: 'student', group, file }), { allow: true, readOnly: false });
  // Accounts without a role yet are treated like students only if they are members.
  assert.deepEqual(decideAccess({ uid: 'stu', role: null, group, file }), { allow: true, readOnly: false });
});

test('a submitted file or a locked workspace is read-only for students', () => {
  assert.deepEqual(decideAccess({ uid: 'stu', role: 'student', group, file: { submitted: true } }), { allow: true, readOnly: true });
  assert.deepEqual(decideAccess({ uid: 'stu', role: 'student', group: { ...group, locked: true }, file }), { allow: true, readOnly: true });
});

test('a lecturer reads only after a student submitted to them, never writes', () => {
  assert.deepEqual(decideAccess({ uid: 'lec', role: 'lecturer', group, file }), { allow: false, reason: 'NOT_SUBMITTED' });
  const submitted = { ...group, submittedToLecturers: ['lec'] };
  assert.deepEqual(decideAccess({ uid: 'lec', role: 'lecturer', group: submitted, file }), { allow: true, readOnly: true });
  // A lecturer listed in memberIds still gets the lecturer rule.
  const inMembers = { ...group, memberIds: ['stu', 'lec'] };
  assert.equal(decideAccess({ uid: 'lec', role: 'lecturer', group: inMembers, file }).allow, false);
});

test('outsiders, missing workspaces and missing files are refused', () => {
  assert.equal(decideAccess({ uid: 'other', role: 'student', group, file }).reason, 'NOT_A_MEMBER');
  assert.equal(decideAccess({ uid: 'other', role: 'superAdmin', group, file }).reason, 'NOT_A_MEMBER');
  assert.equal(decideAccess({ uid: 'stu', role: 'student', group: null, file }).reason, 'NO_WORKSPACE');
  assert.equal(decideAccess({ uid: 'stu', role: 'student', group, file: null }).reason, 'NO_FILE');
  assert.equal(decideAccess({ uid: null, group, file }).reason, 'NO_TOKEN');
});
