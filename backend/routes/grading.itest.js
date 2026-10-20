// Tasks, server-side grades, overrides and the CSV export on a real PostgreSQL
// (npm run test:db). Firebase Auth, Firestore and the AI providers are stubbed; grading,
// the database and the append-only overrides are real. Rows are test fixtures.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import client from 'prom-client';
import { createApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { createTestDatabase } from '../db/testDatabase.js';
import { createMetrics } from '../src/metrics/index.js';
import { fakeAuth } from '../src/auth/testFakes.js';
import { buildAuthorMetrics } from '../services/submissions/workspaceStore.js';

const people = {
  lect: { uid: 'lect-1', email: 'lecturer@rub.edu.bt', role: 'lecturer' },
  lect2: { uid: 'lect-2', email: 'other@rub.edu.bt', role: 'lecturer' },
  stu1: { uid: 'stu-1', email: 'stu1@rub.edu.bt', role: 'student' },
  stu2: { uid: 'stu-2', email: 'stu2@rub.edu.bt', role: 'student' },
  stu3: { uid: 'stu-3', email: 'stu3@rub.edu.bt', role: 'student' },
};
const tokens = Object.fromEntries(Object.entries(people).map(([k, p]) => [`tok-${k}`, { uid: p.uid, email: p.email, role: p.role, collegeId: null }]));

// The analysis is stubbed at the service level: one completed row with writing_quality 8.
const analysis = {
  async run(q, { submissionId }) {
    const { rows } = await q.query(
      `INSERT INTO analysis_results (submission_id, provider, status, ai_likelihood, flagged_sentences, writing_quality, writing_feedback, difficulty, result)
       VALUES ($1, 'legacy', 'completed', 30, '[]', 8, '{"strengths":[],"weaknesses":[],"summary":""}', 2, '{}') RETURNING *`,
      [submissionId]
    );
    return rows[0];
  },
};
const firestoreMetrics = [
  { uid: 'stu-1', timeSpent: 60, edits: 80 }, // 60 min, the cap
  { uid: 'stu-2', timeSpent: 15, edits: 20 },
];
const store = {
  readSubmission: async (_w, _f, members) => ({
    text: 'Enough submitted text to analyse for this group.',
    authorMetrics: buildAuthorMetrics(members, firestoreMetrics, [{ userId: 'stu-2', changeType: 'paste-large' }]),
  }),
  readSubmittedText: async () => 'Enough submitted text to analyse for this group.',
  markSubmitted: async () => {},
  recordEvents: async () => {},
};
const mirror = Object.fromEntries(['create', 'update', 'addMember', 'removeMember', 'remove'].map((n) => [n, async () => {}]));

let testDb;
let server;
let baseUrl;
const state = {};
const sql = (text, params) => testDb.pool.query(text, params);

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer tok-${who}`;
  const res = await fetch(`${baseUrl}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = res.headers.get('content-type')?.includes('json');
  return { status: res.status, body: json && text ? JSON.parse(text) : text, headers: res.headers };
}

before(async () => {
  testDb = await createTestDatabase();
  const app = createApp({
    config: loadConfig({}),
    db: { pool: testDb.pool, ping: async () => true, close: async () => {} },
    metrics: createMetrics({ registry: new client.Registry() }),
    courseDeps: { getClients: () => ({ auth: fakeAuth({ tokens }) }), mirror },
    submissionDeps: { analysis, store },
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  state.course = (await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'Mini project' })).body;
  for (const who of ['stu1', 'stu2', 'stu3']) await call(who, 'POST', '/courses/join', { joinCode: state.course.joinCode });
  state.assignment = (
    await call('lect', 'POST', `/courses/${state.course.id}/assignments`, {
      title: 'Report',
      brief: 'Write.',
      deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
      timeCapMinutes: 60,
    })
  ).body;
  state.group = (await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'G1', memberIds: ['stu-1', 'stu-2'] })).body;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await testDb?.drop();
});

