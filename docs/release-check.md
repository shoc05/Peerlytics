# Release check

Checks of the live system and the repository, first measured on 4-5 November 2026 against `v1.0.0`, and re-checked on 5 November against `v1.1.0`.

NEEDS SANGAY means it can't be measured from the repository alone, or depends on a step only Sangay can do. It is not counted as a pass.

## Summary

| Result | Count |
|---|---|
| PASS | 17 |
| FAIL | 5 |
| NEEDS SANGAY | 4 |
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
| 12 | `/api/check` and `/api/analyze` require sign-in | PASS | Fixed in #73, live in `v1.1.0`. With no token, production answers 401 on both |
| 13 | Security headers on the API | PASS | Fixed in #73, live in `v1.1.0`. Production sends `Content-Security-Policy` and `X-Frame-Options`, and no `X-Powered-By` |
| 14 | Security headers on the production website | FAIL | `https://peerlytics-4367c.web.app/` sends HSTS only. The headers are now in `firebase.json`, but stay unproven until the next release is checked |
| 15 | No high-severity issues in production dependencies | FAIL | `npm audit --omit=dev` after the safe fixes: website 4 high, backend 4 high, collab 0 high (was 5, 8, 0). All 8 come through the `firebase` package |
| 16 | `main` and `develop` are protected branches | FAIL | GitHub API: "Branch not protected". Only the Push guard workflow and the local hook remain |
| 17 | Backups can be restored | FAIL | There is no `restore-drill.yml` or backup script in the repository |
| 18 | Secret scanning runs in CI | PASS | `.github/workflows/security.yml` runs Gitleaks on every pull request and push. Locally it reports no leaks, with the one reviewed finding in `.gitleaks.toml` |
| 19 | A green commit can be released | FAIL | `v1.0.1` stopped at "CI passed for this commit" although CI had passed. `v1.1.0` went through on another commit. The check was changed in #78, which is unproven until a release uses it |
| 20 | Secrets in the full git history | NEEDS SANGAY | Gitleaks 8.28.0: 1 finding, a `gcp-api-key` in `src/firebase/firebase.js` at commit `fcb9b77` (2026-06-19). It is the `apiKey` of a Firebase web config and differs from the current key. Check whether that old project still exists, and restrict or delete the key |
| 21 | Load test during a one-at-a-time staging update | NEEDS SANGAY | `load/results/` is empty. Follow `docs/cd-evidence.md` section 1 |
| 22 | Blue/green switch with no failed requests | PASS | [`v1.1.0`](https://github.com/shoc05/Peerlytics/actions/runs/42068945037), blue to green under k6: 3,601 requests, 0 failed, p95 6.4 ms. `load/results/deploy-check-prod-bluegreen-v1.1.0-*.json` |
| 23 | Rollback drill | PASS | `rollback.sh prod` on 5 November: to `v1.0.0` in 63 s, then forward to `v1.1.0` in 16 s, under k6: 1,202 requests, 0 failed, p95 7.7 ms. `load/results/deploy-check-prod-rollback-drill-*.json` |
| 24 | Sign-in and backend work from the production website | NEEDS SANGAY | The page loads (200), but nobody has confirmed a signed-in session. Sign in on the server PC and submit a test document |
| 25 | Admin screen opens for a superAdmin | PASS | Sangay's screenshot on 5 November 2026: `peerlytics-4367c.web.app/dashboard` shows Admin · Grading Oversight with no error. A superAdmin gets only this read-only page; there is no licence or subscription screen |
| 26 | Signed-in E2E test | NEEDS SANGAY | Skipped because `E2E_TOKEN` is not set |

## Suggested fixes for each FAIL

| # | Fix |
|---|---|
| 14 | After the next release, check the headers with `curl -I`, and confirm Google sign-in still works. If sign-in breaks, remove the `X-Frame-Options` rule from `firebase.json` |
| 15 | Update `firebase` to the current major version in a separate PR and retest sign-in and Firestore. `npm audit` only offers a downgrade, so it can't do this |
| 16 | Branch protection needs a decision: required reviews could block a one-person merge. `scripts/setup-github.sh` sets it up |
| 17 | Add a scheduled `pg_dump` and a `restore-drill.yml` that restores it into a throwaway database and checks the row counts |
| 19 | Tag the next release. It tests the new check for real |
