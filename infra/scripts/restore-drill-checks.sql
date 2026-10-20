-- Restore drill checks (step 5.2). Run against the TEMPORARY database a backup was restored
-- into, never against the live one. Fails (non-zero psql exit with ON_ERROR_STOP) if the
-- restore is incomplete; otherwise prints what was restored.
-- Used by infra/scripts/restore-drill.sh; tested by backend/db/restoreDrill.itest.js.

DO $$
DECLARE
  missing text;
BEGIN
  -- Every table in docs/db-schema.md.
  SELECT string_agg(t, ', ' ORDER BY t) INTO missing
    FROM unnest(ARRAY[
      'colleges', 'licences', 'college_domains', 'users', 'courses', 'enrolments', 'announcements',
      'assignments', 'group_extensions', 'workspaces', 'workspace_members', 'tasks', 'submissions',
      'analysis_results', 'grades', 'overrides', 'peer_evaluations', 'usage', 'audit_log'
    ]) AS t
   WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'restore drill: tables missing after restore: %', missing;
  END IF;

  -- analysis_results must still be write-once.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'analysis_results_immutable'
       AND tgrelid = 'public.analysis_results'::regclass
       AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'restore drill: the analysis_results_immutable trigger is missing or disabled';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pgmigrations) THEN
    RAISE EXCEPTION 'restore drill: no migrations recorded in pgmigrations';
  END IF;
END
$$;

-- Row count of every table (query_to_xml runs a count per table without a stored function).
SELECT c.relname AS "table",
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text::bigint AS "rows"
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
 ORDER BY 1;

SELECT max(submitted_at) AS newest_submission FROM submissions;

SELECT count(*) AS migrations, max(name) AS latest_migration FROM pgmigrations;

SELECT 'analysis_results_immutable' AS trigger_present FROM pg_trigger WHERE tgname = 'analysis_results_immutable';
