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
