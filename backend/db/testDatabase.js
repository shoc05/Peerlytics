// For integration tests only: a throwaway PostgreSQL database with every migration applied.
// It needs TEST_DATABASE_URL (or DATABASE_URL), from the environment or the repo-root .env,
// pointing at a server where the user may CREATE DATABASE. Each call makes its own database
// and drop() removes it, so a development database is never touched.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { loadDotenv } from '../config/index.js';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function adminDatabaseUrl() {
  loadDotenv();
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) in the environment or the root .env to run the database tests.');
  return url;
}

/** Create an empty database. Returns { url, drop }. */
export async function createEmptyDatabase(prefix = 'peerlytics_itest') {
  const adminUrl = adminDatabaseUrl();
  const name = `${prefix}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop() {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

/** A migrated database with a pool. Returns { url, pool, drop }. */
export async function createTestDatabase() {
  const { url, drop } = await createEmptyDatabase();
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations', log: () => {} });
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    url,
    pool,
    async drop() {
      await pool.end();
      await drop();
    },
  };
}
