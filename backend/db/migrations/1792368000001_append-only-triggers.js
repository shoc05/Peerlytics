// History tables are append-only (docs/db-schema.md): analysis_results, overrides and
// audit_log. A BEFORE UPDATE OR DELETE trigger raises an error for every row, so the rule
// holds even for the app's own database user and for a mistaken manual query. TRUNCATE
// doesn't fire row triggers, so it is blocked with a statement trigger too.
// The restore drill (step 5.2) checks that analysis_results_immutable exists.

const TABLES = ['analysis_results', 'overrides', 'audit_log'];

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION forbid_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$;
  `);
  for (const table of TABLES) {
    const name = table === 'analysis_results' ? 'analysis_results_immutable' : `${table}_append_only`;
    pgm.sql(`
      CREATE TRIGGER ${name}
        BEFORE UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION forbid_change();
      CREATE TRIGGER ${table}_no_truncate
        BEFORE TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
    `);
  }
};

export const down = (pgm) => {
  for (const table of TABLES) {
    const name = table === 'analysis_results' ? 'analysis_results_immutable' : `${table}_append_only`;
    pgm.sql(`
      DROP TRIGGER ${table}_no_truncate ON ${table};
      DROP TRIGGER ${name} ON ${table};
    `);
  }
  pgm.sql('DROP FUNCTION forbid_change();');
};
