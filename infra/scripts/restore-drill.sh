#!/usr/bin/env bash
# Restore drill (step 5.2). Proves last night's backup can be restored. In a Kubernetes Job
# next to the database, restore-drill-pod.sh:
#   1. takes the newest pg_dump on the peerlytics-backups disk (it must be under 26 hours old),
#   2. restores it into a TEMPORARY database next to the live one,
#   3. checks every table is there, prints row counts and the newest submission time, and checks
#      that the analysis_results write-once trigger exists (restore-drill-checks.sql),
#   4. drops the temporary database, whatever happened.
# The live database is only read (to compare the migration count); it is never written.
#
# Usage: infra/scripts/restore-drill.sh [-n namespace] [-t minutes]
#   -n  namespace (default: production)
#   -t  minutes to wait for the drill (default: 30)
# Needs kubectl access to the cluster. Exit code 0 = PASS. See docs/restore-drill.md.
set -euo pipefail

NS=production
TIMEOUT_MIN=30
while getopts "n:t:h" opt; do
  case "$opt" in
    n) NS="$OPTARG" ;;
    t) TIMEOUT_MIN="$OPTARG" ;;
    *) sed -n '2,15p' "$0"; exit 2 ;;
  esac
done
case "$TIMEOUT_MIN" in '' | *[!0-9]*) echo "-t takes whole minutes"; exit 2 ;; esac

here="$(cd "$(dirname "$0")" && pwd)"
job="restore-drill-$(date -u +%Y%m%d%H%M%S)"
started=$(date +%s)

cleanup() {
  kubectl -n "$NS" delete job "$job" --ignore-not-found --wait=false > /dev/null 2>&1 || true
  kubectl -n "$NS" delete configmap "$job" --ignore-not-found > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Restore drill $job in namespace $NS"
kubectl -n "$NS" create configmap "$job"   --from-file=drill.sh="$here/restore-drill-pod.sh"   --from-file=checks.sql="$here/restore-drill-checks.sql" > /dev/null

# The pod carries the backup job's label, so the PostgreSQL NetworkPolicy lets it connect.
kubectl -n "$NS" apply -f - > /dev/null <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: $job
  labels:
    app.kubernetes.io/name: peerlytics-postgres-backup
    app.kubernetes.io/part-of: peerlytics
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app.kubernetes.io/name: peerlytics-postgres-backup
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 70
        runAsGroup: 70
        fsGroup: 70
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: drill
          image: postgres:16-alpine
          command: [/bin/sh, /drill/drill.sh]
          env:
            - { name: PGHOST, value: peerlytics-postgres }
            - { name: PGUSER, value: peerlytics }
            - { name: PGDATABASE, value: peerlytics }
            - name: PGPASSWORD
              valueFrom: { secretKeyRef: { name: peerlytics-postgres, key: POSTGRES_PASSWORD } }
            - { name: BACKUP_DIR, value: /backups }
            - { name: CHECKS_SQL, value: /drill/checks.sql }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: "1", memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: [ALL] }
          volumeMounts:
            - { name: backups, mountPath: /backups, readOnly: true }
            - { name: drill, mountPath: /drill, readOnly: true }
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: backups
          persistentVolumeClaim: { claimName: peerlytics-backups, readOnly: true }
        - name: drill
          configMap: { name: $job }
        - name: tmp
          emptyDir: {}
EOF

# Wait for the Job to finish either way, then show its log.
status=""
deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
while [ -z "$status" ]; do
  if [ "$(kubectl -n "$NS" get job "$job" -o jsonpath='{.status.succeeded}')" = "1" ]; then status=pass; fi
  if [ "$(kubectl -n "$NS" get job "$job" -o jsonpath='{.status.failed}')" = "1" ]; then status=fail; fi
  if [ -z "$status" ] && [ "$(date +%s)" -gt "$deadline" ]; then status=timeout; fi
  [ -z "$status" ] && sleep 5
done

echo "---- drill log ----"
kubectl -n "$NS" logs "job/$job" || true
echo "-------------------"
echo "Result: $status after $(( $(date +%s) - started )) s"
[ "$status" = pass ]
