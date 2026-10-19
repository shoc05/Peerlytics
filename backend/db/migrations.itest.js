// Integration tests against a real PostgreSQL (npm run test:db). They need TEST_DATABASE_URL
// (or DATABASE_URL), from the environment or the repo-root .env, pointing at a server where
// the user may CREATE DATABASE, for example the docker compose postgres:
//   TEST_DATABASE_URL=postgres://peerlytics:<password>@127.0.0.1:5432/postgres npm run test:db
// Each run creates its own throwaway database and drops it afterwards, so a development
// database is never touched. Rows inserted here are test fixtures, not app data.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { createEmptyDatabase, MIGRATIONS_DIR as dir } from './testDatabase.js';

const migrationsTable = 'pgmigrations';

// Every table in docs/db-schema.md.
const TABLES = [
  'analysis_results', 'announcements', 'assignments', 'audit_log', 'college_domains', 'colleges',
  'courses', 'enrolments', 'grades', 'group_extensions', 'licences', 'overrides', 'peer_evaluations',
  'submissions', 'tasks', 'usage', 'users', 'workspace_members', 'workspaces',
];

let dbUrl;
let dropDb;
let client;

function migrate(direction, count = Infinity) {
  return runner({ databaseUrl: dbUrl, dir, direction, count, migrationsTable, log: () => {}, checkOrder: true });
}

async function tables() {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> $1 ORDER BY table_name`,
    [migrationsTable]
  );
  return rows.map((r) => r.table_name);
}

/** Runs `sql` and returns the PostgreSQL error code it fails with (or null if it succeeds). */
async function errorCode(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return err.code;
  }
}

const RESTRICT_VIOLATION = '23001';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FK_VIOLATION = '23503';

before(async () => {
  ({ url: dbUrl, drop: dropDb } = await createEmptyDatabase());
  client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
});

after(async () => {
  await client?.end();
  await dropDb?.();
});

describe('migrations', () => {
  test('up creates every table in docs/db-schema.md', async () => {
    await migrate('up');
    assert.deepEqual(await tables(), TABLES);
  });

  test('the analysis_results_immutable trigger exists', async () => {
    const { rows } = await client.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'analysis_results'::regclass AND NOT tgisinternal ORDER BY tgname`
    );
    assert.deepEqual(rows.map((r) => r.tgname), ['analysis_results_immutable', 'analysis_results_no_truncate']);
  });

  test('down removes everything, and up works again afterwards', async () => {
    await migrate('down');
    assert.deepEqual(await tables(), []);
    const { rows } = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'forbid_change'`);
    assert.equal(rows.length, 0);

    await migrate('up');
    assert.deepEqual(await tables(), TABLES);
  });

  test('each migration can be undone one at a time', async () => {
    await migrate('down', 1);
    const { rows } = await client.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'analysis_results_immutable'`);
    assert.equal(rows.length, 0, 'the trigger migration is undone first');
    assert.deepEqual(await tables(), TABLES, 'the tables are still there');
    await migrate('up');
  });
});

