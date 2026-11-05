#!/usr/bin/env bash
# Stand-in for docker in deploy-scripts.test.sh. Every call is appended to $CALLS, and every
# `compose ... up <service>` to $CALLS.up as "<service> <tag>". An `up` fails when the tag it
# would start is $FAIL_TAG and the service is $FAIL_SERVICE (default collab).
printf '%s\n' "$*" >> "$CALLS"
[[ "$1" == compose ]] || exit 0

case " $* " in
  # deploy.sh asks the backend image whether it has a migrate:up script; this one has none.
  *" run "*) exit 1 ;;
  # setup-tunnel.sh reads the tunnel's public name
  *" status "*) printf '{ "Self": { "DNSName": "peerlytics.example.ts.net." } }\n' ;;
  *" up "*)
    service="${*: -1}"
    tag="${TAG:-}"
    [[ "$service" == backend_blue ]] && tag="$BLUE_TAG"
    [[ "$service" == backend_green ]] && tag="$GREEN_TAG"
    printf '%s %s\n' "$service" "$tag" >> "$CALLS.up"
    if [[ -n "${FAIL_TAG:-}" && "$tag" == "$FAIL_TAG" && "$service" == "${FAIL_SERVICE:-collab}" ]]; then
      exit 1
    fi
    ;;
esac
exit 0
