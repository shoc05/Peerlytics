// The PostgreSQL connection pool. Tables are created by the migrations in db/migrations/
// (docs/db-schema.md). Without DATABASE_URL there is no pool, and the routes that need the
// database answer that it is unavailable; everything else keeps working.
import pg from 'pg';

/** @returns {{ pool: pg.Pool | null, ping: () => Promise<boolean>, close: () => Promise<void> }} */
export function createDb({ databaseUrl, max = 10 } = {}) {
  if (!databaseUrl) {
    return { pool: null, ping: async () => false, close: async () => {} };
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max, connectionTimeoutMillis: 5_000 });
  // An idle client losing its connection must not crash the process; the next query reconnects.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));

  return {
    pool,
    /** true when a trivial query answers within 2 s. */
    async ping() {
      try {
        await Promise.race([
          pool.query('SELECT 1'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000).unref()),
        ]);
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
