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


# ── production blue/green (step 5.1) ────────────────────────────────────────────────────
setup
check "first release v1.0.0" deploy prod v1.0.0
check "it goes live on blue" file_is "$ROOT/.active_color-prod" blue
check "Caddy points at blue" grep -q 'prod-backend-blue:5000' "$ROOT/edge/upstreams/prod-backend.caddy"
check "release v1.1.0" deploy prod v1.1.0
check "it goes live on green" file_is "$ROOT/.active_color-prod" green
check "blue keeps v1.0.0 as the standby" file_is "$ROOT/.color_tag-prod-blue" v1.0.0
check "the plain backend service never starts in prod" fails grep -q '^backend ' "$CALLS.up"
check "collab follows the backend" has_line "$CALLS.up" "collab v1.1.0"

: > "$CALLS.up"
export FAIL_TAG=v1.2.0 FAIL_SERVICE=backend_blue
check "v1.2.0 unhealthy on the idle colour exits 1" fails deploy prod v1.2.0
check "it records the rollback to v1.1.0" \
  diff "$ROOT/.last_deploy-prod" <(printf 'result=rolled_back\ntag=v1.2.0\nrestored=v1.1.0\n')
check "green stays live" file_is "$ROOT/.active_color-prod" green
check "Caddy still points at green" grep -q 'prod-backend-green:5000' "$ROOT/edge/upstreams/prod-backend.caddy"
check "blue goes back to v1.0.0" has_line "$CALLS.up" "backend_blue v1.0.0"
check "blue's recorded tag is still v1.0.0" file_is "$ROOT/.color_tag-prod-blue" v1.0.0
unset FAIL_TAG FAIL_SERVICE

check "rollback.sh prod" rollback prod
check "switches /api back to blue" file_is "$ROOT/.active_color-prod" blue
check "Caddy points at blue again" grep -q 'prod-backend-blue:5000' "$ROOT/edge/upstreams/prod-backend.caddy"
check "blue's tag becomes the last good one" file_is "$ROOT/.last_good_tag-prod" v1.0.0
check "running it again switches forward to green" rollback prod
check "green is live again" file_is "$ROOT/.active_color-prod" green

setup
export FAIL_TAG=v1.0.0 FAIL_SERVICE=backend_blue
check "a failing first release exits 1" fails deploy prod v1.0.0
check "no colour is recorded as live" test ! -e "$ROOT/.active_color-prod"
check "the colour that never ran is stopped" grep -q 'stop backend_blue$' "$CALLS"
check "rollback.sh has nothing to switch to" fails rollback prod
unset FAIL_TAG FAIL_SERVICE

# ── The tunnel ──
setup
printf 'PROD_DOMAIN=http://prod.localhost\n' > "$ROOT/edge.env"
tunnel_setup() { TS_AUTHKEY="$1" bash "$SCRIPTS/setup-tunnel.sh" > "$ROOT/out" 2>&1; }
check "a bad auth key is refused" fails tunnel_setup not-a-key
check "and is not kept" test ! -s "$ROOT/tunnel.env"
check "a good key sets up the tunnel" tunnel_setup tskey-auth-test
check "the key is in tunnel.env" file_is "$ROOT/tunnel.env" "TS_AUTHKEY=tskey-auth-test"
check "the key is not printed" fails grep -q tskey "$ROOT/out"
check "Caddy answers on both names" file_is "$ROOT/edge.env" "PROD_DOMAIN=http://prod.localhost, http://peerlytics.example.ts.net"
check "the backend looks two hops back" has_line "$ROOT/.env.prod" "TRUST_PROXY_HOPS=2"
check "it prints the public address" grep -q "https://peerlytics.example.ts.net" "$ROOT/out"
check "running it again is safe" tunnel_setup ignored
check "and changes nothing" file_is "$ROOT/edge.env" "PROD_DOMAIN=http://prod.localhost, http://peerlytics.example.ts.net"
check "the hops line is not repeated" test "$(grep -c TRUST_PROXY_HOPS "$ROOT/.env.prod")" = 1

echo
if ((failures)); then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
