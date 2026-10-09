#!/usr/bin/env bash
# Peerlytics step 0.2 - GitHub settings and secrets, from the command line.
#
# Needs: gh (logged in as an admin of the repo), jq, git, openssl.
# Run it from inside the cloned repo:   bash setup-github.sh
# Safe to run again: existing things are skipped or overwritten with the same values.
set -euo pipefail

# ---- edit these if needed -------------------------------------------------
# Check names must match the job names shown on a PR's Checks list exactly.
CHECKS=("Website (lint, test, build)" "backend (lint, test)" "Jira key in PR title")
# Who approves production deploys (default: the logged-in GitHub user).
REVIEWER="${REVIEWER:-}"
# ---------------------------------------------------------------------------

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing tool: $1"; exit 1; }; }
need gh; need jq; need git; need openssl
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first."; exit 1; }

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
ME=$(gh api user -q .login)
REVIEWER=${REVIEWER:-$ME}
REVIEWER_ID=$(gh api "users/$REVIEWER" -q .id)
echo "Repo: $REPO | you: $ME | production reviewer: $REVIEWER"

gh api "repos/$REPO/branches/main" >/dev/null 2>&1 \
  || { echo "No 'main' branch found. Push main first (or rename in this script)."; exit 1; }

# ---- 0. keep secret files out of git ---------------------------------------
touch .gitignore
for p in ".secrets.env" "secrets/"; do
  grep -qxF "$p" .gitignore || echo "$p" >> .gitignore
done

# ---- 1. CODEOWNERS on main (before protection is switched on) --------------
if ! gh api "repos/$REPO/contents/.github/CODEOWNERS?ref=main" >/dev/null 2>&1; then
  CONTENT=$(printf '* @%s\n' "$ME" | base64 | tr -d '\n')
  gh api -X PUT "repos/$REPO/contents/.github/CODEOWNERS" \
    -f message="PEER-1 Add CODEOWNERS" -f content="$CONTENT" -f branch=main >/dev/null
  echo "Added .github/CODEOWNERS on main"
fi

# ---- 2. develop branch ------------------------------------------------------
if ! gh api "repos/$REPO/branches/develop" >/dev/null 2>&1; then
  SHA=$(gh api "repos/$REPO/git/ref/heads/main" -q .object.sha)
  gh api "repos/$REPO/git/refs" -f ref=refs/heads/develop -f sha="$SHA" >/dev/null
  echo "Created develop from main"
fi

# ---- 3. branch protection ---------------------------------------------------
CHECKS_JSON=$(printf '%s\n' "${CHECKS[@]}" | jq -R . | jq -s .)

protect() { # branch, require-code-owners (true|false)
  jq -n --argjson checks "$CHECKS_JSON" --argjson owners "$2" '{
    required_status_checks: {strict: true, contexts: $checks},
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: $owners
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false
  }' | gh api -X PUT "repos/$REPO/branches/$1/protection" --input - >/dev/null
  echo "Protected $1"
}
protect develop false
protect main true

# ---- 4. only the admin creates v* tags --------------------------------------
if gh api "repos/$REPO/rulesets" -q '.[].name' | grep -qx release-tags; then
  echo "Tag ruleset release-tags already exists"
else
  jq -n '{
    name: "release-tags", target: "tag", enforcement: "active",
    conditions: {ref_name: {include: ["refs/tags/v*"], exclude: []}},
    rules: [{type: "creation"}, {type: "update"}, {type: "deletion"}],
    bypass_actors: [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]
  }' | gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null \
    && echo "Created tag ruleset release-tags" \
    || echo "WARNING: could not create the tag ruleset (needs a public repo or a paid plan)."
fi

# ---- 5. environments --------------------------------------------------------
echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
  | gh api -X PUT "repos/$REPO/environments/staging" --input - >/dev/null
gh api -X POST "repos/$REPO/environments/staging/deployment-branch-policies" \
  -f name=develop -f type=branch >/dev/null 2>&1 || true
echo "Environment staging ready (develop only)"

if jq -n --argjson id "$REVIEWER_ID" '{
     reviewers: [{type: "User", id: $id}],
     prevent_self_review: false,
     deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}
   }' | gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null 2>&1; then
  echo "Environment production ready (reviewer: $REVIEWER)"
else
  echo "WARNING: required reviewers are not available on this repo/plan."
  echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
    | gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null
  echo "Created production WITHOUT an approval gate; the v* tag restriction is your control."
fi
gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" \
  -f name='v*' -f type=tag >/dev/null 2>&1 || true

# ---- 6. secrets -------------------------------------------------------------
# a) simple one-line secrets from .secrets.env (NAME=value per line, git-ignored)
if [[ -f .secrets.env ]]; then
  gh secret set -f .secrets.env
  echo "Set secrets from .secrets.env"
else
  echo "No .secrets.env found; skipped one-line secrets."
fi

# b) multi-line secrets from files in ./secrets/
set_from_file() { # NAME file
  if [[ -f "$2" ]]; then
    gh secret set "$1" < "$2"
    echo "Set $1"
  else
    echo "Skipped $1 (no $2)"
  fi
}
set_from_file VPS_SSH_KEY secrets/peerlytics_deploy
set_from_file FIREBASE_SERVICE_ACCOUNT secrets/firebase-service-account.json

# c) database password: generated once, never printed
mkdir -p secrets
if ! gh secret list --json name -q '.[].name' | grep -qx POSTGRES_PASSWORD; then
  PW=$(openssl rand -hex 24)
  gh secret set POSTGRES_PASSWORD --body "$PW"
  gh secret set DATABASE_URL --body "postgres://peerlytics:${PW}@postgres:5432/peerlytics"
  (umask 077; printf '%s\n' "$PW" > secrets/postgres_password.txt)
  echo "Generated POSTGRES_PASSWORD and DATABASE_URL (copy of the password: secrets/postgres_password.txt, for the server's .env)"
else
  echo "POSTGRES_PASSWORD already set; left alone"
fi

# ---- 7. show the result -----------------------------------------------------
echo; echo "== main protection =="
gh api "repos/$REPO/branches/main/protection" \
  -q '{checks: .required_status_checks.contexts, approvals: .required_pull_request_reviews.required_approving_review_count, code_owners: .required_pull_request_reviews.require_code_owner_reviews}'
echo "== secrets =="
gh secret list