describe('schema rules', () => {
  const ids = {};

  before(async () => {
    // A minimal chain: lecturer, two students, course, assignment, workspace, submission, analysis.
    await client.query(`
      INSERT INTO users (id, email, display_name, role) VALUES
        ('lect-1', 'Lecturer@Example.com', 'Lecturer One', 'lecturer'),
        ('stu-1', 'stu1@example.com', 'Student One', 'student'),
        ('stu-2', 'stu2@example.com', 'Student Two', 'student')`);
    ids.course = (
      await client.query(
        `INSERT INTO courses (code, title, join_code, owner_id) VALUES ('CTE412', 'Mini project', 'K7QM3XPA', 'lect-1') RETURNING id`
      )
    ).rows[0].id;
    ids.assignment = (
      await client.query(
        `INSERT INTO assignments (course_id, title, brief, deadline, created_by)
         VALUES ($1, 'Report', 'Write it', now() + interval '7 days', 'lect-1') RETURNING id`,
        [ids.course]
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO workspaces (id, assignment_id, name, created_via, created_by) VALUES
         ('grp_A', $1, 'Group 1', 'manual', 'lect-1'),
         ('grp_B', $1, 'Group 2', 'manual', 'lect-1')`,
      [ids.assignment]
    );
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, assignment_id) VALUES ('grp_A', 'stu-1', $1), ('grp_A', 'stu-2', $1)`,
      [ids.assignment]
    );
    ids.submission = (
      await client.query(
        `INSERT INTO submissions (workspace_id, submitted_by, trigger, word_count, author_metrics, document_ref)
         VALUES ('grp_A', 'stu-1', 'manual', 1200, '{}', 'groups/grp_A/files/f1') RETURNING id`
      )
    ).rows[0].id;
    ids.analysis = (
      await client.query(
        `INSERT INTO analysis_results (submission_id, provider, status, ai_likelihood, writing_quality, result)
         VALUES ($1, 'openai', 'completed', 42, 7.5, '{}') RETURNING id`,
        [ids.submission]
      )
    ).rows[0].id;
    ids.grade = (
      await client.query(
        `INSERT INTO grades (workspace_id, user_id, analysis_result_id, time_score, edits_score, writing_score,
                             tasks_score, weights, suggested, explanation)
         VALUES ('grp_A', 'stu-1', $1, 8, 7, 7.5, 6, '{"time":0.25,"edits":0.25,"writing":0.25,"tasks":0.25}', 7.13, 'test')
         RETURNING id`,
        [ids.analysis]
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO overrides (grade_id, lecturer_id, previous_grade, new_grade, reason) VALUES ($1, 'lect-1', 7.13, 8, 'Strong viva')`,
      [ids.grade]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES ('lect-1', 'grade.overridden', 'grade', $1)`,
      [ids.grade]
    );
  });

  describe('append-only tables', () => {
    for (const table of ['analysis_results', 'overrides', 'audit_log']) {
      test(`${table}: UPDATE, DELETE and TRUNCATE are blocked`, async () => {
        const col = table === 'audit_log' ? 'target_type' : 'created_at';
        const value = table === 'audit_log' ? `'x'` : 'now()';
        assert.equal(await errorCode(`UPDATE ${table} SET ${col} = ${value}`), RESTRICT_VIOLATION);
        assert.equal(await errorCode(`DELETE FROM ${table}`), RESTRICT_VIOLATION);
        assert.equal(await errorCode(`TRUNCATE ${table} CASCADE`), RESTRICT_VIOLATION);
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
        assert.equal(rows[0].n, 1, 'the row is still there');
      });
    }

    test('the error names the table and the operation', async () => {
      await assert.rejects(client.query(`UPDATE analysis_results SET ai_likelihood = 0`), /analysis_results is append-only: UPDATE/);
    });

    test('a re-run is a new row, which is allowed', async () => {
      await client.query(
        `INSERT INTO analysis_results (submission_id, provider, status, fallback_reason, result)
         VALUES ($1, 'legacy', 'unavailable', 'openai_timeout', '{}')`,
        [ids.submission]
      );
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM analysis_results WHERE submission_id = $1`, [ids.submission]);
      assert.equal(rows[0].n, 2);
    });

    test('deleting a submission that has analysis is refused by the foreign key', async () => {
      assert.equal(await errorCode(`DELETE FROM submissions WHERE id = $1`, [ids.submission]), FK_VIOLATION);
    });

    test('a grade with overrides is updated in place, not deleted', async () => {
      assert.equal(await errorCode(`DELETE FROM grades WHERE id = $1`, [ids.grade]), FK_VIOLATION);
      assert.equal(await errorCode(`UPDATE grades SET suggested = 7.5 WHERE id = $1`, [ids.grade]), null);
    });
  });

  describe('constraints', () => {
    test('rubric weights default to 0.25 each', async () => {
      const { rows } = await client.query(
        `SELECT weight_time, weight_edits, weight_writing, weight_tasks FROM assignments WHERE id = $1`,
        [ids.assignment]
      );
      assert.deepEqual(Object.values(rows[0]), ['0.25', '0.25', '0.25', '0.25']);
    });

    test('rubric weights must add up to 1.00', async () => {
      const sql = `INSERT INTO assignments (course_id, title, brief, deadline, created_by, weight_time, weight_edits, weight_writing, weight_tasks)
                   VALUES ($1, 'Bad', 'x', now(), 'lect-1', $2, $3, $4, $5)`;
      assert.equal(await errorCode(sql, [ids.course, 0.4, 0.3, 0.2, 0.2]), CHECK_VIOLATION);
      assert.equal(await errorCode(sql, [ids.course, 0.4, 0.3, 0.2, 0.1]), null);
    });

    test('a student is in at most one group per assignment', async () => {
      assert.equal(
        await errorCode(`INSERT INTO workspace_members (workspace_id, user_id, assignment_id) VALUES ('grp_B', 'stu-1', $1)`, [ids.assignment]),
        UNIQUE_VIOLATION
      );
    });

    test("a member row must match its workspace's assignment", async () => {
      const other = (
        await client.query(
          `INSERT INTO assignments (course_id, title, brief, deadline, created_by) VALUES ($1, 'Other', 'x', now(), 'lect-1') RETURNING id`,
          [ids.course]
        )
      ).rows[0].id;
      assert.equal(
        await errorCode(`INSERT INTO workspace_members (workspace_id, user_id, assignment_id) VALUES ('grp_B', 'stu-1', $1)`, [other]),
        FK_VIOLATION
      );
    });

    test('one submission per workspace', async () => {
      assert.equal(
        await errorCode(
          `INSERT INTO submissions (workspace_id, trigger, word_count, author_metrics, document_ref) VALUES ('grp_A', 'deadline', 0, '{}', 'x')`
        ),
        UNIQUE_VIOLATION
      );
    });

    test('join codes have 8 characters with no look-alikes', async () => {
      const sql = `INSERT INTO courses (code, title, join_code, owner_id) VALUES ('CTE413', 'Another', $1, 'lect-1')`;
      assert.equal(await errorCode(sql, ['K7QM3XP0']), CHECK_VIOLATION, 'zero is a look-alike');
      assert.equal(await errorCode(sql, ['k7qm3xpa']), CHECK_VIOLATION, 'stored upper case');
      assert.equal(await errorCode(sql, ['K7QM3XPA']), UNIQUE_VIOLATION, 'already used');
    });

    test('emails are unique ignoring case', async () => {
      assert.equal(
        await errorCode(`INSERT INTO users (id, email, display_name) VALUES ('dup', 'lecturer@example.com', 'Dup')`),
        UNIQUE_VIOLATION
      );
    });

    test('scores stay within 0–10 and AI likelihood within 0–100', async () => {
      assert.equal(await errorCode(`UPDATE grades SET suggested = 10.5 WHERE id = $1`, [ids.grade]), CHECK_VIOLATION);
      assert.equal(
        await errorCode(`INSERT INTO analysis_results (submission_id, provider, status, ai_likelihood, result) VALUES ($1, 'openai', 'completed', 101, '{}')`, [
          ids.submission,
        ]),
        CHECK_VIOLATION
      );
    });

    test('peer ratings are 1–5 and never of yourself', async () => {
      const sql = `INSERT INTO peer_evaluations (workspace_id, rater_id, ratee_id, rating) VALUES ('grp_A', $1, $2, $3)`;
      assert.equal(await errorCode(sql, ['stu-1', 'stu-2', 6]), CHECK_VIOLATION);
      assert.equal(await errorCode(sql, ['stu-1', 'stu-1', 4]), CHECK_VIOLATION);
      assert.equal(await errorCode(sql, ['stu-1', 'stu-2', 4]), null);
      assert.equal(await errorCode(sql, ['stu-1', 'stu-2', 5]), UNIQUE_VIOLATION, 'once per pair');
    });

    test('a ticked task records who ticked it', async () => {
      assert.equal(
        await errorCode(`INSERT INTO tasks (workspace_id, title, done_at, created_by) VALUES ('grp_A', 'Intro', now(), 'stu-1')`),
        CHECK_VIOLATION
      );
    });
  });
});
