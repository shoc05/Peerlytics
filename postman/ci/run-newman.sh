#!/usr/bin/env bash
# CI only (the "postman (newman)" job): run inside `firebase emulators:exec --only auth,firestore`
# with DATABASE_URL pointing at a migrated PostgreSQL. Starts the API against the emulators,
# then runs the whole Postman collection with Newman.
set -euo pipefail
cd "$(dirname "$0")/../.."

out="${RUNNER_TEMP:-/tmp}"
node postman/ci/seed-emulator.mjs > "$out/postman-env.json"

# The API reads FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST / GCLOUD_PROJECT from
# the emulator environment, so it verifies emulator tokens and writes to the emulator.
(cd backend && PORT=5000 FLAG_PEER_EVAL_ENABLED=true FLAG_COURSE_DASHBOARD_ENABLED=true node server.js > "$out/backend.log" 2>&1) &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:5000/api/health > /dev/null; then break; fi
  sleep 1
done
curl -sf http://127.0.0.1:5000/api/health

status=0
npx --yes newman@6.2.2 run postman/peerlytics.postman_collection.json \
  --environment "$out/postman-env.json" \
  --reporters cli || status=$?

if [ "$status" -ne 0 ]; then
  echo "---- backend log ----"
  cat "$out/backend.log"
fi
exit "$status"