describe('tasks', () => {
  test('a member adds a task for a teammate, linked to a tab', async () => {
    const res = await call('stu1', 'POST', `/workspaces/${state.group.id}/tasks`, { title: 'Write the introduction', ownerId: 'stu-1', tabId: 'intro01' });
    assert.equal(res.status, 201);
    assert.deepEqual([res.body.title, res.body.owner.id, res.body.tabId, res.body.doneAt], ['Write the introduction', 'stu-1', 'intro01', null]);
    state.task1 = res.body.id;
    state.task2 = (await call('stu2', 'POST', `/workspaces/${state.group.id}/tasks`, { title: 'Find sources', ownerId: 'stu-2' })).body.id;
  });

  test('owners must be in the group; tab ids are checked', async () => {
    assert.equal((await call('stu1', 'POST', `/workspaces/${state.group.id}/tasks`, { title: 'x', ownerId: 'stu-3' })).body.code, 'NOT_A_MEMBER');
    assert.equal((await call('stu1', 'POST', `/workspaces/${state.group.id}/tasks`, { title: 'x', tabId: 'bad.tab' })).body.code, 'INVALID_BODY');
  });

  test('only members change tasks; lecturers read them only after submission', async () => {
    assert.equal((await call('stu3', 'POST', `/workspaces/${state.group.id}/tasks`, { title: 'x' })).status, 404);
    assert.equal((await call('lect', 'POST', `/workspaces/${state.group.id}/tasks`, { title: 'x' })).status, 403);
    assert.equal((await call('lect', 'GET', `/workspaces/${state.group.id}/tasks`)).body.code, 'NOT_SUBMITTED');
    assert.equal((await call('stu3', 'PATCH', `/tasks/${state.task1}`, { done: true })).status, 404);
  });

  test('ticking done records when and who; unticking clears both', async () => {
    const done = await call('stu1', 'PATCH', `/tasks/${state.task1}`, { done: true });
    assert.ok(done.body.doneAt);
    assert.equal(done.body.doneBy, 'stu-1');
    const undone = await call('stu1', 'PATCH', `/tasks/${state.task1}`, { done: false });
    assert.deepEqual([undone.body.doneAt, undone.body.doneBy], [null, null]);
    await call('stu2', 'PATCH', `/tasks/${state.task1}`, { done: true, dueAt: new Date(Date.now() + 864e5).toISOString() });
  });

  test('add and delete', async () => {
    const extra = await call('stu1', 'POST', `/workspaces/${state.group.id}/tasks`, { title: 'Temporary' });
    assert.equal((await call('stu1', 'DELETE', `/tasks/${extra.body.id}`)).status, 204);
    assert.deepEqual((await call('stu1', 'GET', `/workspaces/${state.group.id}/tasks`)).body.tasks.map((t) => t.title), ['Find sources', 'Write the introduction']);
  });
});

describe('grades after submission', () => {
  test('submitting computes a suggested grade for every member', async () => {
    assert.equal((await call('stu1', 'POST', `/workspaces/${state.group.id}/submission`, { fileId: 'f1' })).status, 201);
    const grades = (await call('lect', 'GET', `/workspaces/${state.group.id}/grades`)).body.grades;
    const byId = Object.fromEntries(grades.map((g) => [g.student.id, g]));

    // stu-1: full time, above fair share, writing 8, their one task done -> 9.5
    assert.deepEqual(byId['stu-1'].scores, { time: 10, edits: 10, writing: 8, tasks: 10 });
    assert.equal(byId['stu-1'].suggested, 9.5);
    assert.deepEqual(byId['stu-1'].deductions, []);
    // stu-2: 15 of 60 min, 20 of 50 edits, writing 8, task not done, one large paste (−1)
    assert.deepEqual(byId['stu-2'].scores, { time: 2.5, edits: 4, writing: 8, tasks: 0 });
    assert.deepEqual(byId['stu-2'].deductions.map((d) => [d.kind, d.points]), [['paste', 1]]);
    assert.equal(byId['stu-2'].suggested, 2.63);
    assert.match(byId['stu-2'].explanation, /1 large paste by this student/);
    assert.deepEqual(byId['stu-2'].weights, { time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 });
    state.grades = byId;
  });

  test('students see only their own grade', async () => {
    const mine = (await call('stu2', 'GET', `/workspaces/${state.group.id}/grades`)).body.grades;
    assert.deepEqual(mine.map((g) => g.student.id), ['stu-2']);
    assert.equal('email' in mine[0].student, false);
  });

  test('tasks are frozen after submission', async () => {
    assert.equal((await call('stu1', 'PATCH', `/tasks/${state.task2}`, { done: true })).body.code, 'WORKSPACE_SUBMITTED');
    assert.equal((await call('lect', 'GET', `/workspaces/${state.group.id}/tasks`)).body.tasks.length, 2);
  });
});

