#!/usr/bin/env bash
# One-time set-up when your own PC is the server (DEPLOY_MODE=local, docs/deploy.md).
# Run inside WSL2 Ubuntu, with Docker Desktop's WSL integration on for this distro:
#   bash infra/scripts/setup-local-server.sh <github-owner> <email>
# Creates /opt/peerlytics (owned by you), the edge network, and edge.env, .env.staging and
# .env.prod. Files that already exist are left alone, so it is safe to run again. You still
# fill in FIREBASE_SERVICE_ACCOUNT and the API keys yourself (the script says which).
set -Eeuo pipefail

[[ $# -eq 2 ]] || { echo "usage: setup-local-server.sh <github-owner> <email>" >&2; exit 1; }
OWNER="${1,,}"
EMAIL="$2"
ROOT=/opt/peerlytics

docker info > /dev/null 2>&1 || {
  echo "Docker isn't reachable. Docker Desktop: Settings > Resources > WSL integration > turn on this distro." >&2
  exit 1
}

sudo mkdir -p "$ROOT/infra" "$ROOT/edge/upstreams"
sudo chown -R "$(id -u):$(id -g)" "$ROOT"
docker network inspect edge > /dev/null 2>&1 || docker network create edge > /dev/null

# write_once <file>: stdin becomes the file, mode 600, unless it exists already.
write_once() {
  if [[ -e "$1" ]]; then
    echo "kept     $1"
    cat > /dev/null
  else
    (umask 077; cat > "$1")
    echo "created  $1"
  fi
}

# http:// makes Caddy serve these names over plain HTTP; *.localhost needs no DNS.
write_once "$ROOT/edge.env" << EOF
STAGING_DOMAIN=http://staging.localhost
PROD_DOMAIN=http://prod.localhost
ACME_EMAIL=$EMAIL
EOF

# env_file <env> <cors origin> <run jobs>
env_file() {
  write_once "$ROOT/.env.$1" << EOF
POSTGRES_PASSWORD=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
CORS_ORIGIN=$2
RUN_JOBS=$3
DEADLINE_TIMEZONE=Asia/Thimphu
# The Firebase service-account JSON on one line, in single quotes. collab won't start without it.
FIREBASE_SERVICE_ACCOUNT=
HF_API_KEY=
HF_AI_MODEL=
VWT_API_KEY=
METRICS_TOKEN=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
# Optional deadline emails: SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT, SMTP_FROM
EOF
}
env_file staging "https://$OWNER.github.io" false
env_file prod "https://peerlytics-4367c.web.app" true

echo
echo "Next: put FIREBASE_SERVICE_ACCOUNT (and the API keys you have) into"
echo "  $ROOT/.env.staging and $ROOT/.env.prod"
