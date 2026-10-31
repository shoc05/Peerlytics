#!/usr/bin/env bash
# Switch production's backend back to the other colour in one command (step 5.1).
#   infra/scripts/rollback.sh prod
# The other colour is still running the previous release, so this takes seconds: it turns the
# jobs on there, points Caddy at it, and turns them off in the colour being left. Nothing is
# pulled. collab and notifier stay as they are; to roll those back too, run
#   IMAGE_PREFIX=... infra/scripts/deploy.sh prod <previous tag>
# Staging has no second colour: redeploy an older tag with deploy.sh (docs/deploy.md).
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$HERE/lib.sh"

[[ $# -eq 1 ]] || die "usage: rollback.sh prod"
[[ "$1" == prod ]] || die "only prod has blue/green; for staging run deploy.sh staging <older tag>"

exec 9> "$PEERLYTICS_ROOT/.deploy.lock"
flock -w 600 9 || die "a deploy is still running"

IMAGE_PREFIX="$(cat "$PEERLYTICS_ROOT/.image_prefix-prod" 2> /dev/null || true)"
[[ -n "$IMAGE_PREFIX" ]] || die "no production deploy has run on this server yet"
export IMAGE_PREFIX

ACTIVE="$(active_colour)"
[[ -n "$ACTIVE" ]] || die "no live colour recorded in $PEERLYTICS_ROOT/.active_color-prod"
TARGET="$(other_colour "$ACTIVE")"
TARGET_TAG="$(colour_tag "$TARGET")"
[[ "$TARGET_TAG" != unset ]] || die "backend_$TARGET has never run; nothing to roll back to"
check_tag "$TARGET_TAG"

export_colours
# Compose needs TAG for the services this script doesn't touch.
export TAG="$TARGET_TAG"

log "rolling production back: backend_$ACTIVE ($(colour_tag "$ACTIVE")) -> backend_$TARGET ($TARGET_TAG)"
promote "$TARGET" "$TARGET_TAG" || die "rollback failed; /api still goes to backend_$(active_colour)"
printf '%s\n' "$TARGET_TAG" > "$(last_good_file prod)"
log "done: production /api is on $TARGET_TAG"
