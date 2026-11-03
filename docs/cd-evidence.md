# CD evidence checklist (step 5.9)

A checklist to follow by hand. It collects the numbers and screenshots that show three things: staging updates with few or no failed requests, production switches blue/green without dropping requests, and a bad deploy rolls itself back. The pipeline is described in [deploy.md](deploy.md).

You run k6 from your PC. Tshewang merges, tags and approves. Everything the load test calls is read-only.

## 0. Before you start

- [ ] Install k6 (once): `winget install k6 --source winget`, then open a new terminal and check `k6 version`.
- [ ] Note the addresses:
  - staging API `https://<STAGING_DOMAIN>` (local server mode: `http://staging.localhost`)
  - production API `https://<PROD_DOMAIN>`
  - staging website `https://<owner>.github.io/<repo>/`
- [ ] The website build sets `VITE_APP_VERSION` to the commit (Tshewang, in `deploy-pages.yml` and `cd-production.yml`). Without it the footer says `Version dev` and screenshot 3.22 proves nothing.
- [ ] Dry run from the repo root, 30 seconds against staging, while nothing deploys:
  ```bash
  k6 run -e BASE_URL=https://<STAGING_DOMAIN> -e LABEL=dry-run -e DURATION=30s load/deploy-check.js
  ```
  You should see `no failed requests` and a new file in `load/results/`. If requests already fail here, fix that first, because every later number would be wrong.

What the test does: `GET /api/health` (expects 200) and `GET /api/auth/me` with no token (expects 401 from the auth middleware), each at `RATE` requests per second (default 5, so 10 in all) for `DURATION` (default 3m). Any other status, a timeout or a refused connection counts as a failed request. `first_failure_at` and `last_failure_at` in the JSON bracket the outage.

**Timing:** the deploy job starts several minutes after a merge, because CI and the image builds run first. Start k6 when the **deploy** job starts, not at the merge, or the 3 minutes may be over before anything restarts. If you can't watch, use `-e DURATION=15m` instead.

## 1. Staging: one-at-a-time update

- [ ] Ask Tshewang for a small, harmless change to merge into develop (for example a line in a doc). Any merge gives a new commit, so the footer version changes.
- [ ] **Screenshot 3.21:** in Actions, the CI run on develop finished ✅ and the **CD staging** run that started after it ("triggered via workflow_run"). Take it when both are visible in the list, or open the CD run so its trigger line shows.
- [ ] When the CD staging **Deploy** job starts:
  ```bash
  k6 run -e BASE_URL=https://<STAGING_DOMAIN> -e LABEL=staging-rolling load/deploy-check.js
  ```
- [ ] When the run is green, open the **Summary** of the CD staging run and note the tag, "went live" time and pipeline minutes.
- [ ] **Screenshot 3.22:** the staging website with the footer `Version <7-char SHA>` next to the commit in GitHub showing the same SHA. Reload with Ctrl+F5, because Pages caches for about 10 minutes.
- [ ] Record from the k6 output (also in `load/results/deploy-check-staging-rolling-*.json`): total requests, failed requests, failed %, p95 (ms), first and last failure time.

## 2. Production: blue/green switch (first release)

- [ ] Tshewang merges develop into main and pushes the tag (e.g. `v1.0.0`). CD production builds the images and then waits for approval.
- [ ] Just before the reviewer clicks **Approve and deploy**, start:
  ```bash
  k6 run -e BASE_URL=https://<PROD_DOMAIN> -e LABEL=prod-bluegreen -e DURATION=5m load/deploy-check.js
  ```
  The production deploy runs migrations, starts the idle colour, restarts it with jobs on and then switches Caddy, so 5 minutes leaves room. On the first release there is no live colour yet, so failed requests before the first switch are expected. Note that in the report.
- [ ] **Screenshot 3.10 (blue/green):** the CD production Summary with the live colour, and the deploy log lines where the new colour becomes healthy and Caddy is reloaded. If you can reach the server, also `docker ps --filter name=backend` showing both colours running.
- [ ] Record the same numbers as in section 1, for `prod-bluegreen`.
- [ ] Recommended: repeat with a second release (e.g. `v1.0.1`, LABEL `prod-bluegreen-2`). That one is a real switch from a live colour to the idle one, and is the fairer zero-downtime number.

## 3. Bad tag: automatic rollback

- [ ] Ask Tshewang to deploy a deliberately bad tag to staging, for example through **Actions → CD staging → Run workflow** with a tag whose backend can't become healthy. Agree on which tag before you start.
- [ ] Start k6 when its deploy job starts:
  ```bash
  k6 run -e BASE_URL=https://<STAGING_DOMAIN> -e LABEL=staging-rollback load/deploy-check.js
  ```
- [ ] **Screenshot 3.23:** the red CD staging run with **Rollback: yes** in its Summary, and the log line where `deploy.sh` deploys the last good tag again.
- [ ] Check that staging works afterwards: `curl https://<STAGING_DOMAIN>/api/health` returns `"ok":true`, and the footer still shows the previous good commit.
- [ ] Record the same numbers, for `staging-rollback`.

## 4. Into the report

Copy into report sections 3.5 and 3.6. The JSON files in `load/results/` are the source. Commit them with the report if you want them as evidence.

| Run | Label | Requests | Failed | Failed % | p95 (ms) | Failure window |
|---|---|---|---|---|---|---|
| Staging, one at a time | `staging-rolling` | | | | | |
| Production, blue/green (first release) | `prod-bluegreen` | | | | | |
| Production, blue/green (second release) | `prod-bluegreen-2` | | | | | |
| Staging, bad tag rolled back | `staging-rollback` | | | | | |

Also record, from the CD Summaries: pipeline minutes (CI start to live) for staging and production, time waiting for approval, the live colour after each release, and the rolled-back tag with the tag it returned to.

Screenshots: 3.21 (CD after CI), 3.22 (version line on staging), 3.23 (automatic rollback), 3.10 (blue/green).
