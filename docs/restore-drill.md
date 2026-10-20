# Restore drill

Step 5.2 · Owner: Sonam · Script: `infra/scripts/restore-drill.sh`

A backup only counts once it has been restored. This drill proves that **last night's** backup restores into a working database, without touching the live one.

## What it does

`restore-drill.sh` starts a short-lived Kubernetes Job next to the database. The Job runs `restore-drill-pod.sh`:

1. Takes the newest `peerlytics-*.dump` from the `peerlytics-backups` disk, written nightly at 02:00 Asia/Thimphu by the `peerlytics-postgres-backup` CronJob. **It fails if that dump is more than 26 hours old**, so a backup job that silently stopped is caught.
2. Creates a temporary database `restore_drill_<timestamp>` and runs `pg_restore` into it.
3. Runs `restore-drill-checks.sql` on the restored copy:
   - every table in `docs/db-schema.md` exists; otherwise it **fails**
   - the `analysis_results_immutable` trigger exists and is enabled, so analysis results are still write-once; otherwise it **fails**
   - prints the row count of every table, the newest submission time, and the number of migrations
4. Compares the migration count with the live database. A difference is a warning only: it means a migration ran after the backup.
5. **Drops the temporary database, even if a step failed.**

The live database is only read, to count its migrations.

## Run it

```bash
infra/scripts/restore-drill.sh -n staging        # or: -n production (the default)
```

It needs `kubectl` access to the cluster. Exit code 0 means PASS, and the Job's log is printed at the end. Use `-t <minutes>` to wait longer than 30 minutes on a large database.

Without Kubernetes (any machine with the PostgreSQL client tools):

```bash
PGHOST=… PGUSER=… PGPASSWORD=… PGDATABASE=<live db> BACKUP_DIR=./backups \
CHECKS_SQL=infra/scripts/restore-drill-checks.sql sh infra/scripts/restore-drill-pod.sh
```

## How it is tested

- `backend/db/restoreDrill.itest.js` (CI job `backend db`) runs the checks on a migrated database. It also checks that they fail when the trigger or a table is missing, and runs the full dump → restore → check → drop cycle with `restore-drill-pod.sh`.
- The CI job `k8s (kustomize, kubeconform)` runs `shellcheck` on the scripts.

### Rehearsal (20 Oct 2026, local PostgreSQL 17, test data)

A rehearsal on a test database with a few rows, not the live system:

| Check | Result |
|---|---|
| Restore of a 64 KB dump | 1 s |
| Tables found | 19 of 19, plus `pgmigrations` (4 migrations, newest `1792368000003_nullable-grade-scores`) |
| Row counts | users 3, courses 1, assignments 1, workspaces 1, workspace_members 2, submissions 1, analysis_results 1, all others 0. These match what was inserted |
| Newest submission | 2026-10-19 09:30 UTC (14:30 in Bhutan) |
| Trigger `analysis_results_immutable` | present |
| Temporary database afterwards | dropped (0 left) |
| Trigger removed before the backup | **FAIL** (exit 3), temporary database still dropped |
| Backup 30 hours old | **FAIL** (exit 1) |
| No backup | **FAIL** (exit 1) |

## Drill log

Record every real drill here. Copy the numbers from the script's output; don't round or guess them.

| Date | Environment | Backup file | Age (h) | Restore time (s) | Tables | users / submissions / analysis_results rows | Newest submission | Trigger | Result | Who |
|---|---|---|---|---|---|---|---|---|---|---|
| | staging | | | | | | | | | |
| | production | | | | | | | | | |

## Targets

- **Recovery point (RPO): up to 24 hours.** Backups run nightly, so at most a day of changes can be lost.
- **Recovery time (RTO):** the restore time measured above, plus redeploying the backend. Record it from the first production drill.
- The dumps sit on the same server as the database. A copy off the server (step 5.5, Tshewang) is what protects against losing the server itself.

## If it fails

| Message | Meaning and fix |
|---|---|
| `no backup found` | The CronJob never ran or the disk is empty: `kubectl -n <ns> get cronjob,jobs`, and run one with `kubectl -n <ns> create job --from=cronjob/peerlytics-postgres-backup backup-now` |
| `older than 26 hours` | The nightly job has been failing: check `kubectl -n <ns> logs job/<latest backup job>` |
| `tables missing after restore` | The dump is incomplete, or the migrations changed without updating the checks. Compare with `docs/db-schema.md` |
| `trigger is missing or disabled` | Someone dropped or disabled `analysis_results_immutable`. Restore it with migration `1792368000001` and find out why |
