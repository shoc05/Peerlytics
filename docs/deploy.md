# Deploying Peerlytics

Steps 1.9 (staging) and 5.1 (production). Pipeline diagram: [diagrams/cd-pipeline.md](diagrams/cd-pipeline.md).

Everything runs on one Ubuntu server with Docker and Compose. Two kinds of server work:

- **Your own PC** (`DEPLOY_MODE=local`): WSL2 Ubuntu with Docker Desktop, and a GitHub self-hosted runner in it that runs the deploy jobs. Free, but the API only answers on that PC, at `http://staging.localhost` and `http://prod.localhost`. See [Your PC as the server](#your-pc-as-the-server) and skip sections 1 and the `SSH_*` secrets.
- **A cloud VM** (`DEPLOY_MODE` unset or `ssh`): for example an Azure Ubuntu x64 VM. GitHub's runners reach it over SSH, and it serves HTTPS on two DuckDNS names. An ARM VM such as Oracle Cloud's Always Free one works as well: set the repository variable `IMAGE_PLATFORM` to `linux/arm64` and open 80 and 443 in its subnet's security list instead of an NSG.

| What | Where |
|---|---|
| Staging API and live editing | `https://<STAGING_DOMAIN>/api`, `wss://<STAGING_DOMAIN>/collab` |
| Production API and live editing | `https://<PROD_DOMAIN>/api`, `wss://<PROD_DOMAIN>/collab` |
| Staging website | GitHub Pages, `https://<owner>.github.io/<repo>/` |
| Production website | The existing Firebase Hosting live site |

One Caddy container (compose project `edge`) owns ports 80 and 443. It gets the HTTPS certificates for both domains by itself and forwards `/api` to the backend and `/collab` to the collab server. Staging and production are two separate compose projects, `peerlytics-staging` and `peerlytics-prod`. Each one has its own env file, its own PostgreSQL volume and its own private network. No app container publishes a port.

## Your PC as the server

The deploy jobs run on your PC instead of on GitHub. The images are still built by GitHub (amd64) and pulled from GHCR. Nothing is opened to the internet.

| | Cloud VM | Your PC |
|---|---|---|
| Who runs the deploy job | GitHub runner, over SSH | Self-hosted runner in WSL2 |
| API addresses | `https://<STAGING_DOMAIN>`, `https://<PROD_DOMAIN>` | `http://staging.localhost`, `http://prod.localhost` |
| Certificates | Caddy gets them | None (plain HTTP) |
| Who can use the deployed API | Anyone | Only this PC, while Docker and the runner run |

1. **WSL2 and Docker.** In an admin PowerShell: `wsl --install -d Ubuntu`, then restart. In Docker Desktop, open **Settings → Resources → WSL integration**, turn on **Ubuntu**, and click **Apply & restart**. In Ubuntu, `docker version` must show a Server part.
2. **Server folders and files.** In Ubuntu, from a clone of the repo:
   ```bash
   bash infra/scripts/setup-local-server.sh <github-owner> <your email>
   ```
   It creates `/opt/peerlytics` (owned by you), the `edge` network, `edge.env` with the two localhost names, and `.env.staging`/`.env.prod` with a random database password. Existing files are kept. Then paste the Firebase service-account JSON into `FIREBASE_SERVICE_ACCOUNT` in both env files (on one line, in single quotes), and add the API keys you have.
3. **The runner.** On GitHub: **Settings → Actions → Runners → New self-hosted runner → Linux x64**. Run its *Download* and *Configure* commands in Ubuntu, in `~/actions-runner`. When `config.sh` asks for labels, enter `peerlytics-server`. Start it with `./run.sh` and keep that window open whenever a deploy should run. A queued deploy waits until the runner is back.
4. **Keep fork PRs off your PC.** A self-hosted runner on a public repository can be targeted by a pull request from a fork that edits a workflow. In **Settings → Actions → General → Fork pull request workflows**, choose **Require approval for all external contributors**, and only approve PRs whose workflow changes you have read. Only the deploy jobs ask for the `peerlytics-server` label.
5. **GitHub settings** as in section 3, with these differences:
   - Repository variable `DEPLOY_MODE` = `local`.
   - `STAGING_DOMAIN` = `staging.localhost`, `PROD_DOMAIN` = `prod.localhost` (no `http://`).
   - `VITE_API_URL_STAGING` = `http://staging.localhost`, `VITE_COLLAB_URL_STAGING` = `ws://staging.localhost/collab`; `VITE_API_URL_PROD` = `http://prod.localhost`, `VITE_COLLAB_URL_PROD` = `ws://prod.localhost/collab`.
   - No `SSH_*` secrets.

The websites are still on GitHub Pages and Firebase Hosting. They call the API on `*.localhost`, which browsers send to your own PC and allow from an HTTPS page. Chrome may ask once whether the site may reach devices on your local network; allow it. Rollbacks run in Ubuntu: `bash /opt/peerlytics/infra/scripts/rollback.sh prod`.

To show the staging API to someone else for a while, a Cloudflare quick tunnel needs no account: `cloudflared tunnel --url http://localhost:80 --http-host-header staging.localhost` prints a temporary `https://….trycloudflare.com` address. The website build has the API address baked in, so the website itself still calls `staging.localhost`.

## 1. Set up the server

1. Create the VM: Ubuntu Server 24.04 LTS x64, size B2s (2 vCPU, 4 GB; staging and production together need about 2.5 GB), SSH key login, admin user `azureuser`. In its **network security group**, allow inbound TCP 22, 80 and 443 from any source. GitHub's runners have no fixed address, and only keys can log in. Make the public IP **static** so it survives a stop and start. Stopping (deallocating) the VM when nobody needs it saves most of the credit.
2. Point both DuckDNS names at the VM's public IP.
3. From a Linux, macOS or WSL machine, run the playbook. It sets up Docker, the `deploy` user, iptables for 80 and 443, the folders and the `edge` network (details in [infra/ansible/README.md](../infra/ansible/README.md)):
   ```bash
   cd infra/ansible
   ansible-galaxy collection install -r requirements.yml -p collections
   cp inventory.example.ini inventory.ini        # add: vps1 ansible_host=<server IP>
   ansible-playbook site.yml -u azureuser -e deploy_ssh_public_key_file=~/.ssh/id_ed25519.pub
   ```
4. Make a separate key pair for GitHub Actions, and add its public key to `/home/deploy/.ssh/authorized_keys`. The playbook's `users` role keeps only the keys it knows about, so either pass this key as `deploy_ssh_public_key_file` or add it after every playbook run.
5. Write the env files below as `deploy`, with `chmod 600`.

## 2. Files on the server

Everything lives in `/opt/peerlytics`, owned by `deploy`. Names only; the values never go into git.

| File | Written by | Contents |
|---|---|---|
| `edge.env` | you | `STAGING_DOMAIN`, `PROD_DOMAIN`, `ACME_EMAIL` |
| `.env.staging`, `.env.prod` | you | `POSTGRES_PASSWORD` (letters and digits only), optional `POSTGRES_DB`/`POSTGRES_USER`; `CORS_ORIGIN` (staging: `https://<owner>.github.io`, prod: the Firebase site's origin); `FIREBASE_SERVICE_ACCOUNT` (the JSON on one line, in single quotes); `HF_API_KEY`, `HF_AI_MODEL`, `VWT_API_KEY`; `SMTP_*`, `REMINDER_*`; `DEADLINE_TIMEZONE`; `METRICS_TOKEN`; optional `NOTIFIER_ENABLED=true` |
| `infra/` | each deploy | Copy of the repo's `infra/compose`, `infra/edge` and `infra/scripts` from the commit being deployed |
| `edge/upstreams/prod-backend.caddy` | deploy.sh, rollback.sh | The `reverse_proxy` line for production's live backend colour |
| `.active_color-prod`, `.color_tag-prod-blue`, `.color_tag-prod-green` | deploy.sh, rollback.sh | Which colour is live, and the tag each colour runs |
| `.image_prefix-staging`, `.image_prefix-prod` | deploy.sh | The registry prefix, for rollback.sh |
| `.last_good_tag-staging`, `.last_good_tag-prod` | deploy.sh | Last tag that deployed healthy |
| `.deploy.lock` | deploy.sh | Makes sure only one deploy runs at a time |

`.env.example` in the repo lists every variable with a comment. The collab server won't start without `FIREBASE_SERVICE_ACCOUNT`, and the deploy then fails its health check.

## 3. GitHub settings

**Settings → Pages:** set Source to **GitHub Actions**.

**Environment `staging`** (Settings → Environments):

| Kind | Name | Value |
|---|---|---|
| Secret | `SSH_HOST` | The server's IP or name |
| Secret | `SSH_USER` | `deploy` |
| Secret | `SSH_PRIVATE_KEY` | The Actions private key from step 1.4 |
| Secret | `SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 <server>`. Check its fingerprint against the server's own `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` |
| Variable | `STAGING_DOMAIN` | e.g. `peerlytics-staging.duckdns.org` |

**Environment `production`:** the same four `SSH_*` secrets (same server), and:

| Kind | Name | Value |
|---|---|---|
| Secret | `FIREBASE_SERVICE_ACCOUNT_PEERLYTICS_4367C` | JSON key of a service account with the **Firebase Hosting Admin** role in `peerlytics-4367c` (`firebase init hosting:github` creates one under this name) |
| Variable | `PROD_DOMAIN` | e.g. `peerlytics.duckdns.org` |
| Variable | `VITE_API_URL_PROD` | `https://<PROD_DOMAIN>` |
| Variable | `VITE_COLLAB_URL_PROD` | `wss://<PROD_DOMAIN>/collab` (empty keeps live editing off) |

The production environment already has **required reviewers**, so a release waits for one of them to approve it. Public repositories get environment protection on every plan, so no extra approval gate is needed. Also set **Deployment branches and tags** to the tag pattern `v*.*.*`, so only version tags can use the environment's secrets.

**Repository variables** (the staging website build isn't in an environment; the production build reads the Firebase ones too):

| Name | Value |
|---|---|
| `VITE_API_URL_STAGING` | `https://<STAGING_DOMAIN>` |
| `VITE_COLLAB_URL_STAGING` | `wss://<STAGING_DOMAIN>/collab` (empty keeps live editing off) |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | The Firebase web config. It ships in every page, so it isn't a secret |
| `DEPLOY_MODE` | Optional. `ssh` (default, a cloud VM) or `local` (your PC with a self-hosted runner, see above) |
| `IMAGE_PLATFORM` | Optional. `linux/amd64` (default, the Azure VM) or `linux/arm64` (an ARM server). Must match the server's CPU |

`GITHUB_TOKEN` pushes and pulls the images. You don't need a registry password. On the server it's piped into `docker login --password-stdin`, and the server is logged out again at the end of the job.

## 4. Firebase authorized domains

In the Firebase console, open **Authentication → Settings → Authorized domains** and add `<owner>.github.io`. Without it, sign-in on the staging website fails with `auth/unauthorized-domain`. The production site (`peerlytics-4367c.web.app` and `.firebaseapp.com`) is on the list by default. Add any custom domain you put in front of it.

In `.env.prod`, `CORS_ORIGIN` must be the production site's origin, e.g. `https://peerlytics-4367c.web.app`.

## 5. How a staging deploy runs

1. A PR is merged into develop, and **CI** runs on the push.
2. When CI succeeds, two workflows start:
   - **CD staging** (`cd-staging.yml`) checks out exactly that commit and builds the images for `IMAGE_PLATFORM` (default linux/amd64) through `build-images.yml`. They are tagged `sha-<7 chars>` and pushed to `ghcr.io/<owner>/peerlytics-<service>`. The deploy job (environment `staging`, one at a time) copies `infra/` to the server, logs the server in to GHCR and runs `infra/scripts/deploy.sh staging sha-<7>`.
   - **Deploy staging website** (`deploy-pages.yml`) builds the site with `VITE_API_URL_STAGING` and base `/<repo>/`, copies `index.html` to `404.html` and publishes it to Pages.
3. `deploy.sh`:
   1. starts Caddy and the `edge` network if they aren't running, checks the Caddyfile and reloads it;
   2. pulls the images and runs `npm run migrate:up` in the new backend image (if it has that script);
   3. updates backend, then collab, then notifier (if `NOTIFIER_ENABLED=true`). Each must be healthy before the next one starts;
   4. on success, saves the tag in `.last_good_tag-staging` and removes unused images older than a week;
   5. on any failure, deploys the last good tag again and exits 1, so the workflow goes red.
4. The workflow checks `https://<STAGING_DOMAIN>/api/health` and writes a summary: tag, commit, URL, time and minutes since the merge.

There's no OWASP ZAP job in the repo yet. When one exists, its baseline scan goes after the smoke test.

**Important:** GitHub only runs `workflow_run` workflows from the **default branch** (main). CD staging and the Pages deploy start firing once these files have reached main.

## 6. Roll back staging

- **From GitHub:** Actions → CD staging → Run workflow, and enter an earlier tag (e.g. `sha-1a2b3c4`; the tags are listed under the repo's Packages). It skips the build and deploys that tag.
- **On the server:**
  ```bash
  docker login ghcr.io -u <you>     # a personal token with read:packages, if the image isn't on the server
  IMAGE_PREFIX=ghcr.io/<owner>/peerlytics /opt/peerlytics/infra/scripts/deploy.sh staging sha-1a2b3c4
  ```

Migrations only go forward. A rollback runs the older code against the newer schema, so keep migrations backwards-compatible (add columns; drop them in a later release).

## 7. Release to production

1. Merge develop into main through a PR. CI runs on the push to main.
2. Tag the merge commit and push the tag:
   ```bash
   git checkout main && git pull
   git tag v1.2.0 && git push origin v1.2.0
   ```
3. **CD production** (`cd-production.yml`):
   1. `verify-ci` asks the GitHub API for a successful CI run on the tagged commit, and stops if there isn't one;
   2. builds the images tagged `v1.2.0`;
   3. waits for a reviewer to approve the `production` deployment (Actions → the run → Review deployments);
   4. runs `deploy.sh prod v1.2.0`. After the migrations, the backend goes **blue/green**:
      - the new tag starts in the idle colour (say `backend_green`) with `RUN_JOBS=false`, and must become healthy;
      - green is restarted with the reminder emails and the deadline lock on (`RUN_JOBS=true`), and must be healthy again;
      - Caddy checks that it can reach `prod-backend-green`. `prod-backend.caddy` is rewritten and Caddy reloads, with no dropped requests;
      - blue is restarted with the jobs off. Both colours run the jobs for those few seconds;
      - **blue keeps running** the previous release;
      - then collab and notifier update one at a time, as on staging;
   5. checks `https://<PROD_DOMAIN>/api/health`, then builds the website with `VITE_API_URL_PROD` and deploys it to Firebase Hosting (live);
   6. creates a GitHub release with generated notes.

Nothing on main deploys by itself. Production changes only when a tag is pushed.

## 8. Roll back production

**The API, in seconds:** switch back to the colour that's still running the previous release:
```bash
ssh deploy@<server> /opt/peerlytics/infra/scripts/rollback.sh prod
```
Running it again switches forward. It doesn't touch collab, notifier or the website.

**Everything at an older version:** on the server, with a GHCR login (a personal token with `read:packages`):
```bash
IMAGE_PREFIX=ghcr.io/<owner>/peerlytics /opt/peerlytics/infra/scripts/deploy.sh prod v1.1.0
```
For the website, use Firebase console → Hosting → release history → **Rollback**.

## 9. Common errors

| Symptom | Cause and fix |
|---|---|
| `Host key verification failed` | `SSH_KNOWN_HOSTS` is missing or old (the server was rebuilt). Run `ssh-keyscan` again and check the fingerprint |
| `Permission denied (publickey)` | The Actions public key isn't in `/home/deploy/.ssh/authorized_keys`. The playbook removes keys it doesn't know about |
| `denied` / `unauthorized` when pulling from ghcr.io | The package isn't linked to the repo. Open the package → Package settings → Manage Actions access, and add the repo |
| `.env.staging is missing` | Write the env file (section 2) |
| `dependency failed to start: container ... is unhealthy` | `docker compose -p peerlytics-staging logs backend` (or `collab`). Usually a missing setting such as `FIREBASE_SERVICE_ACCOUNT` |
| Caddy can't get a certificate | DuckDNS doesn't point at the server, or 80/443 are closed in the VM's network security group (Azure) or security list (Oracle). `docker compose -p edge logs caddy` |
| Browser: CORS error | `CORS_ORIGIN` in `.env.staging` must be exactly `https://<owner>.github.io` (no path, no trailing slash) |
| Staging website is blank, or 404 on assets | Pages Source isn't "GitHub Actions", or the repo was renamed. The base comes from the repo name |
| `auth/unauthorized-domain` | Section 4 |
| CD staging never starts | The workflow isn't on main yet (section 5), or CI failed or ran for a PR rather than a push |
| CD production: `No successful CI run for <sha>` | The tag points at a commit CI never passed on (for example, tagged locally before the merge). Tag the merge commit on main |
| Production deploy waits forever | Nobody has approved it yet: Actions → the run → Review deployments |
| `rollback.sh`: `backend_<colour> has never run` | Only one production release so far. There's nothing to switch back to |
| Firebase step: `HTTP Error: 403` | The Hosting service account lacks the Firebase Hosting Admin role, or the secret holds another project's key |
| `another deploy is still running` | A deploy holds `.deploy.lock`. Wait, or check for a stuck `deploy.sh` with `ps` |
