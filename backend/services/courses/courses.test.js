import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { generateJoinCode, JOIN_CODE_ALPHABET, JOIN_CODE_PATTERN, normaliseJoinCode } from './joinCode.js';
import { newWorkspaceId } from './groupMirror.js';
import { isCourseAdmin } from './access.js';

describe('join codes', () => {
  test('8 characters from the alphabet, matching the database CHECK', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateJoinCode();
      assert.match(code, JOIN_CODE_PATTERN);
    }
  });

  test('the alphabet has no look-alikes', () => {
    for (const c of '01OIL') assert.equal(JOIN_CODE_ALPHABET.includes(c), false, c);
    assert.equal(new Set(JOIN_CODE_ALPHABET).size, JOIN_CODE_ALPHABET.length);
  });

  test('every character can be drawn', () => {
    let i = 0;
    const code = generateJoinCode(() => i++ % JOIN_CODE_ALPHABET.length);
    assert.equal(code, JOIN_CODE_ALPHABET.slice(0, 8));
  });

  test('typed codes are normalised: case, spaces and dashes', () => {
    assert.equal(normaliseJoinCode('k7qm-3xpa'), 'K7QM3XPA');
    assert.equal(normaliseJoinCode(' K7QM 3XPA '), 'K7QM3XPA');
  });

  test('anything that cannot be a code is null', () => {
    for (const bad of ['', 'K7QM3XP', 'K7QM3XPAA', 'K7QM3XP0', 'K7QM3XP!', null, undefined]) {
      assert.equal(normaliseJoinCode(bad), null, String(bad));
    }
  });
});

describe('workspace ids', () => {
  test('20 characters that fit the workspaces.id CHECK', () => {
    const ids = new Set();
    for (let i = 0; i < 200; i += 1) {
      const id = newWorkspaceId(randomBytes);
      assert.match(id, /^[A-Za-z0-9]{20}$/);
      ids.add(id);
    }
    assert.equal(ids.size, 200);
  });

  test('bytes from 248 up are skipped, so there is no modulo bias', () => {
    const id = newWorkspaceId((n) => Buffer.from([...Array(20).fill(255), ...Array(n - 20).fill(0)]));
    assert.equal(id, 'A'.repeat(20));
  });
});

describe('isCourseAdmin', () => {
  const college = '6f1c2a3e-1111-4222-8333-944455556666';
  test('a superAdmin administers every course', () => {
    assert.equal(isCourseAdmin({ role: 'superAdmin' }, null), true);
  });
  test('a collegeAdmin only their own college', () => {
    assert.equal(isCourseAdmin({ role: 'collegeAdmin', collegeId: college }, college), true);
    assert.equal(isCourseAdmin({ role: 'collegeAdmin', collegeId: college }, null), false);
    assert.equal(isCourseAdmin({ role: 'collegeAdmin', collegeId: null }, null), false);
  });
  test('lecturers and students are not admins', () => {
    assert.equal(isCourseAdmin({ role: 'lecturer', collegeId: college }, college), false);
  });
});
