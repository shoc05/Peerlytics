#!/usr/bin/env bash
# Tests for deploy.sh and rollback.sh with docker replaced by fake-docker.sh, so they run
# anywhere bash and flock are (cd-checks.yml runs them on every PR that touches infra/).
#   bash infra/scripts/test/deploy-scripts.test.sh
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
INFRA="$(cd "$SCRIPTS/.." && pwd)"
failures=0

# A fresh /opt/peerlytics stand-in and a PATH whose docker is the fake.
setup() {
  ROOT="$(mktemp -d)"
  mkdir -p "$ROOT/bin" "$ROOT/edge/upstreams"
  cp "$HERE/fake-docker.sh" "$ROOT/bin/docker"
  chmod +x "$ROOT/bin/docker"
  # Git Bash on Windows has no flock; the lock itself isn't under test.
  if ! command -v flock > /dev/null; then
    printf '#!/bin/sh\nexit 0\n' > "$ROOT/bin/flock"
    chmod +x "$ROOT/bin/flock"
  fi
  touch "$ROOT/.env.staging" "$ROOT/.env.prod"
  export PATH="$ROOT/bin:$PATH" PEERLYTICS_ROOT="$ROOT" INFRA_DIR="$INFRA"
  export CALLS="$ROOT/calls" IMAGE_PREFIX=ghcr.io/example/peerlytics
  unset FAIL_TAG FAIL_SERVICE
}

deploy() { bash "$SCRIPTS/deploy.sh" "$@" > "$ROOT/out" 2>&1; }
rollback() { bash "$SCRIPTS/rollback.sh" "$@" > "$ROOT/out" 2>&1; }

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "ok - $name"
  else
    echo "not ok - $name"
    sed 's/^/    /' "$ROOT/out" 2> /dev/null || true
    failures=$((failures + 1))
  fi
}
file_is() { [[ "$(cat "$1" 2> /dev/null)" == "$2" ]]; }
has_line() { grep -qxF "$2" "$1"; }
fails() { ! "$@"; }

# ── staging ─────────────────────────────────────────────────────────────────────────────
setup
check "a first deploy succeeds" deploy staging sha-aaaaaaa
check "it saves the last good tag" file_is "$ROOT/.last_good_tag-staging" sha-aaaaaaa
check "it records result=ok" has_line "$ROOT/.last_deploy-staging" result=ok
check "backend is updated before collab" \
  diff <(grep -E '^(backend|collab) ' "$CALLS.up") <(printf 'backend sha-aaaaaaa\ncollab sha-aaaaaaa\n')
check "old images are pruned" grep -q '^image prune' "$CALLS"

: > "$CALLS.up"
export FAIL_TAG=sha-bbbbbbb
check "a deploy whose collab is unhealthy exits 1" fails deploy staging sha-bbbbbbb
check "it records the rollback" \
  diff "$ROOT/.last_deploy-staging" <(printf 'result=rolled_back\ntag=sha-bbbbbbb\nrestored=sha-aaaaaaa\n')
check "the last good tag is deployed again" has_line "$CALLS.up" "collab sha-aaaaaaa"
check "the last good tag stays" file_is "$ROOT/.last_good_tag-staging" sha-aaaaaaa

setup
export FAIL_TAG=sha-ccccccc
check "a failing first deploy exits 1" fails deploy staging sha-ccccccc
check "with nothing to roll back to it records result=failed" has_line "$ROOT/.last_deploy-staging" result=failed

setup
check "a tag with shell characters is refused" fails deploy staging 'x;rm -rf /'
check "a refused deploy leaves no result file" test ! -e "$ROOT/.last_deploy-staging"
check "rollback.sh refuses staging" fails rollback staging


echo
if ((failures)); then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
