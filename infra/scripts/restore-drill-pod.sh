#!/bin/sh
# The part of the restore drill that runs next to the database (step 5.2). restore-drill.sh
# runs it in a Kubernetes Job; it also runs on any machine with the PostgreSQL client tools:
#   PGHOST=… PGUSER=… PGPASSWORD=… PGDATABASE=… BACKUP_DIR=./backups sh restore-drill-pod.sh
# PGDATABASE is the LIVE database: it is only read, to compare the migration count.
# Exit code 0 = PASS. The temporary database is dropped however the script ends.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
CHECKS_SQL="${CHECKS_SQL:-$(dirname "$0")/checks.sql}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"

latest=$(ls -1t "$BACKUP_DIR"/peerlytics-*.dump 2>/dev/null | head -n 1 || true)
if [ -z "$latest" ]; then
  echo "FAIL: no backup found in $BACKUP_DIR"
  exit 1
fi
age_h=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))
echo "backup: $(basename "$latest"), $(du -h "$latest" | cut -f1), ${age_h} h old"
if [ "$age_h" -gt "$MAX_AGE_HOURS" ]; then
  echo "FAIL: the newest backup is older than $MAX_AGE_HOURS hours"
  exit 1
fi

db="restore_drill_$(date +%s)"
cleanup() { dropdb --if-exists "$db" && echo "dropped $db"; }
trap cleanup EXIT
createdb "$db"
t0=$(date +%s)
pg_restore --no-owner --no-privileges --exit-on-error -d "$db" "$latest"
echo "restored into $db in $(( $(date +%s) - t0 )) s"

psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$CHECKS_SQL"

live=$(psql -X -At -c "SELECT count(*) FROM pgmigrations")
restored=$(psql -X -At -d "$db" -c "SELECT count(*) FROM pgmigrations")
if [ "$live" != "$restored" ]; then
  echo "WARN: the live database has $live migrations, the backup $restored (a migration ran after the backup)"
fi
echo "PASS"
