import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assignmentCreate, assignmentUpdate, courseCreate, courseUpdate, rubricWeights, workspaceCreate } from './courseSchemas.js';
import { createUserRateLimit, HttpError } from './http.js';

const ok = (schema, v) => assert.equal(schema.safeParse(v).success, true, JSON.stringify(v));
const bad = (schema, v) => assert.equal(schema.safeParse(v).success, false, JSON.stringify(v));

describe('rubric weights', () => {
  test('the default split and other splits that add up to 1.00 pass', () => {
    ok(rubricWeights, { time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 });
    ok(rubricWeights, { time: 0.1, edits: 0.2, writing: 0.6, tasks: 0.1 });
    ok(rubricWeights, { time: 0, edits: 0, writing: 1, tasks: 0 });
  });

  test('0.1 + 0.2 + 0.3 + 0.4 is exactly 1.00 despite floating point', () => {
    ok(rubricWeights, { time: 0.1, edits: 0.2, writing: 0.3, tasks: 0.4 });
  });

  test('sums other than 1.00, steps finer than 0.01, and missing weights fail', () => {
    bad(rubricWeights, { time: 0.3, edits: 0.3, writing: 0.3, tasks: 0.3 });
    bad(rubricWeights, { time: 0.255, edits: 0.245, writing: 0.25, tasks: 0.25 });
    bad(rubricWeights, { time: 0.5, edits: 0.5, writing: 0 });
    bad(rubricWeights, { time: -0.25, edits: 0.75, writing: 0.25, tasks: 0.25 });
  });
});

describe('assignment bodies', () => {
  const base = { title: 'Report', brief: 'Write a report', deadline: '2026-11-01T17:00:00+06:00' };
  test('weights are optional on create', () => ok(assignmentCreate, base));
  test('the deadline needs a time zone offset', () => bad(assignmentCreate, { ...base, deadline: '2026-11-01T17:00' }));
  test('unknown fields are rejected', () => bad(assignmentCreate, { ...base, grade: 10 }));
  test('an update needs at least one field', () => {
    bad(assignmentUpdate, {});
    ok(assignmentUpdate, { groupSize: null });
  });
});

describe('course bodies', () => {
  test('code and title are required, and trimmed', () => {
    const parsed = courseCreate.parse({ code: ' CTE412 ', title: ' Mini project ' });
    assert.deepEqual(parsed, { code: 'CTE412', title: 'Mini project' });
    bad(courseCreate, { code: 'C', title: 'Mini project' });
  });
  test('an update needs at least one field; joinCode cannot be set directly', () => {
    bad(courseUpdate, {});
    bad(courseUpdate, { joinCode: 'K7QM3XPA' });
    ok(courseUpdate, { archived: true });
  });
});

describe('workspace bodies', () => {
  test('a student listed twice is rejected', () => {
    bad(workspaceCreate, { name: 'Group 1', memberIds: ['a', 'a'] });
    ok(workspaceCreate, { name: 'Group 1', memberIds: ['a', 'b'] });
  });
});

describe('createUserRateLimit', () => {
  test('allows max calls per window, then throws 429 with Retry-After', () => {
    let t = 0;
    const check = createUserRateLimit({ max: 2, windowMs: 60_000, now: () => t });
    check('u1');
    check('u1');
    check('u2');
    t = 15_000;
    assert.throws(
      () => check('u1'),
      (err) => err instanceof HttpError && err.status === 429 && err.code === 'RATE_LIMITED' && err.retryAfter === 45
    );
    t = 60_001;
    check('u1');
  });
});
