// Random groups and peer evaluation on a real PostgreSQL (npm run test:db). Firebase Auth,
// Firestore (a recorder) and the analysis are stubbed. Rows are test fixtures.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import client from 'prom-client';
import { createApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { createTestDatabase } from '../db/testDatabase.js';
import { createMetrics } from '../src/metrics/index.js';
import { fakeAuth } from '../src/auth/testFakes.js';
import { buildAuthorMetrics } from '../services/submissions/workspaceStore.js';

const STUDENTS = Array.from({ length: 11 }, (_, i) => `stu-${String(i + 1).padStart(2, '0')}`);
const people = {
  lect: { uid: 'lect-1', email: 'pema@rub.edu.bt', role: 'lecturer' },
  lect2: { uid: 'lect-2', email: 'other@rub.edu.bt', role: 'lecturer' },
  ...Object.fromEntries(STUDENTS.map((uid) => [uid, { uid, email: `${uid}@rub.edu.bt`, role: 'student' }])),
};
const tokens = Object.fromEntries(Object.entries(people).map(([k, p]) => [`tok-${k}`, { uid: p.uid, email: p.email, role: p.role, collegeId: null }]));

const firestore = { created: [], notified: [] };
const mirror = {
  create: async (doc) => firestore.created.push(doc),
  update: async () => {},
  addMember: async () => {},
  removeMember: async () => {},
  remove: async () => {},
  notify: async (uid, n) => firestore.notified.push({ uid, ...n }),
};
const flags = { peer_eval_enabled: true };
const analysis = { run: async () => null };
const store = {
  readSubmission: async (_w, _f, members) => ({ text: 'Enough text for a submission here.', authorMetrics: buildAuthorMetrics(members, [], []) }),
  readSubmittedText: async () => '',
  markSubmitted: async () => {},
  recordEvents: async () => {},
};

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  testDb = await createTestDatabase();
  const app = createApp({
    config: loadConfig({}),
    db: { pool: testDb.pool, ping: async () => true, close: async () => {} },
    metrics: createMetrics({ registry: new client.Registry() }),
    courseDeps: { getClients: () => ({ auth: fakeAuth({ tokens }) }), mirror, getFlag: async (name) => flags[name] },
    submissionDeps: { analysis, store },
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  state.course = (await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'Mini project' })).body;
  for (const uid of STUDENTS) await call(uid, 'POST', '/courses/join', { joinCode: state.course.joinCode });
  const deadline = new Date(Date.now() + 7 * 864e5).toISOString();
  state.assignment = (await call('lect', 'POST', `/courses/${state.course.id}/assignments`, { title: 'Report', brief: 'Write.', deadline })).body;
  // One group made by hand first: its two students must be left alone.
  state.manual = (await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'Group 1', memberIds: ['stu-01', 'stu-02'] })).body;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await testDb?.drop();
});

describe('random groups', () => {
  test('only lecturers of the course; size is checked', async () => {
    assert.equal((await call('stu-03', 'POST', `/assignments/${state.assignment.id}/groups/auto`, { size: 3 })).status, 403);
    assert.equal((await call('lect2', 'POST', `/assignments/${state.assignment.id}/groups/auto`, { size: 3 })).status, 404);
    assert.equal((await call('lect', 'POST', `/assignments/${state.assignment.id}/groups/auto`, { size: 1 })).body.code, 'INVALID_BODY');
  });

  test('more than the ungrouped students is 409 NOT_ENOUGH_STUDENTS', async () => {
    const res = await call('lect', 'POST', `/assignments/${state.assignment.id}/groups/auto`, { size: 10 });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NOT_ENOUGH_STUDENTS');
    assert.equal(firestore.created.length, 1, 'nothing was created');
  });

  test('the 9 ungrouped students become groups of 4 and 5; nobody is placed twice', async () => {
    const res = await call('lect', 'POST', `/assignments/${state.assignment.id}/groups/auto`, { size: 4 });
    assert.equal(res.status, 201);
    const groups = res.body.groups;
    assert.deepEqual(groups.map((g) => g.members.length).sort(), [4, 5]);
    assert.deepEqual(groups.map((g) => g.name).sort(), ['Group 2', 'Group 3'], 'names continue after Group 1');
    assert.ok(groups.every((g) => g.createdVia === 'auto'));

    const placed = groups.flatMap((g) => g.members.map((m) => m.id)).sort();
    assert.deepEqual(placed, STUDENTS.slice(2), 'exactly the ungrouped students, once each');

    // Firestore got each group with the course lecturer, and every student a notification.
    const docs = firestore.created.slice(1);
    assert.deepEqual(docs.map((d) => d.lecturerIds), [['lect-1'], ['lect-1']]);
    assert.deepEqual(firestore.notified.map((n) => n.uid).sort(), placed);
    assert.ok(firestore.notified.every((n) => n.type === 'group-assigned' && /^You are in Group [23] for "Report"\.$/.test(n.message)));

    const { rows } = await sql(`SELECT details FROM audit_log WHERE action = 'groups.auto_created'`);
    assert.equal(rows[0].details.size, 4);
    state.auto = groups;
  });

  test('running it again with nobody left is 409', async () => {
    assert.equal((await call('lect', 'POST', `/assignments/${state.assignment.id}/groups/auto`, { size: 2 })).body.code, 'NOT_ENOUGH_STUDENTS');
  });
});

