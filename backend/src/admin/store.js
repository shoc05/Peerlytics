// Colleges and licences in PostgreSQL. A college's licence history is kept: setting a licence adds
// a row, and the one with the latest start date is current. Each write and its audit_log row go in
// one transaction. audit_log.actor_id points at the PostgreSQL users table, which doesn't hold
// every Firebase account yet, so the admin's uid goes in details.

export class StoreError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const LICENCE_COLUMNS = `id, plan, seats, monthly_ai_budget_usd::float8 AS "monthlyAiBudgetUsd",
  starts_on::text AS "startsOn", ends_on::text AS "endsOn", created_at AS "createdAt"`;

export function createAdminStore(pool) {
  async function inTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const audit = (client, action, targetType, targetId, details) =>
    client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, details)
       VALUES (NULL, $1, $2, $3, $4)`,
      [action, targetType, targetId, JSON.stringify(details)]
    );

  return {
    async listColleges() {
      const { rows } = await pool.query(
        `SELECT c.id, c.name, c.slug, c.created_at AS "createdAt", current_licence.licence
         FROM colleges c
         LEFT JOIN LATERAL (
           SELECT to_jsonb(l) AS licence
           FROM (
             SELECT ${LICENCE_COLUMNS} FROM licences
             WHERE college_id = c.id
             ORDER BY starts_on DESC, created_at DESC
             LIMIT 1
           ) l
         ) current_licence ON true
         ORDER BY c.name`
      );
      return rows.map((row) => ({ ...row, licence: row.licence ?? null }));
    },

    async createCollege({ name, slug }, actorUid) {
      try {
        return await inTransaction(async (client) => {
          const { rows } = await client.query(
            `INSERT INTO colleges (name, slug) VALUES ($1, $2)
             RETURNING id, name, slug, created_at AS "createdAt"`,
            [name, slug]
          );
          await audit(client, 'college.created', 'college', rows[0].id, { by: actorUid, name, slug });
          return { ...rows[0], licence: null };
        });
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION) throw new StoreError('SLUG_TAKEN');
        throw err;
      }
    },

    async addLicence(collegeId, { plan, seats, monthlyAiBudgetUsd, startsOn, endsOn }, actorUid) {
      try {
        return await inTransaction(async (client) => {
          const { rows } = await client.query(
            `INSERT INTO licences (college_id, plan, seats, monthly_ai_budget_usd, starts_on, ends_on)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING ${LICENCE_COLUMNS}`,
            [collegeId, plan, seats, monthlyAiBudgetUsd, startsOn, endsOn]
          );
          await audit(client, 'licence.created', 'college', collegeId, {
            by: actorUid,
            licenceId: rows[0].id,
            plan,
            seats,
            monthlyAiBudgetUsd,
            startsOn,
            endsOn,
          });
          return rows[0];
        });
      } catch (err) {
        if (err.code === FOREIGN_KEY_VIOLATION) throw new StoreError('NOT_FOUND');
        throw err;
      }
    },
  };
}
