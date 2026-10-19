// The course, enrolment, announcement, assignment and group routes end to end, on a real
// PostgreSQL (npm run test:db). Firebase Auth and Firestore are stubbed: tokens come from
// src/auth/testFakes.js, and the Firestore group copy is a recorder. Rows created here are
// test fixtures in a throwaway database, not app data.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import client from 'prom-client';
import { createApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { createTestDatabase } from '../db/testDatabase.js';
import { createMetrics } from '../src/metrics/index.js';
import { fakeAuth } from '../src/auth/testFakes.js';
import { createUserRateLimit } from './http.js';

const COLLEGE = '0b5c1f9e-2a71-4c8e-9d3b-6e0f4a2c7b11';
const people = {
  lect: { uid: 'lect-1', email: 'pema.lecturer@rub.edu.bt', role: 'lecturer' },
  lect2: { uid: 'lect-2', email: 'other.lecturer@rub.edu.bt', role: 'lecturer' },
  stu1: { uid: 'stu-1', email: 'stu1@rub.edu.bt', role: 'student' },
  stu2: { uid: 'stu-2', email: 'stu2@rub.edu.bt', role: 'student' },
  stu3: { uid: 'stu-3', email: 'stu3@rub.edu.bt', role: 'student' },
  outsider: { uid: 'stu-9', email: 'outsider@rub.edu.bt', role: 'student' },
  joiner: { uid: 'stu-8', email: 'joiner@rub.edu.bt', role: 'student' },
  collegeAdmin: { uid: 'cadm-1', email: 'cadm@rub.edu.bt', role: 'collegeAdmin', collegeId: COLLEGE },
  superAdmin: { uid: 'sadm-1', email: 'sadm@rub.edu.bt', role: 'superAdmin' },
  noRole: { uid: 'new-1', email: 'new@rub.edu.bt' },
};
const tokens = Object.fromEntries(
  Object.entries(people).map(([k, p]) => [`tok-${k}`, { uid: p.uid, email: p.email, role: p.role, collegeId: p.collegeId ?? null }])
);

/** Records every Firestore write; set failNext to make the next write throw. */
function recordingMirror() {
  const calls = [];
  const mirror = { calls, failNext: false };
  for (const name of ['create', 'update', 'addMember', 'removeMember', 'remove']) {
    mirror[name] = async (...args) => {
      if (mirror.failNext) {
        mirror.failNext = false;
        throw new Error('Firestore is down');
      }
      calls.push([name, ...args]);
    };
  }
  return mirror;
}

let testDb;
let server;
let baseUrl;
const mirror = recordingMirror();
const auth = fakeAuth({ tokens });
// The Admin SDK knows one display name; everyone else falls back to their email.
auth.getUser = async (uid) => ({ uid, displayName: uid === 'lect-1' ? 'Pema Lecturer' : undefined });

before(async () => {
  testDb = await createTestDatabase();
  const db = { pool: testDb.pool, ping: async () => true, close: async () => {} };
  const app = createApp({
    config: loadConfig({}),
    db,
    metrics: createMetrics({ registry: new client.Registry() }),
    courseDeps: {
      getClients: () => ({ auth }),
      mirror,
      joinLimit: createUserRateLimit({ max: 6, windowMs: 60_000 }),
    },
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await testDb.pool.query(`INSERT INTO colleges (id, name, slug) VALUES ($1, 'College of Science and Technology', 'cst')`, [COLLEGE]);
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await testDb?.drop();
});

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer tok-${who}`;
  const res = await fetch(`${baseUrl}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const inAWeek = () => new Date(Date.now() + 7 * 864e5).toISOString();
const sql = (text, params) => testDb.pool.query(text, params);

const state = {};

describe('auth and roles', () => {
  test('no token is 401 NO_TOKEN', async () => {
    const res = await call(null, 'GET', '/courses');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'NO_TOKEN');
  });

  test('a user without a role is 403 NO_ROLE', async () => {
    assert.equal((await call('noRole', 'GET', '/courses')).body.code, 'NO_ROLE');
  });

  test('a student cannot create a course', async () => {
    const res = await call('stu1', 'POST', '/courses', { code: 'CTE412', title: 'Mini project' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });
});

describe('courses and enrolment', () => {
  test('a lecturer creates a course with a random join code and teaches it', async () => {
    const res = await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'Mini project', term: 'Autumn 2026' });
    assert.equal(res.status, 201);
    assert.match(res.body.joinCode, /^[A-HJKMNP-Z2-9]{8}$/);
    assert.equal(res.body.courseRole, 'lecturer');
    assert.equal(res.body.studentCount, 0);
    assert.equal(res.headers.get('location'), `/api/courses/${res.body.id}`);
    state.course = res.body;

    const { rows } = await sql(`SELECT id, display_name, role FROM users ORDER BY id`);
    assert.deepEqual(rows.find((r) => r.id === 'lect-1'), { id: 'lect-1', display_name: 'Pema Lecturer', role: 'lecturer' });
  });

  test('bodies are checked: unknown fields and short titles are 400 INVALID_BODY', async () => {
    const res = await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'X', joinCode: 'AAAAAAAA' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_BODY');
    assert.deepEqual(res.body.details.map((d) => d.path).sort(), ['', 'title']);
  });

  test('students join with the code however they type it', async () => {
    const typed = `${state.course.joinCode.slice(0, 4).toLowerCase()}-${state.course.joinCode.slice(4)}`;
    const res = await call('stu1', 'POST', '/courses/join', { joinCode: typed });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: state.course.id, code: 'CTE412', title: 'Mini project', term: 'Autumn 2026', courseRole: 'student', archived: false });
    for (const who of ['stu2', 'stu3']) assert.equal((await call(who, 'POST', '/courses/join', { joinCode: state.course.joinCode })).status, 200);

    const { rows } = await sql(`SELECT display_name FROM users WHERE id = 'stu-1'`);
    assert.equal(rows[0].display_name, 'stu1', 'no Firebase display name: the email name is used');
  });

  test('joining twice is 409 ALREADY_ENROLLED; an unknown code is 404 INVALID_JOIN_CODE', async () => {
    assert.equal((await call('stu1', 'POST', '/courses/join', { joinCode: state.course.joinCode })).body.code, 'ALREADY_ENROLLED');
    const res = await call('stu1', 'POST', '/courses/join', { joinCode: 'ZZZZZZZZ' });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'INVALID_JOIN_CODE');
  });

  test('lecturers cannot join by code', async () => {
    assert.equal((await call('lect2', 'POST', '/courses/join', { joinCode: state.course.joinCode })).status, 403);
  });

  test('who sees the course: students without the join code; outsiders get 404', async () => {
    const asStudent = await call('stu1', 'GET', `/courses/${state.course.id}`);
    assert.equal(asStudent.status, 200);
    assert.equal(asStudent.body.studentCount, 3);
    assert.equal('joinCode' in asStudent.body, false);

    assert.equal((await call('outsider', 'GET', `/courses/${state.course.id}`)).status, 404);
    assert.equal((await call('lect2', 'GET', `/courses/${state.course.id}`)).status, 404);
    assert.equal((await call('stu1', 'GET', '/courses/not-a-uuid')).status, 404);
  });

  test('a superAdmin sees every course with its join code; a collegeAdmin only their college', async () => {
    const res = await call('superAdmin', 'GET', `/courses/${state.course.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.joinCode, state.course.joinCode);
    assert.equal(res.body.courseRole, null);
    assert.equal((await call('collegeAdmin', 'GET', `/courses/${state.course.id}`)).status, 404, 'course has no college');
    assert.equal((await call('superAdmin', 'GET', '/courses')).body.courses.length, 1);
  });

  test('my courses lists what I am enrolled in', async () => {
    assert.deepEqual((await call('stu1', 'GET', '/courses')).body.courses.map((c) => c.courseRole), ['student']);
    assert.deepEqual((await call('outsider', 'GET', '/courses')).body.courses, []);
  });

  test('only a lecturer of the course can edit it', async () => {
    assert.equal((await call('lect2', 'PATCH', `/courses/${state.course.id}`, { title: 'Hijacked' })).status, 404);
    assert.equal((await call('stu1', 'PATCH', `/courses/${state.course.id}`, { title: 'Hijacked' })).status, 403);
    const res = await call('lect', 'PATCH', `/courses/${state.course.id}`, { title: 'Mini project (CST)', description: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'Mini project (CST)');
  });

  test('turning joining off gives 403 JOIN_DISABLED', async () => {
    await call('lect', 'PATCH', `/courses/${state.course.id}`, { joinCodeEnabled: false });
    const res = await call('joiner', 'POST', '/courses/join', { joinCode: state.course.joinCode });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'JOIN_DISABLED');
    await call('lect', 'PATCH', `/courses/${state.course.id}`, { joinCodeEnabled: true });
  });

  test('a new join code replaces the old one and is audited', async () => {
    const res = await call('lect', 'POST', `/courses/${state.course.id}/join-code`);
    assert.equal(res.status, 200);
    assert.notEqual(res.body.joinCode, state.course.joinCode);
    assert.equal((await call('joiner', 'POST', '/courses/join', { joinCode: state.course.joinCode })).body.code, 'INVALID_JOIN_CODE');
    state.course.joinCode = res.body.joinCode;
    const { rows } = await sql(`SELECT actor_id, action, target_id FROM audit_log`);
    assert.deepEqual(rows, [{ actor_id: 'lect-1', action: 'course.join_code_reset', target_id: state.course.id }]);
  });

  test('guessing codes is rate limited with Retry-After', async () => {
    let res;
    for (let i = 0; i < 6; i += 1) res = await call('joiner', 'POST', '/courses/join', { joinCode: 'ZZZZZZZZ' });
    assert.equal(res.status, 429);
    assert.equal(res.body.code, 'RATE_LIMITED');
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
  });

  test('members: students see names; lecturers also see emails', async () => {
    const asStudent = (await call('stu1', 'GET', `/courses/${state.course.id}/members`)).body.members;
    assert.equal(asStudent.length, 4);
    assert.ok(asStudent.every((m) => !('email' in m)));
    const asLecturer = (await call('lect', 'GET', `/courses/${state.course.id}/members`)).body.members;
    assert.equal(asLecturer[0].courseRole, 'lecturer');
    assert.equal(asLecturer.find((m) => m.id === 'stu-1').email, 'stu1@rub.edu.bt');
  });
});

describe('announcements', () => {
  test('lecturers post; students read, pinned first', async () => {
    assert.equal((await call('stu1', 'POST', `/courses/${state.course.id}/announcements`, { title: 'x', body: 'y' })).status, 403);
    const first = await call('lect', 'POST', `/courses/${state.course.id}/announcements`, { title: 'Welcome', body: 'Groups next week.' });
    assert.equal(first.status, 201);
    assert.deepEqual(first.body.author, { id: 'lect-1', displayName: 'Pema Lecturer' });
    const pinned = await call('lect', 'POST', `/courses/${state.course.id}/announcements`, { title: 'Rubric', body: 'See the brief.', pinned: true });
    const list = (await call('stu1', 'GET', `/courses/${state.course.id}/announcements`)).body.announcements;
    assert.deepEqual(list.map((a) => a.title), ['Rubric', 'Welcome']);
    state.announcement = pinned.body.id;
  });

  test('edit and delete', async () => {
    const edited = await call('lect', 'PATCH', `/announcements/${state.announcement}`, { pinned: false });
    assert.equal(edited.body.pinned, false);
    assert.equal((await call('lect2', 'DELETE', `/announcements/${state.announcement}`)).status, 404);
    assert.equal((await call('lect', 'DELETE', `/announcements/${state.announcement}`)).status, 204);
    assert.equal((await call('lect', 'PATCH', `/announcements/${state.announcement}`, { pinned: true })).status, 404);
  });
});

describe('assignments', () => {
  test('weights default to 0.25 each', async () => {
    const res = await call('lect', 'POST', `/courses/${state.course.id}/assignments`, { title: 'Group report', brief: 'Write 2,000 words.', deadline: inAWeek() });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.weights, { time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 });
    assert.equal(res.body.groupCount, 0);
    state.assignment = res.body;
  });

  test('custom weights must add up to 1.00', async () => {
    const base = { title: 'Essay', brief: 'Write.', deadline: inAWeek() };
    const bad = await call('lect', 'POST', `/courses/${state.course.id}/assignments`, { ...base, weights: { time: 0.5, edits: 0.5, writing: 0.5, tasks: 0 } });
    assert.equal(bad.body.code, 'INVALID_BODY');
    const good = await call('lect', 'POST', `/courses/${state.course.id}/assignments`, { ...base, weights: { time: 0.1, edits: 0.2, writing: 0.3, tasks: 0.4 } });
    assert.equal(good.status, 201);
    assert.deepEqual(good.body.weights, { time: 0.1, edits: 0.2, writing: 0.3, tasks: 0.4 });
    state.essay = good.body;
  });

  test('a deadline in the past is 400 DEADLINE_IN_PAST', async () => {
    const res = await call('lect', 'POST', `/courses/${state.course.id}/assignments`, { title: 'Late', brief: 'x', deadline: '2020-01-01T00:00:00Z' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'DEADLINE_IN_PAST');
  });

  test('students see their group and effective deadline', async () => {
    const list = (await call('stu1', 'GET', `/courses/${state.course.id}/assignments`)).body.assignments;
    assert.equal(list.length, 2);
    assert.equal(list[0].myWorkspaceId, null);
    assert.equal(list[0].effectiveDeadline, list[0].deadline);
    const asLecturer = (await call('lect', 'GET', `/assignments/${state.assignment.id}`)).body;
    assert.equal('myWorkspaceId' in asLecturer, false);
  });
});

describe('groups and workspaces', () => {
  test('a lecturer creates a group; Firestore gets the same members and the course lecturers', async () => {
    const res = await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'Group 1', memberIds: ['stu-1', 'stu-2'] });
    assert.equal(res.status, 201);
    assert.match(res.body.id, /^[A-Za-z0-9]{20}$/);
    assert.deepEqual(res.body.members.map((m) => m.id), ['stu-1', 'stu-2']);
    assert.equal(res.body.status, 'open');
    state.group = res.body;

    const [name, doc] = mirror.calls.at(-1);
    assert.equal(name, 'create');
    assert.deepEqual(doc, {
      id: res.body.id,
      name: 'Group 1',
      deadline: state.assignment.deadline,
      memberIds: ['stu-1', 'stu-2'],
      lecturerIds: ['lect-1'],
      courseId: state.course.id,
      assignmentId: state.assignment.id,
    });
  });

  test('a student already in a group for the assignment is 409 ALREADY_IN_GROUP, and nothing is created', async () => {
    const before = mirror.calls.length;
    const res = await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'Group 2', memberIds: ['stu-3', 'stu-1'] });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'ALREADY_IN_GROUP');
    assert.equal(mirror.calls.length, before);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM workspaces`)).rows[0].n, 1);
  });

  test('members must be students in the course; names are unique per assignment', async () => {
    assert.equal((await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'Group 2', memberIds: ['stu-9'] })).body.code, 'NOT_ENROLLED');
    assert.equal((await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'Group 2', memberIds: ['lect-1'] })).body.code, 'NOT_ENROLLED');
    const dup = await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'Group 1' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'CONFLICT');
  });

  test('if Firestore fails, the PostgreSQL rows are rolled back', async () => {
    mirror.failNext = true;
    const res = await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'Group 2', memberIds: ['stu-3'] });
    assert.equal(res.status, 500);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM workspaces`)).rows[0].n, 1);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM workspace_members WHERE user_id = 'stu-3'`)).rows[0].n, 0);
  });

  test('the Groups tab: lecturers see ungrouped students and emails; students do not', async () => {
    const asLecturer = (await call('lect', 'GET', `/assignments/${state.assignment.id}/groups`)).body;
    assert.deepEqual(asLecturer.ungroupedStudents.map((s) => s.id), ['stu-3']);
    assert.equal(asLecturer.groups[0].members[0].email, 'stu1@rub.edu.bt');
    const asStudent = (await call('stu3', 'GET', `/assignments/${state.assignment.id}/groups`)).body;
    assert.deepEqual(asStudent.ungroupedStudents, []);
    assert.equal('email' in asStudent.groups[0].members[0], false);
  });

  test('students see their own workspaces only', async () => {
    assert.deepEqual((await call('stu1', 'GET', '/me/workspaces')).body.workspaces.map((w) => w.id), [state.group.id]);
    assert.equal((await call('stu1', 'GET', `/workspaces/${state.group.id}`)).status, 200);
    assert.equal((await call('stu3', 'GET', `/workspaces/${state.group.id}`)).status, 404);
    const mine = (await call('stu1', 'GET', `/courses/${state.course.id}/assignments`)).body.assignments.find((a) => a.id === state.assignment.id);
    assert.equal(mine.myWorkspaceId, state.group.id);
  });

  test('add, rename and remove keep Firestore in step', async () => {
    const added = await call('lect', 'POST', `/workspaces/${state.group.id}/members`, { userId: 'stu-3' });
    assert.equal(added.status, 200);
    assert.deepEqual(mirror.calls.at(-1), ['addMember', state.group.id, 'stu-3']);

    const renamed = await call('lect', 'PATCH', `/workspaces/${state.group.id}`, { name: 'Team Druk' });
    assert.equal(renamed.body.name, 'Team Druk');
    assert.deepEqual(mirror.calls.at(-1), ['update', state.group.id, { name: 'Team Druk' }]);

    assert.equal((await call('lect', 'DELETE', `/workspaces/${state.group.id}/members/stu-3`)).status, 204);
    assert.deepEqual(mirror.calls.at(-1), ['removeMember', state.group.id, 'stu-3']);
    assert.equal((await call('lect', 'DELETE', `/workspaces/${state.group.id}/members/stu-3`)).status, 404);
  });

  test('moving the deadline updates every group in Firestore', async () => {
    const deadline = new Date(Date.now() + 14 * 864e5).toISOString();
    const res = await call('lect', 'PATCH', `/assignments/${state.assignment.id}`, { deadline });
    assert.equal(res.body.deadline, deadline);
    assert.deepEqual(mirror.calls.at(-1), ['update', state.group.id, { deadline }]);
  });

  test('a submitted workspace is locked: 409 WORKSPACE_SUBMITTED', async () => {
    await sql(`UPDATE workspaces SET status = 'submitted' WHERE id = $1`, [state.group.id]);
    await sql(
      `INSERT INTO submissions (workspace_id, submitted_by, trigger, word_count, author_metrics, document_ref)
       VALUES ($1, 'stu-1', 'manual', 1800, '{}', 'groups/x/files/y')`,
      [state.group.id]
    );
    const res = await call('lect', 'POST', `/workspaces/${state.group.id}/members`, { userId: 'stu-3' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'WORKSPACE_SUBMITTED');
    assert.ok((await call('lect', 'GET', `/workspaces/${state.group.id}`)).body.submittedAt);
  });

  test('an assignment with submissions cannot be deleted; one without can', async () => {
    assert.equal((await call('lect', 'DELETE', `/assignments/${state.assignment.id}`)).body.code, 'HAS_SUBMISSIONS');
    const g = await call('lect', 'POST', `/assignments/${state.essay.id}/groups`, { name: 'Essay group' });
    assert.equal((await call('lect', 'DELETE', `/assignments/${state.essay.id}`)).status, 204);
    assert.deepEqual(mirror.calls.at(-1), ['remove', g.body.id]);
    assert.equal((await call('lect', 'GET', `/assignments/${state.essay.id}`)).status, 404);
  });
});