describe('peer evaluation', () => {
  test('before submission: 409 NOT_SUBMITTED', async () => {
    const g = state.auto[0];
    assert.equal((await call(g.members[0].id, 'GET', `/workspaces/${g.id}/peer-evaluations`)).body.code, 'NOT_SUBMITTED');
  });

  test('after submission each student rates every teammate, and not themselves', async () => {
    const g = state.auto.find((x) => x.members.length === 4);
    const [a, b, c, d] = g.members.map((m) => m.id);
    assert.equal((await call(a, 'POST', `/workspaces/${g.id}/submission`, { fileId: 'f1' })).status, 201);

    const url = `/workspaces/${g.id}/peer-evaluations`;
    const missing = await call(a, 'PUT', url, { ratings: [{ rateeId: b, rating: 4 }] });
    assert.equal(missing.body.code, 'INVALID_BODY');
    const self = await call(a, 'PUT', url, { ratings: [a, b, c].map((id) => ({ rateeId: id, rating: 3 })) });
    assert.equal(self.body.code, 'INVALID_BODY');
    const outsider = await call(a, 'PUT', url, { ratings: [b, c, 'stu-01'].map((id) => ({ rateeId: id, rating: 3 })) });
    assert.equal(outsider.body.code, 'INVALID_BODY');
    assert.equal((await call(a, 'PUT', url, { ratings: [{ rateeId: b, rating: 6 }, { rateeId: c, rating: 3 }, { rateeId: d, rating: 3 }] })).body.code, 'INVALID_BODY');

    const ok = await call(a, 'PUT', url, {
      ratings: [
        { rateeId: b, rating: 5, comment: 'Did most of the research.' },
        { rateeId: c, rating: 2, comment: '  ' },
        { rateeId: d, rating: 3 },
      ],
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.ratings.map((r) => [r.rateeId, r.rating, r.comment]), [[b, 5, 'Did most of the research.'], [c, 2, null], [d, 3, null]]);

    // Sending again replaces the earlier ratings.
    await call(a, 'PUT', url, { ratings: [{ rateeId: b, rating: 4 }, { rateeId: c, rating: 2 }, { rateeId: d, rating: 3 }] });
    await call(c, 'PUT', url, { ratings: [{ rateeId: a, rating: 4 }, { rateeId: b, rating: 5, comment: 'Great editor.' }, { rateeId: d, rating: 1 }] });
    assert.equal((await sql(`SELECT count(*)::int AS n FROM peer_evaluations`)).rows[0].n, 6);

    const mine = (await call(c, 'GET', url)).body;
    assert.deepEqual(mine.ratings.map((r) => r.rateeId), [a, b, d].sort());
    state.peer = { g, a, b, c, d };
  });

  test('lecturers see averages, counts and comments, but not who wrote them', async () => {
    const { g, a, b, d } = state.peer;
    const res = await call('lect', 'GET', `/workspaces/${g.id}/peer-evaluations`);
    assert.equal(res.status, 200);
    const byId = Object.fromEntries(res.body.members.map((m) => [m.student.id, m]));
    assert.deepEqual([byId[b].average, byId[b].count, byId[b].expected], [4.5, 2, 3]);
    assert.deepEqual(byId[b].comments, ['Great editor.']);
    assert.deepEqual([byId[a].average, byId[a].count], [4, 1]);
    assert.deepEqual([byId[d].average, byId[d].count], [2, 2]);
    assert.equal(JSON.stringify(res.body).includes('rater'), false);
  });

  test('it is not part of the grade', async () => {
    const { rows } = await sql(`SELECT count(*)::int AS n FROM grades WHERE explanation ILIKE '%peer%'`);
    assert.equal(rows[0].n, 0);
  });

  test('outsiders cannot read it; lecturers cannot rate', async () => {
    const { g } = state.peer;
    assert.equal((await call('stu-01', 'GET', `/workspaces/${g.id}/peer-evaluations`)).status, 404);
    assert.equal((await call('lect', 'PUT', `/workspaces/${g.id}/peer-evaluations`, { ratings: [{ rateeId: 'x', rating: 3 }] })).status, 403);
  });

  test('with peer_eval_enabled off, 404 FEATURE_DISABLED', async () => {
    flags.peer_eval_enabled = false;
    const res = await call('lect', 'GET', `/workspaces/${state.peer.g.id}/peer-evaluations`);
    flags.peer_eval_enabled = true;
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'FEATURE_DISABLED');
  });
});
