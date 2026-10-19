// Tracking events, submission and analysis end to end on a real PostgreSQL (npm run test:db).
// Stubbed: Firebase Auth (testFakes), Firestore (an in-memory workspace store), OpenAI (a
// fetch stub), Hugging Face and Virtual Writing Tutor. The analysis service, Ajv checks,
// the database writes and the append-only table are real. Rows are test fixtures.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import client from 'prom-client';
import { createApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { createTestDatabase } from '../db/testDatabase.js';
import { createMetrics } from '../src/metrics/index.js';
import { fakeAuth } from '../src/auth/testFakes.js';
import { createAnalysisService } from '../services/analysis/analysisService.js';
import { createLegacyProvider } from '../services/analysis/legacyProvider.js';
import { createOpenAIProvider } from '../services/analysis/openaiProvider.js';
import { buildAuthorMetrics } from '../services/submissions/workspaceStore.js';

const COLLEGE = '0b5c1f9e-2a71-4c8e-9d3b-6e0f4a2c7b11';
const TEXT =
  'Bhutan measures progress with Gross National Happiness rather than income alone. The index covers nine domains, ' +
  'including psychological wellbeing, time use and ecological diversity. Critics argue the survey is long and costly to run.';

const people = {
  lect: { uid: 'lect-1', email: 'lecturer@rub.edu.bt', role: 'lecturer', collegeId: COLLEGE },
  stu1: { uid: 'stu-1', email: 'stu1@rub.edu.bt', role: 'student' },
  stu2: { uid: 'stu-2', email: 'stu2@rub.edu.bt', role: 'student' },
  stu3: { uid: 'stu-3', email: 'stu3@rub.edu.bt', role: 'student' },
  stu4: { uid: 'stu-4', email: 'stu4@rub.edu.bt', role: 'student' },
};
const tokens = Object.fromEntries(
  Object.entries(people).map(([k, p]) => [`tok-${k}`, { uid: p.uid, email: p.email, role: p.role, collegeId: p.collegeId ?? null }])
);

// ── Stubs ──
const flags = { ai_provider: 'openai', ai_detection_enabled: true, licensing_enabled: false };
const openaiReply = {
  mode: 'ok',
  result: {
    ai_likelihood: 22,
    flagged_sentences: [{ sentence: 'The index covers nine domains, including psychological wellbeing, time use and ecological diversity.', reason: 'Listy, generic phrasing' }],
    writing_quality: 7,
    writing_feedback: { strengths: ['Clear topic sentence'], weaknesses: ['Needs a source for the critics'], summary: 'Focused and readable.' },
    difficulty: 2,
    grade_explanation: 'Clear and well organised, but the claims need evidence.',
  },
};
async function openaiFetch() {
  if (openaiReply.mode === 'down') return { ok: false, status: 503, json: async () => ({ error: { type: 'server_error' } }) };
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(openaiReply.result) } }], usage: { prompt_tokens: 800, completion_tokens: 150 } }),
  };
}
const legacyStub = { throws: false };
const legacy = createLegacyProvider({
  detectAI: async () => {
    if (legacyStub.throws) throw new Error('unexpected');
    return { available: true, aiScore: 40, flaggedSegments: [] };
  },
  checkGrammar: async () => ({ available: true, writingScore: 70, grammarErrors: 4, feedback: ['Check verb tense.'] }),
});
const analysis = createAnalysisService({
  openai: createOpenAIProvider(
    { apiKey: 'sk-test-not-real', model: 'test-model', baseUrl: 'https://openai.test/v1', timeoutMs: 5000, maxInputChars: 60000, priceInputPer1M: 1, priceOutputPer1M: 4 },
    { fetch: openaiFetch }
  ),
  legacy,
  getFlag: async (name) => flags[name],
});

