// The deadline store (postgres.js) against a real PostgreSQL (npm run test:db). Needs
// TEST_DATABASE_URL (or DATABASE_URL) pointing at a server where the user may CREATE DATABASE.
// Each run creates its own migrated throwaway database and drops it afterwards. Rows inserted
// here are test fixtures, not app data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { createDeadlineStore } from './postgres.js';

const adminUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');
const dbName = `peerlytics_itest_${randomBytes(4).toString('hex')}`;

const DEADLINE = Date.UTC(2026, 9, 22, 18, 0);
const METRICS = { stu1: { timeSpentSec: 600, edits: 12, pasteEvents: 1, largePastes: 0, tabEdits: {} } };
let pool;
let store;
let assignmentId;

async function adminQuery(sql) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

/** A workspace in the shared assignment, with the given members. */
async function addWorkspace(id, { status = 'open', members = ['stu1', 'stu2'] } = {}) {
  await pool.query(
    `INSERT INTO workspaces (id, assignment_id, name, created_via, status, created_by) VALUES ($1, $2, $1, 'manual', $3, 'lec1')`,
    [id, assignmentId, status]
  );
  for (const uid of members) {
    await pool.query('INSERT INTO workspace_members (workspace_id, user_id, assignment_id) VALUES ($1, $2, $3)', [id, uid, assignmentId]);
  }
}

async function extend(workspaceId, deadlineMs, createdAtMs) {
  await pool.query(
    `INSERT INTO group_extensions (workspace_id, deadline, reason, granted_by, created_at) VALUES ($1, $2, 'Power cut on campus', 'lec1', $3)`,
    [workspaceId, new Date(deadlineMs), new Date(createdAtMs)]
  );
}

const lock = (workspaceId, extra = {}) =>
  store.lockAtDeadline({
    workspaceId,
    nowMs: DEADLINE + 1000,
    deadlineMs: DEADLINE,
    extended: false,
    submission: { wordCount: 250, authorMetrics: METRICS, documentRef: `groups/${workspaceId}/files/f1` },
    ...extra,
  });

