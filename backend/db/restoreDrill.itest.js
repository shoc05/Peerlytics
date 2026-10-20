// The restore drill (step 5.2) on a real PostgreSQL (npm run test:db):
// - infra/scripts/restore-drill-checks.sql passes on a complete database and fails when the
//   analysis_results trigger is missing;
// - when pg_dump, pg_restore and sh are on PATH (CI has them), infra/scripts/restore-drill-pod.sh
//   runs end to end: dump -> restore into a temporary database -> checks -> drop.
// The databases here are throwaway test databases.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { createTestDatabase } from './testDatabase.js';

const scripts = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'infra', 'scripts');
const CHECKS = readFileSync(path.join(scripts, 'restore-drill-checks.sql'), 'utf8');

const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const toolsAvailable = has('pg_dump') && has('pg_restore') && has('psql') && has('sh');

let db;
before(async () => {
  db = await createTestDatabase();
  await db.pool.query(`INSERT INTO users (id, display_name, role) VALUES ('u1', 'One', 'student'), ('u2', 'Two', 'lecturer')`);
});
after(async () => {
  await db?.drop();
});

describe('restore-drill-checks.sql', () => {
  test('passes on a complete database and reports every table', async () => {
    const results = await db.pool.query(CHECKS);
    const counts = results.find((r) => r.fields.some((f) => f.name === 'rows'));
    const byTable = Object.fromEntries(counts.rows.map((r) => [r.table, Number(r.rows)]));
    assert.equal(byTable.users, 2);
    assert.equal(Object.keys(byTable).length, 20, '19 app tables plus pgmigrations');
    assert.ok(results.some((r) => r.rows[0]?.trigger_present === 'analysis_results_immutable'));
  });

  test('fails when the write-once trigger is missing', async () => {
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('DROP TRIGGER analysis_results_immutable ON analysis_results');
      await assert.rejects(client.query(CHECKS), /analysis_results_immutable trigger is missing or disabled/);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  test('fails when a table is missing', async () => {
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('DROP TABLE peer_evaluations');
      await assert.rejects(client.query(CHECKS), /tables missing after restore: peer_evaluations/);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });
});

describe('restore-drill-pod.sh end to end', { skip: toolsAvailable ? false : 'pg_dump, pg_restore, psql or sh not on PATH' }, () => {
  test('restores the newest dump into a temporary database, checks it and drops it', () => {
    const url = new URL(db.url);
    const env = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1),
      CHECKS_SQL: path.join(scripts, 'restore-drill-checks.sql'),
    };
    const dir = mkdtempSync(path.join(tmpdir(), 'peerlytics-drill-'));
    try {
      execFileSync('pg_dump', ['-Fc', '-f', path.join(dir, 'peerlytics-test.dump')], { env });
      const run = spawnSync('sh', [path.join(scripts, 'restore-drill-pod.sh')], { env: { ...env, BACKUP_DIR: dir }, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, /restored into restore_drill_\d+/);
      assert.match(run.stdout, /PASS/);
      assert.match(run.stdout, /dropped restore_drill_\d+/);
      const left = execFileSync('psql', ['-X', '-At', '-c', "SELECT count(*) FROM pg_database WHERE datname LIKE 'restore_drill_%'"], { env, encoding: 'utf8' });
      assert.equal(left.trim(), '0', 'the temporary database is gone');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