describe('grades and removal', () => {
  test('students see only their own grade; the latest override is final', async () => {
    const { rows } = await sql(
      `INSERT INTO grades (workspace_id, user_id, time_score, edits_score, writing_score, tasks_score, weights, suggested, explanation)
       VALUES ($1, 'stu-1', 8, 7, 6, 9, '{"time":0.25,"edits":0.25,"writing":0.25,"tasks":0.25}', 7.5, 'Steady work.'),
              ($1, 'stu-2', 5, 4, 6, 3, '{"time":0.25,"edits":0.25,"writing":0.25,"tasks":0.25}', 4.5, 'Few edits.')
       RETURNING id, user_id`,
      [state.group.id]
    );
    const stu1Grade = rows.find((r) => r.user_id === 'stu-1').id;
    await sql(`INSERT INTO overrides (grade_id, lecturer_id, previous_grade, new_grade, reason) VALUES ($1, 'lect-1', 7.5, 8, 'Led the group')`, [stu1Grade]);

    const mine = (await call('stu1', 'GET', `/courses/${state.course.id}/grades`)).body.grades;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].suggested, 7.5);
    assert.equal(mine[0].final, 8);
    assert.equal(mine[0].overridden, true);
    assert.deepEqual(mine[0].scores, { time: 8, edits: 7, writing: 6, tasks: 9 });

    const all = (await call('lect', 'GET', `/courses/${state.course.id}/grades?assignmentId=${state.assignment.id}`)).body.grades;
    assert.deepEqual(all.map((g) => [g.student.id, g.final]), [['stu-1', 8], ['stu-2', 4.5]]);
  });

  test('removing a student from the course takes them out of open groups only', async () => {
    const other = await call('lect', 'POST', `/courses/${state.course.id}/assignments`, { title: 'Second', brief: 'x', deadline: inAWeek() });
    const open = await call('lect', 'POST', `/assignments/${other.body.id}/groups`, { name: 'G', memberIds: ['stu-2'] });
    assert.equal((await call('lect', 'DELETE', `/courses/${state.course.id}/members/stu-2`)).status, 204);
    assert.deepEqual(mirror.calls.at(-1), ['removeMember', open.body.id, 'stu-2']);
    const { rows } = await sql(`SELECT workspace_id FROM workspace_members WHERE user_id = 'stu-2'`);
    assert.deepEqual(rows.map((r) => r.workspace_id), [state.group.id], 'the submitted group keeps its history');
    assert.equal((await call('stu2', 'GET', `/courses/${state.course.id}`)).status, 404);
    assert.equal((await call('lect', 'DELETE', `/courses/${state.course.id}/members/lect-1`)).status, 404, 'lecturers are not removed this way');
  });
});

describe('archived courses', () => {
  test('are read-only until unarchived', async () => {
    assert.equal((await call('lect', 'PATCH', `/courses/${state.course.id}`, { archived: true })).body.archived, true);
    assert.equal((await call('lect', 'POST', `/courses/${state.course.id}/announcements`, { title: 'x', body: 'y' })).body.code, 'COURSE_ARCHIVED');
    assert.equal((await call('lect', 'PATCH', `/courses/${state.course.id}`, { title: 'Renamed' })).body.code, 'COURSE_ARCHIVED');
    assert.deepEqual((await call('stu1', 'GET', '/courses')).body.courses, []);
    assert.equal((await call('stu1', 'GET', '/courses?includeArchived=true')).body.courses.length, 1);
    assert.equal((await call('lect', 'PATCH', `/courses/${state.course.id}`, { archived: false })).body.archived, false);
  });
});
