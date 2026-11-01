#!/usr/bin/env bash
# Shared helpers for deploy.sh (and rollback.sh). Sourced, not run.
# shellcheck shell=bash

PEERLYTICS_ROOT="${PEERLYTICS_ROOT:-/opt/peerlytics}"
INFRA_DIR="${INFRA_DIR:-$PEERLYTICS_ROOT/infra}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-180}"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# check_env <env>: only the two environments this server runs.
check_env() {
  case "$1" in
    staging | prod) ;;
    *) die "environment must be staging or prod, not '$1'" ;;
  esac
}

# check_tag <tag>: the characters a Docker tag may contain, so it is safe in a command line.
check_tag() {
  [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "not a valid image tag: '$1'"
}

env_file() { printf '%s/.env.%s' "$PEERLYTICS_ROOT" "$1"; }
last_good_file() { printf '%s/.last_good_tag-%s' "$PEERLYTICS_ROOT" "$1"; }

# app_compose <env> <compose args...>: docker compose for one environment's project.
# Uses DEPLOY_ENV, TAG and IMAGE_PREFIX from the caller's environment.
app_compose() {
  local env="$1"
  shift
  local files=(-f "$INFRA_DIR/compose/docker-compose.yml")
  if [[ -f "$INFRA_DIR/compose/docker-compose.$env.yml" ]]; then
    files+=(-f "$INFRA_DIR/compose/docker-compose.$env.yml")
  fi
  local profiles=()
  if notifier_enabled "$env"; then
    profiles=(--profile notifier)
  fi
  DEPLOY_ENV="$env" docker compose -p "peerlytics-$env" --env-file "$(env_file "$env")" \
    "${files[@]}" "${profiles[@]}" "$@"
}

edge_compose() {
  docker compose -p edge -f "$INFRA_DIR/edge/docker-compose.yml" "$@"
}

# The edge network and Caddy, started if missing; a changed Caddyfile is validated, then loaded.
# A config Caddy rejects leaves the running one in place.
ensure_edge() {
  docker network inspect edge > /dev/null 2>&1 || docker network create edge > /dev/null
  # The Caddyfile imports this file; Caddy won't start without it. Blue until a prod deploy says otherwise.
  mkdir -p "$(dirname "$(upstream_file)")"
  [[ -f "$(upstream_file)" ]] || write_upstream blue
  edge_compose up -d --wait --wait-timeout "$WAIT_TIMEOUT"
  edge_compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null
  edge_compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

# notifier_enabled <env>
notifier_enabled() {
  grep -qE '^NOTIFIER_ENABLED=true$' "$(env_file "$1")"
}

# update_service <env> <service>: start the service on $TAG and wait until Docker reports it healthy.
update_service() {
  log "updating $2 to $TAG"
  app_compose "$1" up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" "$2"
}

# migrate <env>: run the backend's migrations if this image has a migrate:up script.
# Callers use `migrate ... || return 1`, which turns set -e off in here, so each step checks itself.
migrate() {
  local env="$1"
  app_compose "$env" up -d --wait --wait-timeout "$WAIT_TIMEOUT" postgres || return 1
  if app_compose "$env" run --rm --no-deps -T backend \
    node -e "process.exit(require('./package.json').scripts?.['migrate:up'] ? 0 : 1)"; then
    log "running migrations"
    app_compose "$env" run --rm --no-deps -T backend npm run --silent migrate:up || return 1
  else
    log "no migrate:up script in this backend image; skipping migrations"
  fi
}

# ── Production blue/green (step 5.1) ──────────────────────────────────────────────────────
# State in /opt/peerlytics: .active_color-prod holds the live colour, .color_tag-prod-<colour>
# the tag each colour runs, .image_prefix-prod the registry prefix (for rollback.sh).

upstream_file() { printf '%s/edge/upstreams/prod-backend.caddy' "$PEERLYTICS_ROOT"; }
active_colour() { cat "$PEERLYTICS_ROOT/.active_color-prod" 2> /dev/null || true; }
other_colour() { if [[ "$1" == blue ]]; then echo green; else echo blue; fi; }
colour_tag() { cat "$PEERLYTICS_ROOT/.color_tag-prod-$1" 2> /dev/null || echo unset; }

write_upstream() {
  local f
  f="$(upstream_file)"
  printf '# Managed by infra/scripts/lib.sh. Live production backend colour.
reverse_proxy prod-backend-%s:5000
' "$1" > "$f.tmp"
  mv "$f.tmp" "$f"
}

# export_colours: BLUE_/GREEN_TAG and _RUN_JOBS for compose, from the saved state. Only the live
# colour runs the jobs.
export_colours() {
  local active
  active="$(active_colour)"
  BLUE_TAG="$(colour_tag blue)"
  GREEN_TAG="$(colour_tag green)"
  BLUE_RUN_JOBS=false
  GREEN_RUN_JOBS=false
  [[ "$active" == blue ]] && BLUE_RUN_JOBS=true
  [[ "$active" == green ]] && GREEN_RUN_JOBS=true
  export BLUE_TAG GREEN_TAG BLUE_RUN_JOBS GREEN_RUN_JOBS
}

# run_colour <colour> <tag> <run_jobs>: (re)create one colour and wait until it is healthy.
run_colour() {
  local colour="$1" tag="$2" jobs="$3" upper
  upper="$(tr '[:lower:]' '[:upper:]' <<< "$colour")"
  export "${upper}_TAG=$tag" "${upper}_RUN_JOBS=$jobs"
  log "backend_$colour on $tag (RUN_JOBS=$jobs)"
  app_compose prod up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" "backend_$colour"
}

# switch_to <colour>: point Caddy at that colour. The old file comes back if Caddy refuses.
switch_to() {
  local colour="$1" previous
  previous="$(cat "$(upstream_file)")"
  # Caddy's own view: the alias must resolve and answer on the edge network.
  edge_compose exec -T caddy wget -qO- "http://prod-backend-$colour:5000/api/health" > /dev/null || return 1
  write_upstream "$colour"
  if ! edge_compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    printf '%s
' "$previous" > "$(upstream_file)"
    return 1
  fi
  printf '%s
' "$colour" > "$PEERLYTICS_ROOT/.active_color-prod"
  log "production /api now goes to backend_$colour"
}

# promote <colour> <tag>: make an already healthy idle colour live, in an order that never
# leaves /api without a backend: jobs on in the idle colour, switch, jobs off in the old one.
# Both colours run the jobs for the few seconds in between.
promote() {
  local colour="$1" tag="$2" old
  old="$(other_colour "$colour")"
  run_colour "$colour" "$tag" true || return 1
  switch_to "$colour" || return 1
  printf '%s
' "$tag" > "$PEERLYTICS_ROOT/.color_tag-prod-$colour"
  if [[ "$(colour_tag "$old")" != unset ]]; then
    run_colour "$old" "$(colour_tag "$old")" false       || log "WARNING: backend_$old didn't come back healthy with RUN_JOBS=false; rollback.sh needs it"
  fi
}

# deploy_backend_bluegreen <tag>: the new tag goes to the idle colour with the jobs off, must be
# healthy, then becomes live. The old colour keeps running for rollback.sh.
deploy_backend_bluegreen() {
  local tag="$1" active idle
  export_colours
  active="$(active_colour)"
  idle="$(other_colour "${active:-green}")"
  run_colour "$idle" "$tag" false || return 1
  promote "$idle" "$tag"
}
