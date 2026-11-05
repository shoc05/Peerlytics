# Release check

Checks of the live system and the repository, measured on 4-5 November 2026 against `v1.0.0` (commit `f6631f5`, or `fdac641` for repository checks).

NEEDS SANGAY means it can't be measured from the repository alone, or depends on a step only Sangay can do. It is not counted as a pass.

## Summary

| Result | Count |
|---|---|
| PASS | 11 |
| FAIL | 8 |
| NEEDS SANGAY | 7 |
| Total | 26 |

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `GET /api/auth/me` with no token | PASS | 401 on `http://staging.localhost` and `http://prod.localhost` (`curl`) |
| 2 | `GET /api/auth/me` with an invalid token | PASS | 401 on staging and production (`curl`) |
| 3 | `POST /api/admin/users/x/role` with no token | PASS | 401 on staging and production (`curl`) |
| 4 | A valid user with the wrong role gets 403 | PASS | Automated only: `backend/src/auth/routes.test.js` (`403 NO_ROLE`, `403 FORBIDDEN`). Not tried live, because that needs a real token |
| 5 | Rate limit on `/api/check` | PASS | 25 requests on staging: 20 answered 400, then 5 answered 429 |
| 6 | CORS does not trust other sites | PASS | With `Origin: https://evil.example`, the response still names only `https://shoc05.github.io` |
| 7 | No secret files tracked by git | PASS | `git ls-files` lists no `.env`, service account, `.pem` or `-key.json` file |
| 8 | ZAP baseline has no high or medium risks | PASS | Run [41861413147](https://github.com/shoc05/Peerlytics/actions/runs/41861413147). 1 low, 1 informational. Passive scan of `/api/health` on staging only |
| 9 | CI is green on the release commit | PASS | Run [41893984784](https://github.com/shoc05/Peerlytics/actions/runs/41893984784) on `f6631f5` |
| 10 | Staging deploy, smoke test and E2E | PASS | Run [41861413147](https://github.com/shoc05/Peerlytics/actions/runs/41861413147): 5 E2E passed, 1 skipped |
| 11 | Production deploy needs approval, then goes live | PASS | Run [41898272280](https://github.com/shoc05/Peerlytics/actions/runs/41898272280), [release v1.0.0](https://github.com/shoc05/Peerlytics/releases/tag/v1.0.0) |
| 12 | `/api/check` and `/api/analyze` require sign-in | FAIL | `backend/server.js` loads `backend/app.js`, which has no `requireAuth` on these routes. Live, a request with no token reaches body validation (400) instead of 401 |
| 13 | Security headers on the API | FAIL | Live response has no `Content-Security-Policy` or `X-Frame-Options`, and shows `X-Powered-By: Express`. `helmet` is only in `backend/src/app.js`, which `server.js` does not load |
| 14 | Security headers on the production website | FAIL | `https://peerlytics-4367c.web.app/` sends HSTS but no CSP or `X-Frame-Options`. `firebase.json` sets no headers |
| 15 | No high-severity issues in production dependencies | FAIL | `npm audit --omit=dev`: website 5 high, backend 8 high, collab 0 high |
| 16 | `main` and `develop` are protected branches | FAIL | GitHub API: "Branch not protected". Only the Push guard workflow and the local hook remain |
| 17 | Backups can be restored | FAIL | There is no `restore-drill.yml` or backup script in the repository |
| 18 | Secret scanning runs in CI | FAIL | There is no `security.yml`. Gitleaks was run by hand for this check. Snyk appears only as a pull request status check |
| 19 | A green commit can be released | FAIL | `v1.0.1` on `fdac641` stopped at "CI passed for this commit". CI did pass ([41906851953](https://github.com/shoc05/Peerlytics/actions/runs/41906851953)), but the query with `status=success` still returned 0 twelve hours later. Cause not known |
| 20 | Secrets in the full git history | NEEDS SANGAY | Gitleaks 8.28.0: 1 finding, a `gcp-api-key` in `src/firebase/firebase.js` at commit `fcb9b77` (2026-06-19). It is the `apiKey` of a Firebase web config and differs from the current key. Check whether that old project still exists, and restrict or delete the key |
| 21 | Load test during a one-at-a-time staging update | NEEDS SANGAY | `load/results/` is empty. Follow `docs/cd-evidence.md` section 1 |
| 22 | Blue/green switch with no failed requests | NEEDS SANGAY | Green has never run, so no switch has happened. Needs a second release, approved by Sangay, while k6 runs |
| 23 | Rollback drill | NEEDS SANGAY | `rollback.sh` needs green to have run. Same second release as check 22 |
| 24 | Sign-in and backend work from the production website | NEEDS SANGAY | The page loads (200), but nobody has confirmed a signed-in session. Sign in on the server PC and submit a test document |
| 25 | Admin screen opens for a superAdmin | NEEDS SANGAY | The role is set on the account, but Firebase showed no sign-in after that. Sign in with Google on that account and take a screenshot |
| 26 | Signed-in E2E test | NEEDS SANGAY | Skipped because `E2E_TOKEN` is not set |

## Suggested fixes for each FAIL

| # | Fix |
|---|---|
| 12, 13 | Decide which of the two apps is the real one. `backend/src/app.js` already has `helmet`, `requireAuth` and role checks, so the likely fix is to make `server.js` use it, then run the backend tests and redeploy. Check first that it keeps what `backend/app.js` adds (metrics, the health router with the database check). This is the most urgent fix: it stops anyone calling the paid analysis routes without signing in |
| 14 | Add a `headers` block to `firebase.json` with `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and a CSP that allows Firebase and the API |
| 15 | Run `npm audit` in each package. Update what has a safe fix, and record why the rest stay |
| 16 | `scripts/setup-github.sh` sets up the required checks. Run it, or set the rules by hand, on `main` and `develop`. The repository must stay public on a free plan |
| 17 | Add a scheduled `pg_dump` and a `restore-drill.yml` that restores it into a throwaway database and checks the row counts |
| 18 | Add a `security.yml` that runs Gitleaks on every pull request and uploads the report |
| 19 | In `cd-production.yml`, list the commit's CI runs without the `status` filter and check `conclusion == "success"` with `jq`. The unfiltered query did return the run |