/** In-memory stand-in for the Firestore workspace store. */
const firestore = {
  files: new Map(), // `${workspaceId}/${fileId}` -> text
  analytics: [
    { uid: 'stu-1', timeSpent: 30, edits: 120 },
    { uid: 'stu-2', timeSpent: 10, edits: 15 },
  ],
  pastes: [{ userId: 'stu-2', changeType: 'paste-large' }],
  marked: [],
  events: [],
};
const store = {
  async readSubmission(workspaceId, fileId, memberIds) {
    const text = firestore.files.get(`${workspaceId}/${fileId}`);
    if (text === undefined) throw Object.assign(new Error('missing'), { status: 404 });
    return { text, fileName: 'Essay', authorMetrics: buildAuthorMetrics(memberIds, firestore.analytics, firestore.pastes) };
  },
  async readSubmittedText(ref) {
    const [, workspaceId, , fileId] = ref.split('/');
    return firestore.files.get(`${workspaceId}/${fileId}`);
  },
  async markSubmitted(workspaceId, details) {
    firestore.marked.push({ workspaceId, ...details });
  },
  async recordEvents(workspaceId, uid, events) {
    firestore.events.push({ workspaceId, uid, events });
  },
};
const mirror = Object.fromEntries(['create', 'update', 'addMember', 'removeMember', 'remove'].map((n) => [n, async () => {}]));

let testDb;
let server;
let baseUrl;
const state = {};

before(async () => {
  testDb = await createTestDatabase();
  const db = { pool: testDb.pool, ping: async () => true, close: async () => {} };
  const app = createApp({
    config: loadConfig({}),
    db,
    metrics: createMetrics({ registry: new client.Registry() }),
    courseDeps: { getClients: () => ({ auth: fakeAuth({ tokens }) }), mirror },
    submissionDeps: { analysis, store },
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await sql(`INSERT INTO colleges (id, name, slug) VALUES ($1, 'College of Science and Technology', 'cst')`, [COLLEGE]);

  // A course in the college, an assignment and two groups, through the API.
  state.course = (await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'Mini project' })).body;
  for (const who of ['stu1', 'stu2', 'stu3', 'stu4']) await call(who, 'POST', '/courses/join', { joinCode: state.course.joinCode });
  const deadline = new Date(Date.now() + 7 * 864e5).toISOString();
  state.assignment = (await call('lect', 'POST', `/courses/${state.course.id}/assignments`, { title: 'Report', brief: 'Write.', deadline })).body;
  state.g1 = (await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'G1', memberIds: ['stu-1', 'stu-2'] })).body;
  state.g2 = (await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'G2', memberIds: ['stu-3'] })).body;
  state.g3 = (await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'G3', memberIds: ['stu-4'] })).body;
  firestore.files.set(`${state.g1.id}/file-1`, TEXT);
  firestore.files.set(`${state.g2.id}/file-2`, TEXT);
  firestore.files.set(`${state.g3.id}/file-3`, TEXT);
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await testDb?.drop();
});

function sql(text, params) {
  return testDb.pool.query(text, params);
}

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer tok-${who}`;
  const res = await fetch(`${baseUrl}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const at = Date.now();