before(async () => {
  assert.ok(adminUrl, 'Set TEST_DATABASE_URL (or DATABASE_URL) to run the database tests.');
  await adminQuery(`CREATE DATABASE ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  await runner({ databaseUrl: url.toString(), dir: migrationsDir, direction: 'up', migrationsTable: 'pgmigrations', log: () => {} });
  pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
  store = createDeadlineStore(pool);

  await pool.query(`
    INSERT INTO users (id, display_name, role) VALUES
      ('lec1', 'Lecturer One', 'lecturer'), ('stu1', 'Student One', 'student'), ('stu2', 'Student Two', 'student')`);
  const course = await pool.query(
    `INSERT INTO courses (code, title, join_code, owner_id) VALUES ('CTE412', 'Mini project', 'ABCDEFGH', 'lec1') RETURNING id`
  );
  const assignment = await pool.query(
    `INSERT INTO assignments (course_id, title, brief, deadline, created_by) VALUES ($1, 'Group report', 'Write it together.', $2, 'lec1') RETURNING id`,
    [course.rows[0].id, new Date(DEADLINE)]
  );
  assignmentId = assignment.rows[0].id;
});

after(async () => {
  await pool?.end();
  if (adminUrl) await adminQuery(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('deadline store on PostgreSQL', () => {
  beforeEach(async () => {
    // Each test adds its own workspaces; start from none. audit_log is append-only, so it stays.
    await pool.query('DELETE FROM submissions');
    await pool.query('DELETE FROM workspaces');
  });

  test('dueWorkspaces uses the assignment deadline and lists members', async () => {
    await addWorkspace('w1');
    assert.deepEqual(await store.dueWorkspaces(DEADLINE - 1), []);
    assert.deepEqual(await store.dueWorkspaces(DEADLINE), [{ id: 'w1', deadlineMs: DEADLINE, extended: false, memberIds: ['stu1', 'stu2'] }]);
  });

  test("the latest extension wins, even when it is earlier than an older one", async () => {
    await addWorkspace('w1');
    await extend('w1', DEADLINE + 7200_000, DEADLINE - 7200_000);
    await extend('w1', DEADLINE + 3600_000, DEADLINE - 3600_000);
    assert.deepEqual(await store.dueWorkspaces(DEADLINE + 60_000), []);
    const [due] = await store.dueWorkspaces(DEADLINE + 3600_000);
    assert.equal(due.deadlineMs, DEADLINE + 3600_000);
    assert.equal(due.extended, true);
  });

  test('only open workspaces are due, earliest deadline first', async () => {
    // No members: a student is in at most one group per assignment.
    await addWorkspace('w-late', { members: [] });
    await extend('w-late', DEADLINE + 60_000, DEADLINE - 1000);
    await addWorkspace('w-first', { members: [] });
    await addWorkspace('w-done', { status: 'submitted', members: [] });
    await addWorkspace('w-locked', { status: 'locked', members: [] });
    const due = await store.dueWorkspaces(DEADLINE + 3600_000);
    assert.deepEqual(due.map((w) => w.id), ['w-first', 'w-late']);
  });

  test('knownWorkspaceIds tells course workspaces from Firestore-only groups', async () => {
    await addWorkspace('w1');
    assert.deepEqual([...(await store.knownWorkspaceIds(['w1', 'legacy-group']))], ['w1']);
    assert.deepEqual([...(await store.knownWorkspaceIds([]))], []);
  });

  test('lockAtDeadline inserts the submission, locks the workspace and writes the audit log', async () => {
    await addWorkspace('w1');
    const result = await lock('w1');
    assert.equal(result.status, 'locked');

    const { rows: subs } = await pool.query('SELECT * FROM submissions WHERE workspace_id = $1', ['w1']);
    assert.equal(subs[0].id, result.submissionId);
    assert.equal(subs[0].trigger, 'deadline');
    assert.equal(subs[0].submitted_by, null);
    assert.equal(subs[0].word_count, 250);
    assert.equal(subs[0].document_ref, 'groups/w1/files/f1');
    assert.deepEqual(subs[0].author_metrics, METRICS);
    assert.equal(subs[0].submitted_at.getTime(), DEADLINE + 1000);

    const { rows: ws } = await pool.query('SELECT status FROM workspaces WHERE id = $1', ['w1']);
    assert.equal(ws[0].status, 'locked');

    const { rows: audit } = await pool.query(
      `SELECT actor_id, action, target_type, details FROM audit_log WHERE target_id = 'w1' ORDER BY id DESC LIMIT 1`
    );
    assert.deepEqual(audit[0], {
      actor_id: null,
      action: 'workspace.locked',
      target_type: 'workspace',
      details: { trigger: 'deadline', deadline: new Date(DEADLINE).toISOString(), extended: false, submissionId: result.submissionId, documentRef: 'groups/w1/files/f1' },
    });
    assert.deepEqual(await store.dueWorkspaces(DEADLINE + 3600_000), []);
  });

  test('a workspace with nothing submitted is locked without a submission row', async () => {
    await addWorkspace('w1');
    assert.deepEqual(await lock('w1', { submission: null }), { status: 'locked', submissionId: null });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM submissions');
    assert.equal(rows[0].n, 0);
  });

  test("a member's own submission is never replaced", async () => {
    await addWorkspace('w1', { status: 'submitted' });
    await pool.query(
      `INSERT INTO submissions (workspace_id, submitted_by, trigger, word_count, author_metrics, document_ref)
       VALUES ('w1', 'stu1', 'manual', 90, '{}', 'groups/w1/files/f0')`
    );
    assert.deepEqual(await lock('w1'), { status: 'skipped', reason: 'submitted' });
    const { rows } = await pool.query('SELECT trigger, word_count FROM submissions');
    assert.deepEqual(rows, [{ trigger: 'manual', word_count: 90 }]);
    assert.deepEqual(await lock('missing'), { status: 'skipped', reason: 'missing' });
  });

  test('two backends locking at the same moment record one submission', async () => {
    await addWorkspace('w1');
    const results = await Promise.all([lock('w1'), lock('w1'), lock('w1')]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['locked', 'skipped', 'skipped']);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE target_id = 'w1' AND details->>'submissionId' = $1`, [
      results.find((r) => r.status === 'locked').submissionId,
    ]);
    assert.equal(rows[0].n, 1);
    const subs = await pool.query('SELECT count(*)::int AS n FROM submissions');
    assert.equal(subs.rows[0].n, 1);
  });

  test('a failure inside the transaction leaves the workspace open for the next tick', async () => {
    await addWorkspace('w1');
    // word_count must be >= 0, so the insert fails after the row was locked.
    await assert.rejects(lock('w1', { submission: { wordCount: -1, authorMetrics: {}, documentRef: 'groups/w1/files/f1' } }));
    const { rows } = await pool.query('SELECT status FROM workspaces WHERE id = $1', ['w1']);
    assert.equal(rows[0].status, 'open');
    assert.equal((await lock('w1')).status, 'locked');
  });
});