describe('overrides', () => {
  test('only a lecturer of the course can override, with a reason', async () => {
    const id = state.grades['stu-2'].id;
    assert.equal((await call('stu2', 'POST', `/grades/${id}/overrides`, { grade: 10, reason: 'Please' })).status, 403);
    assert.equal((await call('lect2', 'POST', `/grades/${id}/overrides`, { grade: 6, reason: 'Not my course' })).status, 404);
    assert.equal((await call('lect', 'POST', `/grades/${id}/overrides`, { grade: 6, reason: 'ok' })).body.code, 'INVALID_BODY');
    assert.equal((await call('lect', 'POST', `/grades/${id}/overrides`, { grade: 6.555, reason: 'Too precise' })).body.code, 'INVALID_BODY');
  });

  test('each override is a new row recording who, when, why and the grade before', async () => {
    const id = state.grades['stu-2'].id;
    const first = await call('lect', 'POST', `/grades/${id}/overrides`, { grade: 5, reason: 'Did the field interviews offline' });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.previousGrade, first.body.newGrade, first.body.lecturer.id], [2.63, 5, 'lect-1']);
    const second = await call('lect', 'POST', `/grades/${id}/overrides`, { grade: 6, reason: 'Viva showed good understanding' });
    assert.equal(second.body.previousGrade, 5);

    const history = (await call('stu2', 'GET', `/grades/${id}/overrides`)).body.overrides;
    assert.deepEqual(history.map((o) => o.newGrade), [6, 5]);
    const { rows } = await sql(`SELECT action, details FROM audit_log WHERE action = 'grade.overridden' ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.details), [{ student: 'stu-2', from: 2.63, to: 5 }, { student: 'stu-2', from: 5, to: 6 }]);
  });

  test('the latest override is final; the suggested grade is unchanged', async () => {
    const g = (await call('lect', 'GET', `/workspaces/${state.group.id}/grades`)).body.grades.find((x) => x.student.id === 'stu-2');
    assert.deepEqual([g.suggested, g.final, g.overridden], [2.63, 6, true]);
  });

  test('re-running the analysis recomputes in place and keeps the override', async () => {
    const { rows } = await sql(`SELECT id FROM submissions WHERE workspace_id = $1`, [state.group.id]);
    assert.equal((await call('lect', 'POST', `/submissions/${rows[0].id}/analysis`, {})).status, 201);
    const g = (await call('lect', 'GET', `/workspaces/${state.group.id}/grades`)).body.grades.find((x) => x.student.id === 'stu-2');
    assert.equal(g.id, state.grades['stu-2'].id, 'same grade row');
    assert.equal(g.final, 6);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM overrides`)).rows[0].n, 2);
  });
});

describe('CSV export', () => {
  test('lecturers download the grades for the VLE', async () => {
    await sql(`UPDATE users SET display_name = '=HYPERLINK("http://evil")' WHERE id = 'stu-1'`);
    const res = await call('lect', 'GET', `/courses/${state.course.id}/grades.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv/);
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="CTE412-grades.csv"');
    const lines = res.body.trimEnd().split('\r\n');
    assert.equal(lines[0], 'course_code,assignment,group,student_name,student_email,time,edits,writing,tasks,deductions,suggested,final,overridden_by,override_reason');
    assert.equal(lines.length, 3);
    assert.ok(lines.some((l) => l.startsWith(`CTE412,Report,G1,"'=HYPERLINK(""http://evil"")",stu1@rub.edu.bt,10,10,8,10,0,9.5,9.5,,`)), 'formula neutralised');
    assert.ok(lines.includes('CTE412,Report,G1,stu2,stu2@rub.edu.bt,2.5,4,8,0,1,2.63,6,lecturer,Viva showed good understanding'));
  });

  test('students and other lecturers cannot download it', async () => {
    assert.equal((await call('stu1', 'GET', `/courses/${state.course.id}/grades.csv`)).status, 403);
    assert.equal((await call('lect2', 'GET', `/courses/${state.course.id}/grades.csv`)).status, 404);
  });
});
