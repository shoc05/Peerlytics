# Report evidence (CTE412 mini-project)

Measured on 5 November 2026 from this repository, `gh`, test runs and the live system. Times in run data are UTC.

- **NEEDS SANGAY:** only Sangay can supply it.
- **not measured:** nothing in the system records it yet. The row says how to get it.

## A. Numbers for the report's blanks

| Report section | Blank | Value | Source | How measured |
|---|---|---|---|---|
| 3.2 CI | Lint result | Website: 0 errors, 13 warnings. Backend and collab: 0 errors, 0 warnings | `npm run lint` in each package; [CI run 41906851953](https://github.com/shoc05/Peerlytics/actions/runs/41906851953) | Run locally and read from CI |
| 3.2 CI | Unit-test coverage, website | 95.73% lines, 89.48% branches, 93.54% functions (117 tests) | `node --test --experimental-test-coverage` | Local run. Counts only files the tests load, so untested files such as `peerlytics-app.jsx` are left out. Say this if you quote it |
| 3.2 CI | Unit-test coverage, backend | 92.95% lines, 84.90% branches, 90.23% functions (121 tests) | Same | Same caveat |
| 3.2 CI | Unit-test coverage, collab | 99.13% lines, 94.27% branches, 97.94% functions (19 tests) | Same | Same caveat |
| 3.2 CI | Unit-test coverage, notifier | not measured: `notifier/` does not exist | Repository | |
| 3.2 CI | Integration tests (real PostgreSQL) | 30 | Job "backend db (migrations, docker)", CI run 41906851953 | `# tests 30` in the log. Another 7 run on the Firebase emulators (5 auth, 2 deadlines) |
| 3.2 CI | Firestore rules tests | 31 | Job "Firestore rules tests", same run | `# tests 31` in the log |
| 3.2 CI | Playwright scenarios | 6 (5 pass, 1 skipped without `E2E_TOKEN`) | `e2e/staging/smoke.spec.js`; [run 41861413147](https://github.com/shoc05/Peerlytics/actions/runs/41861413147) | Test log |
| 3.2 CI | Image build result | Passed: backend and collab, `linux/amd64` | Run 41861413147, jobs "Build images" | Job conclusions |
| 3.2 CI | Total CI runs | 104 (70 passed, 29 failed, 5 cancelled), 2026-10-09 to 2026-11-04 | `gh run list --workflow ci.yml --limit 1000 --json ...` | Counted |
| 3.2 CI | Pass rate | 70.7% of finished runs (70 of 99); 67.3% of all 104 | Same | Cancelled runs left out of the first figure |
| 3.2 CI | Average and median duration | 1.23 and 1.23 minutes (99 finished runs) | Same | `updatedAt - startedAt` |
| 3.2 CI | Red runs later fixed on the same branch | 13 of 29 | Same | A later green run on that branch. The other 16 had no later green run there, including Snyk and superseded branches |
| 3.5 Delivery | k6 virtual users | not measured | `load/results/` is empty | Follow `docs/cd-evidence.md` |
| 3.5 Delivery | Failed requests, one-at-a-time update | not measured | Same | `docs/cd-evidence.md` section 1 |
| 3.5 Delivery | Failed requests, blue/green switch | not measured | Same | Needs a second release; `docs/cd-evidence.md` section 2 |
| 3.5 Delivery | p95 response time | not measured | Same | In the k6 output |
| 3.5 Delivery | Seconds until the alert fired | not measured | Rules exist (`infra/k8s/monitoring/alert-rules.yaml`), but no firing was recorded | Stop a service with monitoring running and time the alert |
| 3.5 Delivery | Restore-drill duration | not measured: `restore-drill.yml` does not exist | Repository; `docs/release-check.md` check 17 | Build the drill first |
| 3.6 CD | Staging deploys | 2 succeeded ([41819199852](https://github.com/shoc05/Peerlytics/actions/runs/41819199852), [41861413147](https://github.com/shoc05/Peerlytics/actions/runs/41861413147)), plus 1 skipped run | `gh api` workflow runs, deploy job | GitHub lists 3 CD staging runs. In the first, the deploy passed but the E2E job failed |
| 3.6 CD | Production deploys | 1 succeeded ([v1.0.0](https://github.com/shoc05/Peerlytics/actions/runs/41898272280), on its second attempt); `v1.0.1` never deployed | `gh run list --workflow cd-production.yml` | Attempt 1 of `v1.0.0` deployed the backend but failed at Firebase Hosting (missing permission) |
| 3.6 CD | Average minutes from CI end to deploy success | 2.99 minutes (n = 2, staging: 3 min 41 s and 2 min 18 s) | CI end time and deploy job `completed_at` | From merge: 4 min 50 s and 3 min 31 s. Small sample |
| 3.6 CD | Automatic rollbacks | 0 | Deploy logs of all 3 deploys: `result=ok` | Searched for the result lines |
| 3.6 CD | First production release | `v1.0.0`, 4 November 2026 (20:06 UTC; 5 November, 02:06 in Bhutan) | [Release page](https://github.com/shoc05/Peerlytics/releases/tag/v1.0.0) | `gh release list` |
| 3.6 CD | Image sizes | Backend 574 MB, collab 361 MB | `docker images` on the server | Docker Desktop's reported size. The images also use `postgres:16-alpine` (420 MB) and `caddy:2.11.7-alpine` (93.1 MB) |
| 3.7 Security | Gitleaks findings | 1 (old Firebase web `apiKey`, `src/firebase/firebase.js`, commit `fcb9b77`) | Gitleaks 8.28.0 on a mirror clone of all branches | Run by hand. No CI job exists |
| 3.7 Security | Snyk issues found and fixed | 3 Snyk pull requests merged (#23, #32, #33). Exact issue count: not measured | `gh pr list`. `security.yml` does not exist, so there are no artifacts | #32's title says 2 vulnerabilities. The Snyk dashboard has the rest |
| 3.7 Security | Open dependency issues | Website 5 high, 31 moderate. Backend 8 high, 8 moderate. Collab 6 moderate | `npm audit --omit=dev` | Run locally |
| 3.7 Security | ZAP warnings | High 0, medium 0, low 1, informational 1 | `zap-baseline-staging` artifact, run 41861413147 | Low: `X-Powered-By`. Informational: "Storable and Cacheable Content". Passive scan of `/api/health` only |
| 3.7 Security | What was fixed | Not yet: these checks were new, and every FAIL is still open | `docs/release-check.md` | |
| 3.9 Acceptance | Release check counts | 12 PASS, 8 FAIL, 6 NEEDS SANGAY (26 checks) | `docs/release-check.md` | Counted |
| 3.9 Acceptance | Acceptance test results | not measured: `docs/acceptance-test.md` does not exist | Repository | |
| Abstract, conclusion | Production release | `v1.0.0`, 4 November 2026 | As above | |
| Abstract, conclusion | Checks passed out of total | 12 of 26 | `docs/release-check.md` | 6 are not yet decided |
| Abstract, conclusion | Features cut | 4 of 7 advanced features have a flag that no code reads: push, CSV invite, .docx, licensing | `git grep` for each flag name in `src`, `backend`, `collab` | Yjs, offline and document tabs do read their flags. Searched in code only, not run with the flags on. Peer evaluation, course dashboard, Dzongkha and `ai_provider` also have unread flags |
| Leave for Sangay | Jira items completed out of 66, and carried over | NEEDS SANGAY | Jira | |
| Leave for Sangay | Burndown charts | NEEDS SANGAY | Jira | |
| Leave for Sangay | Student IDs | NEEDS SANGAY | | |

## B. Text to paste in

### 2.4 and 3.6 Hosting

The original plan was to host the system on an Oracle Cloud ARM virtual machine, and the deployment files were later prepared for a Microsoft Azure Ubuntu x64 virtual machine. Neither was used: the team had no Oracle virtual machine and no access to an Azure for Students subscription. The system therefore runs on a Windows 11 personal computer, using Ubuntu on the Windows Subsystem for Linux (WSL2), Docker Desktop and a GitHub Actions self-hosted runner, selected by the setting `DEPLOY_MODE=local`. Images are built for `linux/amd64` through the `IMAGE_PLATFORM` setting, and the same Compose and Caddy files are used. The Ansible files for a cloud server remain in the repository but were not used for this deployment.

### 3.6 CD pipeline

One real staging deploy and one production release are described below.

Staging ([run 41861413147](https://github.com/shoc05/Peerlytics/actions/runs/41861413147)):

1. Pull request #68 was merged into `develop` at 15:46:20 UTC.
2. `ci.yml` ran the lint, test and build jobs and finished at 15:47:33 UTC.
3. CI's success started `cd-staging.yml` and `deploy-pages.yml` through the `workflow_run` trigger.
4. The backend and collab images were built for `linux/amd64` and pushed to the GitHub Container Registry (GHCR) as `sha-3483faf`.
5. The deploy job ran on the self-hosted runner, not over SSH as in the cloud design. `deploy.sh staging` pulled the images and started the containers.
6. The script's health checks and a smoke test of `/api/health` passed, and the job finished at 15:49:51 UTC, 2 minutes 18 seconds after CI ended.
7. The OWASP ZAP baseline scan found no high or medium risks.
8. The Playwright tests passed against the staging site (5 passed, 1 skipped).
9. GitHub Pages served the staging website built from the same commit.

Production ([run 41898272280](https://github.com/shoc05/Peerlytics/actions/runs/41898272280)):

1. The tag `v1.0.0` was pushed on `main`.
2. The workflow confirmed that CI had passed for that commit and built the images.
3. The `production` environment held the deploy until a reviewer approved it.
4. The backend was deployed to the blue colour, as the first release, and Caddy sent traffic to it.
5. The website was deployed to Firebase Hosting, and the GitHub release was published.

The first attempt failed at step 5 because the deploy account lacked the `serviceusage.services.get` permission. The role was added, and the second attempt succeeded.

### 3.5 and 3.6 Rollback evidence

No rollback has happened in a real run. All three deploys recorded `result=ok`. The automatic rollback in `deploy.sh` and the one-command `rollback.sh` are covered by the deploy script tests in the "CD checks" workflow, but they have not been exercised on the live server. A rollback drill needs a second production release. NEEDS SANGAY: add the run link here once the drill is done.

### 3.7 Security

A release check was carried out against the staging and production services. Requests without a valid token to protected account routes were refused with status 401, and automated tests confirm status 403 for a user with the wrong role. The rate limit on the analysis route returned status 429 after 20 requests in a minute. A Gitleaks scan of the full history found one item, the API key of an earlier Firebase web configuration. No private keys or environment files are tracked. The check also found weaknesses that remain open. The running backend loads a version of the application without the `helmet` security headers and without an authentication check on the two analysis routes, although a protected version exists in the code. The production website sends few security headers, and `npm audit` reports 13 high-severity issues in production dependencies. These findings were not fixed at the time of writing.

### 3.9 Release check

`docs/release-check.md` lists 26 checks covering authentication, authorisation, rate limiting, cross-origin rules, security headers, secrets, dependency issues, the delivery pipeline and recovery. Of these, 12 passed, 8 failed and 6 need a further manual step. Each failure has a suggested fix in that document. `docs/acceptance-test.md` was not produced.

### 3.10 Limitations (new points)

The hosting brief for this section assumed Azure credit and a single Azure virtual machine. Those do not apply, so the following points replace them.

- The backend runs on one personal computer. It is available only while that computer and Docker Desktop are running, and the address `prod.localhost` resolves only on that computer. Other users of the public website cannot reach the backend, so this is a demonstration deployment and not a public service.
- There is one machine and no high availability. The blue/green switch protects against a bad release, not against the computer failing.
- A deploy needs the self-hosted runner to be running on that computer.
- On a free GitHub plan, the approval step and the staging website only work while the repository is public. Both stopped when it was briefly made private.
- Licences would be set by hand, and there are no payments. Licensing is not implemented beyond a table and a flag.
- Still open: all 8 failed checks in `docs/release-check.md`, most importantly the unauthenticated analysis routes.

### 3.4 or 3.11 College licensing and usage

The database has a `licences` table recording a college's plan (`trial` or `standard`), number of seats, monthly AI budget and start and end dates, and a `licensing_enabled` feature flag exists, off by default. No application code reads this flag, and there are no routes, administration screen or payments for licences. Seat and budget limits are therefore not enforced, and a licence could only be entered directly in the database. This part of the design was not completed.

### 3.6 Maintainability

Before release, code that was no longer part of the application was removed. This demonstrates managing configuration and dependencies (Unit IV, 4.3).

| Measure | Before | After |
|---|---|---|
| Tracked files | 289 | 277 |
| Lines of code (cloc, without JSON) | 29,750 | 26,465 |
| Website build (`dist/`) | 2,688,107 bytes, 19 files | 2,688,107 bytes, 19 files |
| Dependencies | | 0 removed (`depcheck` reported none unused) |
| README files added | | 0; `README.md` was rewritten where out of date, and `archive/README.md` was removed |

Removed: the `archive/` folder (the old prototype, its setup guide, a Firebase console snippet and an unused hook) and six one-off scripts (`fix-peerlytics.cjs`, `migrate-dashboard-auth.cjs`, `migrate-workspace-firebase.cjs`, `patch-analytics.js`, `patch-analytics2.cjs`, `patch-workspace.js`). The build size did not change, which confirms that the application used none of these files. They stay available in git history.

### References (APA 7)

Azure is left out because it was not used. WSL, self-hosted runners, Firebase Hosting and GitHub Pages are added because they were. The k6 address could not be opened from the test network on 5 November 2026, so check it before submitting. `n.d.` means no date is given.

| In-text citation | Reference |
|---|---|
| (Docker, n.d.) | Docker. (n.d.). *Docker Compose*. Docker Docs. https://docs.docker.com/compose/ |
| (Caddy, n.d.) | Caddy. (n.d.). *Caddy documentation*. https://caddyserver.com/docs/ |
| (GitHub, n.d.-a) | GitHub. (n.d.-a). *Events that trigger workflows*. GitHub Docs. https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows |
| (GitHub, n.d.-b) | GitHub. (n.d.-b). *Managing environments for deployment*. GitHub Docs. https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments |
| (GitHub, n.d.-c) | GitHub. (n.d.-c). *Self-hosted runners*. GitHub Docs. https://docs.github.com/en/actions/concepts/runners/self-hosted-runners |
| (GitHub, n.d.-d) | GitHub. (n.d.-d). *GitHub Pages documentation*. GitHub Docs. https://docs.github.com/en/pages |
| (Microsoft, n.d.) | Microsoft. (n.d.). *What is Windows Subsystem for Linux?* Microsoft Learn. https://learn.microsoft.com/en-us/windows/wsl/about |
| (Google, n.d.) | Google. (n.d.). *Firebase Hosting*. Firebase Documentation. https://firebase.google.com/docs/hosting |
| (Microsoft Playwright, n.d.) | Microsoft. (n.d.). *Installation*. Playwright. https://playwright.dev/docs/intro |
| (Grafana Labs, n.d.) | Grafana Labs. (n.d.). *Grafana k6*. Grafana Documentation. https://grafana.com/docs/k6/latest/ |
| (Gitleaks, n.d.) | Gitleaks. (n.d.). *Gitleaks* [Computer software]. GitHub. https://github.com/gitleaks/gitleaks |
| (Snyk, n.d.) | Snyk. (n.d.). *Snyk user docs*. https://docs.snyk.io/ |
| (ZAP, n.d.) | ZAP. (n.d.). *ZAP - Baseline scan*. https://www.zaproxy.org/docs/docker/baseline-scan/ |

## C. Screenshot list

`docs/screenshots/` does not exist, so nothing has been captured yet. The repository only says what 3.10, 3.13 and 3.21 to 3.23 show. For the others, the suggestion below is inferred from the section, so check it against your report's caption.

| Placeholder | What to capture | Where | Exists? |
|---|---|---|---|
| 2.3 | NEEDS SANGAY: caption not in repo | | No |
| 2.4 | Hosting diagram or Docker Desktop with the containers running | Docker Desktop | No |
| 3.4 to 3.9 | NEEDS SANGAY: captions not in repo. Likely the app's course, workspace and analytics screens | `https://peerlytics-4367c.web.app` | No |
| 3.10 | Blue/green: the Summary with the live colour, and the log lines where the new colour becomes healthy and Caddy reloads | CD production run, second release | No, needs the second release |
| 3.11, 3.12 | NEEDS SANGAY: captions not in repo | | No |
| 3.13 | CD pipeline figure | `docs/diagrams/cd-pipeline.md` rendered on GitHub | Diagram exists; no image |
| 3.14 to 3.20 | NEEDS SANGAY: captions not in repo | | No |
| 3.21 | CD after CI: the run's job graph | [Run 41861413147](https://github.com/shoc05/Peerlytics/actions/runs/41861413147) | No |
| 3.22 | Version line on staging | `https://shoc05.github.io/Peerlytics/` | No |
| 3.23 | Automatic rollback | Needs the bad-tag test in `docs/cd-evidence.md` section 3 | No, has not happened |
| Optional | README rendered on GitHub | `https://github.com/shoc05/Peerlytics` | No |
| Optional | Release-check table | `docs/release-check.md` on GitHub | No |
| Optional | k6 summary | Terminal, or `load/results/` | No, not run |
| Not applicable | Azure VM overview and cost analysis | No Azure VM was used | |

## D. LO coverage check

The wording of LO1 to LO8 is not in the repository, so the LO column is NEEDS SANGAY. Match each row to your module's outcomes. The evidence is real.

| LO | Topic | Evidence | Report section | Strength |
|---|---|---|---|---|
| NEEDS SANGAY | Continuous integration | `.github/workflows/ci.yml`, [run 41906851953](https://github.com/shoc05/Peerlytics/actions/runs/41906851953) | 3.2 | Strong |
| NEEDS SANGAY | Continuous delivery and deployment | `cd-staging.yml`, `cd-production.yml`, `docs/deploy.md`, runs 41861413147 and 41898272280 | 3.6 | Strong |
| NEEDS SANGAY | Containers and infrastructure | `backend/Dockerfile`, `collab/Dockerfile`, `infra/`, `infra/ansible/` (written, not run in this deployment) | 2.4, 3.6 | Medium |
| NEEDS SANGAY | Automated testing | 117, 121 and 19 unit tests, 30 PostgreSQL tests, 31 rules tests, `e2e/staging/smoke.spec.js` | 3.2 | Strong |
| NEEDS SANGAY | Security | `firestore.rules`, `docs/release-check.md`, ZAP artifact | 3.7 | **Weak:** 5 security FAILs are open (checks 12 to 15 and 18) |
| NEEDS SANGAY | Monitoring and reliability | `infra/k8s/monitoring/`, `load/deploy-check.js` | 3.5 | **Weak:** no k6 results, no alert timing, no restore drill or rollback drill |
| NEEDS SANGAY | Configuration and dependency management | `.env.example`, `docs/feature-flags.md`, the cleanup in 3.6 | 3.6 | Medium |
| NEEDS SANGAY | Team process | `jira-import.csv`, `.github/workflows/jira-check.yml`, pull request history | Jira charts | Medium: charts are NEEDS SANGAY |

## Blanks still marked NEEDS SANGAY

- Jira items completed out of 66, and carried over
- Burndown charts
- Student IDs
- LO1 to LO8 wording and mapping
- Screenshot captions for 2.3, 3.4 to 3.9, 3.11, 3.12 and 3.14 to 3.20
- All screenshots
- Rollback run link (needs the second release)
- Release checks 20 to 24 and 26 in `docs/release-check.md`
