#!/usr/bin/env bash
# Deploy one image tag to one environment on the Peerlytics server (step 1.9).
#   infra/scripts/deploy.sh <staging|prod> <tag>
# Needs IMAGE_PREFIX (ghcr.io/<owner>/peerlytics) and a docker login to ghcr.io when the images
# aren't on the server yet; the CD workflows set both. In order:
#   1. Caddy and the edge network are up and have the current Caddyfile.
#   2. Pull the images, run the migrations (if the backend has a migrate:up script).
#   3. backend, then collab, then notifier (if enabled), each healthy before the next.
#   4. Success: the tag is saved in /opt/peerlytics/.last_good_tag-<env> and old images pruned.
#      Failure: the last good tag is deployed again and the script exits 1.
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$HERE/lib.sh"

[[ $# -eq 2 ]] || die "usage: deploy.sh <staging|prod> <tag>"
ENV_NAME="$1"
NEW_TAG="$2"
check_env "$ENV_NAME"
check_tag "$NEW_TAG"
: "${IMAGE_PREFIX:?Set IMAGE_PREFIX, e.g. ghcr.io/<owner>/peerlytics}"
export IMAGE_PREFIX
[[ -f "$(env_file "$ENV_NAME")" ]] || die "$(env_file "$ENV_NAME") is missing (docs/deploy.md lists its variables)"

# One deploy at a time on this server: staging and production share Caddy.
exec 9> "$PEERLYTICS_ROOT/.deploy.lock"
flock -w 600 9 || die "another deploy is still running"

# deploy_tag <tag>: every step for one tag; returns non-zero on the first failure.
deploy_tag() {
  export TAG="$1"
  local services=(backend collab)
  if notifier_enabled "$ENV_NAME"; then services+=(notifier); fi

  log "pulling ${services[*]} at $TAG"
  app_compose "$ENV_NAME" pull --quiet "${services[@]}" || return 1
  migrate "$ENV_NAME" || return 1
  local s
  for s in "${services[@]}"; do
    update_service "$ENV_NAME" "$s" || return 1
  done
}

ensure_edge

if deploy_tag "$NEW_TAG"; then
  printf '%s\n' "$NEW_TAG" > "$(last_good_file "$ENV_NAME")"
  log "deployed $NEW_TAG to $ENV_NAME"
  # Images no container uses and older than a week. Running containers keep theirs.
  docker image prune -af --filter "until=168h" > /dev/null || true
  exit 0
fi

log "deploy of $NEW_TAG to $ENV_NAME failed"
app_compose "$ENV_NAME" ps -a || true
LAST_GOOD="$(cat "$(last_good_file "$ENV_NAME")" 2> /dev/null || true)"
if [[ -n "$LAST_GOOD" && "$LAST_GOOD" != "$NEW_TAG" ]]; then
  check_tag "$LAST_GOOD"
  log "rolling back to the last good tag $LAST_GOOD"
  if deploy_tag "$LAST_GOOD"; then
    log "rolled back to $LAST_GOOD"
  else
    log "ERROR: rollback to $LAST_GOOD failed too; $ENV_NAME needs a look by hand" >&2
  fi
else
  log "no earlier good tag for $ENV_NAME; nothing to roll back to"
fi
exit 1
