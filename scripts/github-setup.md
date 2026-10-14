# GitHub settings for Peerlytics

Steps 0.2 of the team guide. Owner: Sangay (repository admin).

`scripts/setup-github.sh` already applied everything in sections 1 to 3 on 13 Oct 2026. Use this page to check the settings in the browser, to redo them by hand, or to set up a fresh copy of the repo. Run the script again whenever the list of required checks changes; it is safe to run twice.

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/setup-github.sh
```

## 1. Branch protection for `develop` and `main`

Go to **Settings → Branches → Add branch protection rule** (or **Edit** on an existing rule). Do this once for `develop` and once for `main`.

| Setting | develop | main |
|---|---|---|
| Branch name pattern | `develop` | `main` |
| Require a pull request before merging | On | On |
| Required approvals | 1 | 1 |
| Dismiss stale approvals when new commits are pushed | On | On |
| Require review from Code Owners | Off | On (`.github/CODEOWNERS` names Sangay) |
| Require status checks to pass before merging | On | On |
| Require branches to be up to date before merging | On | On |
| Required checks (search and add each) | see below | see below |
| Do not allow bypassing the above settings | Off, so the admin can merge in an emergency | Off |
| Allow force pushes | Off | Off |
| Allow deletions | Off | Off |

**Required checks.** These are the CI job names, not the file names. A check only appears in the search box after it has run once on a PR.

| Check name | Workflow file | Required now |
|---|---|---|
| `Website (lint, test, build)` | `.github/workflows/ci.yml` | Yes |
| `backend (lint, test)` | `.github/workflows/ci.yml` | Yes |
| `Jira key in PR title` | `.github/workflows/jira-check.yml` | Yes |
| `Firestore rules tests` | `.github/workflows/ci.yml` | Not yet. It is in the script's list since PEER-4; rerun the script to require it |

If anyone renames a job, update `CHECKS` in `scripts/setup-github.sh` and rerun it in the same PR. Otherwise every PR waits for a check that never runs and nothing can merge.

**"Only Sangay merges into main".** Code owner review on `main` means every PR into `main` needs Sangay's approval. As an admin, Sangay can still merge PRs they opened themselves.

**Ruleset `develop`.** Settings → Rules → Rulesets also has a ruleset named `develop`. It targets only the `develop` branch and has "Repository admin" on its bypass list. Keep its target as `develop`; if it targets all branches again, nobody can push to their feature branches.

## 2. Release tags

Settings → Rules → Rulesets → **New ruleset → New tag ruleset**:

- Name: `release-tags`, Enforcement: **Active**
- Target tags: **Include by pattern** `v*`
- Rules: Restrict creations, Restrict updates, Restrict deletions
- Bypass list: **Repository admin**, Always allow

Only admins can then create `v0.1`, `v1.0` and so on, which is what starts a production deploy.

## 3. Environments

Settings → **Environments → New environment**.

| Environment | Deployment branches and tags | Required reviewers |
|---|---|---|
| `staging` | Selected branches: `develop` | None |
| `production` | Selected tags: `v*` | Sangay (`shoc05`), "Prevent self-review" off |

A job that says `environment: production` then stops and waits until Sangay clicks **Review deployments → Approve**.

## 4. Repository secrets

Settings → **Secrets and variables → Actions → New repository secret**. Never paste values into chat, code or prompts. The script can also load them: one-line secrets from `.secrets.env` (`NAME=value` per line) and files from `secrets/`; both are git-ignored.

| Secret | Used for | Where to get it | Status 13 Oct |
|---|---|---|---|
| `VPS_HOST` | Deploys and the restore drill | The VPS's address | Not set |
| `VPS_USER` | Deploys and the restore drill | The deploy user created by Ansible (step 3.3) | Not set |
| `VPS_SSH_KEY` | Deploys and the restore drill | A separate deploy key: `ssh-keygen -t ed25519 -f secrets/peerlytics_deploy`; the public half goes on the VPS | Not set |
| `OPENAI_API_KEY` | Backend analysis, main provider (step 2.4) | OpenAI dashboard; also set a monthly spending limit there | Not set |
| `HF_API_KEY` | Backup AI detection (current code) | Hugging Face → Settings → Access tokens | Not set |
| `VWT_API_KEY` | Backup grammar check (current code) | Virtual Writing Tutor account | Not set |
| `SMTP_USER` | Sender address for reminders | The Peerlytics mailbox | Not set |
| `SMTP_PASS` | SMTP login | A Gmail app password (16 characters), never the normal password | Not set |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Optional; defaults are `smtp.gmail.com`, `465` and `Peerlytics <SMTP_USER>` | Only if not using Gmail | Not set |
| `FIREBASE_SERVICE_ACCOUNT` | Backend, notifier and collab on the server (Admin SDK) | Firebase console → Project settings → Service accounts → Generate new private key; save as `secrets/firebase-service-account.json` | Not set |
| `SNYK_TOKEN` | Snyk scans (step 3.5) | Snyk → Account settings → Auth token | Not set |
| `GITLEAKS_LICENSE` | Gitleaks (step 3.5) | gitleaks.io, free | Not set |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | PostgreSQL on the server | Generated by the script; a copy is in `secrets/postgres_password.txt` | Set |

Use the names in this table. The team guide's Reference table says `HF_API_TOKEN` and `SMTP_PASSWORD`, but the code reads `HF_API_KEY` and `SMTP_PASS`. Its `FCM_SERVER_KEY` is not needed: Google retired those legacy keys, and push (step 3.8) authenticates with `FIREBASE_SERVICE_ACCOUNT`.

## 5. On a free private repository

The repo is **public** now, so everything above is enforced. GitHub Free does not enforce branch protection, rulesets or environment reviewers on **private** repositories. If the repo is ever made private again without a paid plan or the GitHub Student Developer Pack (which includes Pro):

| Setting that stops working | Do this instead |
|---|---|
| Branch protection and required checks | Team rule: nobody pushes to `develop` or `main`; every change is a PR, CI must be green, one teammate approves in the PR before it is merged. Sangay checks the merged PR list at each merge turn. |
| Code owner review on `main` | Only Sangay presses Merge on PRs into `main`. |
| Tag ruleset | Only Sangay creates `v*` tags; anyone else's tag is deleted and recreated by Sangay. |
| Production required reviewer | Keep the `v*` tag rule as the approval: production only deploys from a tag Sangay created. |
| Environments themselves | Still work (secrets per environment are fine); only the reviewer gate is lost. |

## 6. Check it worked

- Open any PR: the merge box lists the three required checks and "Review required".
- Try `git push origin develop` from a local commit: it is refused with "protected branch".
- Settings → Environments → `production` shows Sangay under required reviewers.
- `gh secret list` shows the secret names (never the values).
