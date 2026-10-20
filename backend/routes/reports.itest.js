// GET /workspaces/:id/report.xml end to end on a real PostgreSQL (npm run test:db): a group is
// created, submitted, graded and overridden through the API, then its report is checked against
// report.xsd and turned into HTML with report.xsl. Firebase Auth, Firestore and the analysis
// provider are stubbed. Rows are test fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import client from 'prom-client';
import { createApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { createTestDatabase } from '../db/testDatabase.js';
import { createMetrics } from '../src/metrics/index.js';
import { fakeAuth } from '../src/auth/testFakes.js';
import { buildAuthorMetrics } from '../services/submissions/workspaceStore.js';
import { toHtml, validate } from '../reports/testTools.js';

const people = {
  lect: { uid: 'lect-1', email: 'pema@rub.edu.bt', role: 'lecturer' },
  lect2: { uid: 'lect-2', email: 'other@rub.edu.bt', role: 'lecturer' },
  stu1: { uid: 'stu-1', email: 'karma@rub.edu.bt', role: 'student' },
  stu2: { uid: 'stu-2', email: 'dechen@rub.edu.bt', role: 'student' },
  sadm: { uid: 'sadm-1', email: 'admin@rub.edu.bt', role: 'superAdmin' },
};
const tokens = Object.fromEntries(Object.entries(people).map(([k, p]) => [`tok-${k}`, { uid: p.uid, email: p.email, role: p.role, collegeId: null }]));

const analysis = {
  async run(q, { submissionId }) {
    const flags = JSON.stringify([{ sentence: 'Hydropower is the backbone of the economy.', reason: 'Generic phrasing', authorId: 'stu-2' }]);
    const { rows } = await q.query(
      `INSERT INTO analysis_results (submission_id, provider, status, ai_likelihood, flagged_sentences, writing_quality, writing_feedback, difficulty, result)
       VALUES ($1, 'openai', 'completed', 35, $2, 7.5, '{"strengths":[],"weaknesses":[],"summary":""}', 2, '{}') RETURNING *`,
      [submissionId, flags]
    );
    return rows[0];
  },
};
const store = {
  readSubmission: async (_w, _f, members) => ({
    text: 'Hydropower is the backbone of the economy. More text follows here.',
    authorMetrics: buildAuthorMetrics(members, [{ uid: 'stu-1', timeSpent: 60, edits: 75 }, { uid: 'stu-2', timeSpent: 15, edits: 25 }], [
      { userId: 'stu-2', changeType: 'paste-large' },
      { userId: 'stu-2', changeType: 'paste-large' },
    ]),
  }),
  readSubmittedText: async () => '',
  markSubmitted: async () => {},
  recordEvents: async () => {},
};
const mirror = Object.fromEntries(['create', 'update', 'addMember', 'removeMember', 'remove'].map((n) => [n, async () => {}]));

let testDb;
let server;
let baseUrl;
const state = {};

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer tok-${who}`;
  const res = await fetch(`${baseUrl}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, json: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null, headers: res.headers };
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

  const course = (await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'Mini project & <XML>' })).json;
  for (const who of ['stu1', 'stu2']) await call(who, 'POST', '/courses/join', { joinCode: course.joinCode });
  const assignment = (
    await call('lect', 'POST', `/courses/${course.id}/assignments`, { title: 'Group report', brief: 'Write.', deadline: new Date(Date.now() + 7 * 864e5).toISOString() })
  ).json;
  state.group = (await call('lect', 'POST', `/assignments/${assignment.id}/groups`, { name: 'Team "Druk"', memberIds: ['stu-1', 'stu-2'] })).json;
  state.open = (await call('lect', 'POST', `/assignments/${assignment.id}/groups`, { name: 'Not yet' })).json;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await testDb?.drop();
});

describe('report.xml', () => {
  test('nothing before submission: 409 NOT_SUBMITTED', async () => {
    assert.equal((await call('lect', 'GET', `/workspaces/${state.open.id}/report.xml`)).json.code, 'NOT_SUBMITTED');
  });

  test('after submission, grading and an override, the report is valid against report.xsd', async () => {
    assert.equal((await call('stu1', 'POST', `/workspaces/${state.group.id}/submission`, { fileId: 'f1' })).status, 201);
    const grades = (await call('lect', 'GET', `/workspaces/${state.group.id}/grades`)).json.grades;
    const stu2 = grades.find((g) => g.student.id === 'stu-2');
    assert.equal((await call('lect', 'POST', `/grades/${stu2.id}/overrides`, { grade: 4, reason: 'Interviews done offline' })).status, 201);

    const res = await call('lect', 'GET', `/workspaces/${state.group.id}/report.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/xml/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await validate(res.text), { valid: true, errors: [] });
    assert.match(res.text, /<title>Mini project &amp; &lt;XML&gt;<\/title>/);
    assert.match(res.text, /<name>Team &quot;Druk&quot;<\/name>/);
    state.xml = res.text;
  });

  test('the XSL turns it into the printable page', async () => {
    const html = await toHtml(state.xml);
    assert.match(html, /<tr class="paste">\s*<td>dechen<\/td>/, 'the student with large pastes is yellow');
    assert.match(html, /<div class="ai">Hydropower is the backbone of the economy\./);
    assert.match(html, /written by dechen/);
    assert.match(html, /<strong>4<\/strong> \(lecturer\)/);
    assert.match(html, /AI likelihood is a signal, not proof/);
  });

  test('only staff of the course can read it', async () => {
    assert.equal((await call('stu1', 'GET', `/workspaces/${state.group.id}/report.xml`)).status, 403);
    assert.equal((await call('lect2', 'GET', `/workspaces/${state.group.id}/report.xml`)).status, 404);
    assert.equal((await call(null, 'GET', `/workspaces/${state.group.id}/report.xml`)).status, 401);
    assert.equal((await call('sadm', 'GET', `/workspaces/${state.group.id}/report.xml`)).status, 200);
  });
});

describe('report.xsl', () => {
  test('is served without a token, as the stylesheet file itself', async () => {
    const res = await call(null, 'GET', '/reports/report.xsl');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/xsl/);
    assert.equal(res.text, readFileSync(new URL('../reports/report.xsl', import.meta.url), 'utf8'));
  });
});
