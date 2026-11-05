#!/usr/bin/env bash
# Gives the production API a public HTTPS address through Tailscale Funnel (docs/deploy.md).
# Run in Ubuntu on the server PC, as often as you like:
#   bash /opt/peerlytics/infra/scripts/setup-tunnel.sh
# It asks for the auth key once (TS_AUTHKEY in the environment skips the question), and the key
# stays in tunnel.env, readable only by you. It never prints the key.
set -Eeuo pipefail

ROOT="${PEERLYTICS_ROOT:-/opt/peerlytics}"
INFRA="${INFRA_DIR:-$ROOT/infra}"
TUNNEL_ENV="$ROOT/tunnel.env"
EDGE_ENV="$ROOT/edge.env"
PROD_ENV="$ROOT/.env.prod"
export TUNNEL_ENV_FILE="$TUNNEL_ENV" EDGE_ENV_FILE="$EDGE_ENV" EDGE_STATE_DIR="$ROOT/edge"

die() {
  echo "setup-tunnel: $1" >&2
  exit 1
}

tunnel() { docker compose -p tunnel -f "$INFRA/edge/tunnel/docker-compose.yml" "$@"; }

[[ -f "$EDGE_ENV" && -f "$PROD_ENV" ]] || die "run infra/scripts/setup-local-server.sh first"

if [[ ! -s "$TUNNEL_ENV" ]]; then
  key="${TS_AUTHKEY:-}"
  if [[ -z "$key" ]]; then
    read -rsp "Paste the Tailscale auth key (it won't show): " key
    echo
  fi
  [[ "$key" == tskey-* ]] || die "that doesn't look like a Tailscale auth key (tskey-...)"
  (
    umask 077
    printf 'TS_AUTHKEY=%s\n' "$key" > "$TUNNEL_ENV"
  )
fi

tunnel up -d

host=""
for _ in $(seq 1 30); do
  host="$(tunnel exec -T tailscale tailscale status --self --peers=false --json 2> /dev/null |
    sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1 || true)"
  [[ -n "$host" ]] && break
  sleep 2
done
[[ -n "$host" ]] || die "Tailscale didn't come up. Check: docker compose -p tunnel logs tailscale"

# Caddy answers on the tunnel's name as well as prod.localhost.
if ! grep -q "http://$host" "$EDGE_ENV"; then
  sed -i "s|^PROD_DOMAIN=.*|&, http://$host|" "$EDGE_ENV"
fi
# Behind the tunnel a request passes two proxies, so the backend must look two hops back to find
# the visitor's address. With one, every visitor would share a single rate limit.
if ! grep -q '^TRUST_PROXY_HOPS=' "$PROD_ENV"; then
  printf 'TRUST_PROXY_HOPS=2\n' >> "$PROD_ENV"
fi

docker compose -p edge -f "$INFRA/edge/docker-compose.yml" up -d --force-recreate --wait

echo "Public API address: https://$host"
echo "Check it from your phone, on mobile data: https://$host/api/health"