describe('tracking events', () => {
  test('valid events are stored; events with text are dropped and counted', async () => {
    const res = await call('stu1', 'POST', `/workspaces/${state.g1.id}/events`, {
      events: [
        { kind: 'metric', at, payload: { timeSpent: 2, edits: 14 } },
        { kind: 'paste', at, payload: { fileId: 'file-1', length: 300, changeType: 'paste-large' } },
        { kind: 'paste', at, payload: { fileId: 'file-1', length: 3, changeType: 'paste-small', contentSnippet: 'abc' } },
        { kind: 'version', at, payload: { fileId: 'file-1', wordCount: 40, content: '<p>...</p>' } },
        'not an event',
      ],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { accepted: 2, rejected: 3 });
    const stored = firestore.events.at(-1);
    assert.equal(stored.uid, 'stu-1');
    assert.equal(JSON.stringify(stored.events).includes('abc'), false, 'no pasted text reaches storage');
  });

  test('only members of the workspace may send events', async () => {
    assert.equal((await call('stu3', 'POST', `/workspaces/${state.g1.id}/events`, { events: [{ kind: 'metric', at, payload: { edits: 1 } }] })).status, 404);
    assert.equal((await call('lect', 'POST', `/workspaces/${state.g1.id}/events`, { events: [{ kind: 'metric', at, payload: { edits: 1 } }] })).status, 403);
    assert.equal((await call('stu1', 'POST', `/workspaces/${state.g1.id}/events`, { events: [] })).body.code, 'INVALID_BODY');
  });
});

describe('submitting', () => {
  test('a member submits: OpenAI analysis is written once, usage is recorded, the workspace is handed to the lecturer', async () => {
    const res = await call('stu1', 'POST', `/workspaces/${state.g1.id}/submission`, { fileId: 'file-1', tabs: [{ id: 't1', title: 'Intro', depth: 0, wordCount: 34 }] });
    assert.equal(res.status, 201);
    const { submission, analysis: a } = res.body;
    assert.equal(submission.trigger, 'manual');
    assert.equal(submission.wordCount, 34);
    assert.deepEqual(submission.tabs, [{ id: 't1', title: 'Intro', depth: 0, wordCount: 34 }]);
    assert.deepEqual(Object.keys(submission.authorMetrics), ['stu-1'], 'a student sees only their own numbers');
    assert.deepEqual(submission.authorMetrics['stu-1'], { timeSpentSec: 1800, edits: 120, pasteEvents: 0, largePastes: 0, tabEdits: {} });

    assert.deepEqual([a.provider, a.model, a.status, a.fallbackReason, a.aiLikelihood, a.writingQuality], ['openai', 'test-model', 'completed', null, 22, 7]);
    assert.equal(a.flaggedSentences.length, 1);
    assert.match(a.notice, /signal, not proof/);
    state.s1 = submission.id;

    const { rows: usage } = await sql(`SELECT provider, model, outcome, prompt_tokens, completion_tokens, cost_usd, college_id, course_id FROM usage`);
    assert.deepEqual(usage, [
      { provider: 'openai', model: 'test-model', outcome: 'ok', prompt_tokens: 800, completion_tokens: 150, cost_usd: '0.001400', college_id: COLLEGE, course_id: state.course.id },
    ]);
    assert.deepEqual(firestore.marked.at(-1), {
      workspaceId: state.g1.id,
      fileId: 'file-1',
      lecturerIds: ['lect-1'],
      submittedBy: 'stu-1',
      nowIso: submission.submittedAt,
    });
    assert.equal((await sql(`SELECT status FROM workspaces WHERE id = $1`, [state.g1.id])).rows[0].status, 'submitted');
  });

  test('submitting again, or sending events afterwards, is 409', async () => {
    assert.equal((await call('stu2', 'POST', `/workspaces/${state.g1.id}/submission`, { fileId: 'file-1' })).body.code, 'ALREADY_SUBMITTED');
    assert.equal((await call('stu2', 'POST', `/workspaces/${state.g1.id}/events`, { events: [{ kind: 'metric', at, payload: { edits: 1 } }] })).body.code, 'WORKSPACE_SUBMITTED');
  });

  test('a locked workspace (deadline job) is 409 ALREADY_LOCKED', async () => {
    await sql(`UPDATE workspaces SET status = 'locked' WHERE id = $1`, [state.g3.id]);
    assert.equal((await call('stu4', 'POST', `/workspaces/${state.g3.id}/submission`, { fileId: 'file-3' })).body.code, 'ALREADY_LOCKED');
    await sql(`UPDATE workspaces SET status = 'open' WHERE id = $1`, [state.g3.id]);
  });

  test('non-members and lecturers cannot submit', async () => {
    assert.equal((await call('stu3', 'POST', `/workspaces/${state.g1.id}/submission`, { fileId: 'file-1' })).status, 404);
    assert.equal((await call('lect', 'POST', `/workspaces/${state.g2.id}/submission`, { fileId: 'file-2' })).status, 403);
  });

  test('when OpenAI is down, the submission still succeeds with the legacy analysis', async () => {
    openaiReply.mode = 'down';
    const res = await call('stu3', 'POST', `/workspaces/${state.g2.id}/submission`, { fileId: 'file-2' });
    openaiReply.mode = 'ok';
    assert.equal(res.status, 201);
    assert.deepEqual([res.body.analysis.provider, res.body.analysis.fallbackReason, res.body.analysis.status], ['legacy', 'openai_error', 'completed']);
    assert.equal(res.body.analysis.writingQuality, 7);
    const { rows } = await sql(`SELECT provider, outcome FROM usage WHERE submission_id = $1 ORDER BY id`, [res.body.submission.id]);
    assert.deepEqual(rows.map((r) => [r.provider, r.outcome]), [['openai', 'error'], ['huggingface', 'ok'], ['vwt', 'ok']]);
    state.s2 = res.body.submission.id;
  });

  test('even if analysis itself crashes, the submission is kept', async () => {
    legacyStub.throws = true;
    flags.ai_provider = 'legacy';
    const res = await call('stu4', 'POST', `/workspaces/${state.g3.id}/submission`, { fileId: 'file-3' });
    legacyStub.throws = false;
    flags.ai_provider = 'openai';
    assert.equal(res.status, 201);
    assert.equal(res.body.analysis, null);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM submissions WHERE workspace_id = $1`, [state.g3.id])).rows[0].n, 1);
  });
});

describe('reading and re-running', () => {
  test("lecturers see every member's metrics; students only their own", async () => {
    const asLecturer = (await call('lect', 'GET', `/workspaces/${state.g1.id}/submission`)).body;
    assert.deepEqual(Object.keys(asLecturer.authorMetrics).sort(), ['stu-1', 'stu-2']);
    assert.equal(asLecturer.authorMetrics['stu-2'].largePastes, 1);
    const asStudent = (await call('stu2', 'GET', `/workspaces/${state.g1.id}/submission`)).body;
    assert.deepEqual(Object.keys(asStudent.authorMetrics), ['stu-2']);
  });

  test('budget reached: a re-run uses legacy and OpenAI is not called', async () => {
    flags.licensing_enabled = true;
    await sql(`INSERT INTO licences (college_id, plan, seats, monthly_ai_budget_usd, starts_on) VALUES ($1, 'standard', 100, 0.001, current_date - 1)`, [COLLEGE]);
    const before = (await sql(`SELECT count(*)::int AS n FROM usage WHERE provider = 'openai'`)).rows[0].n;
    const res = await call('lect', 'POST', `/submissions/${state.s1}/analysis`, {});
    flags.licensing_enabled = false;
    assert.equal(res.status, 201);
    assert.deepEqual([res.body.provider, res.body.fallbackReason], ['legacy', 'budget_reached']);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM usage WHERE provider = 'openai'`)).rows[0].n, before);
  });

  test('history keeps every run, newest first, and the first run is unchanged', async () => {
    const res = await call('stu1', 'GET', `/submissions/${state.s1}/analysis`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.history.map((h) => h.provider), ['legacy', 'openai']);
    assert.equal(res.body.current.id, res.body.history[0].id);
    assert.equal(res.body.history[1].aiLikelihood, 22);
    assert.equal((await call('stu3', 'GET', `/submissions/${state.s1}/analysis`)).status, 404);
  });

  test('re-runs are lecturer-only and limited to 3 runs an hour', async () => {
    assert.equal((await call('stu1', 'POST', `/submissions/${state.s1}/analysis`, {})).status, 403);
    assert.equal((await call('lect', 'POST', `/submissions/${state.s1}/analysis`, { provider: 'openai' })).body.provider, 'openai');
    const limited = await call('lect', 'POST', `/submissions/${state.s1}/analysis`, {});
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });

  test('before submission there is nothing to read', async () => {
    const other = (await call('lect', 'POST', `/assignments/${state.assignment.id}/groups`, { name: 'G4' })).body;
    assert.equal((await call('lect', 'GET', `/workspaces/${other.id}/submission`)).body.code, 'NOT_SUBMITTED');
  });
});
