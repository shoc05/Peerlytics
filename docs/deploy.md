# Deploying Peerlytics

Step 1.9 (staging). Pipeline diagram: [diagrams/cd-pipeline.md](diagrams/cd-pipeline.md).

Everything runs on one Oracle Cloud Always Free Ubuntu ARM (aarch64) server, with Docker and Compose:

| What | Where |
|---|---|
| Staging API and live editing | `https://<STAGING_DOMAIN>/api`, `wss://<STAGING_DOMAIN>/collab` |
| Production API and live editing | `https://<PROD_DOMAIN>/api`, `wss://<PROD_DOMAIN>/collab` |
| Staging website | GitHub Pages, `https://<owner>.github.io/<repo>/` |
| Production website | The existing Firebase Hosting live site |

One Caddy container (compose project `edge`) owns ports 80 and 443. It gets the HTTPS certificates for both domains by itself and forwards `/api` to the backend and `/collab` to the collab server. Staging and production are two separate compose projects, `peerlytics-staging` and `peerlytics-prod`. Each one has its own env file, its own PostgreSQL volume and its own private network. No app container publishes a port.

## 1. Set up the server

1. Create the VM (Ubuntu 22.04 or 24.04, Ampere A1). In the subnet's **security list**, add ingress rules for TCP 80 and 443 from `0.0.0.0/0`.
2. Point both DuckDNS names at the VM's public IP.
3. From a Linux, macOS or WSL machine, run the playbook. It sets up Docker, the `deploy` user, iptables for 80 and 443, the folders and the `edge` network (details in [infra/ansible/README.md](../infra/ansible/README.md)):
   ```bash
   cd infra/ansible
   ansible-galaxy collection install -r requirements.yml -p collections
   cp inventory.example.ini inventory.ini        # add: vps1 ansible_host=<server IP>
   ansible-playbook site.yml -u ubuntu -e deploy_ssh_public_key_file=~/.ssh/id_ed25519.pub
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
| `edge/upstreams/` | deploy.sh | Production's live backend colour (step 5.1) |
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

**Repository variables** (the website build isn't in an environment):

| Name | Value |
|---|---|
| `VITE_API_URL_STAGING` | `https://<STAGING_DOMAIN>` |
| `VITE_COLLAB_URL_STAGING` | `wss://<STAGING_DOMAIN>/collab` (empty keeps live editing off) |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | The Firebase web config. It ships in every page, so it isn't a secret |

`GITHUB_TOKEN` pushes and pulls the images. You don't need a registry password. On the server it's piped into `docker login --password-stdin`, and the server is logged out again at the end of the job.

## 4. Firebase authorized domains

In the Firebase console, open **Authentication → Settings → Authorized domains** and add `<owner>.github.io`. Without it, sign-in on the staging website fails with `auth/unauthorized-domain`.

## 5. How a staging deploy runs

1. A PR is merged into develop, and **CI** runs on the push.
2. When CI succeeds, two workflows start:
   - **CD staging** (`cd-staging.yml`) checks out exactly that commit and builds the linux/arm64 images through `build-images.yml`. They are tagged `sha-<7 chars>` and pushed to `ghcr.io/<owner>/peerlytics-<service>`. The deploy job (environment `staging`, one at a time) copies `infra/` to the server, logs the server in to GHCR and runs `infra/scripts/deploy.sh staging sha-<7>`.
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

## 7. Common errors

| Symptom | Cause and fix |
|---|---|
| `Host key verification failed` | `SSH_KNOWN_HOSTS` is missing or old (the server was rebuilt). Run `ssh-keyscan` again and check the fingerprint |
| `Permission denied (publickey)` | The Actions public key isn't in `/home/deploy/.ssh/authorized_keys`. The playbook removes keys it doesn't know about |
| `denied` / `unauthorized` when pulling from ghcr.io | The package isn't linked to the repo. Open the package → Package settings → Manage Actions access, and add the repo |
| `.env.staging is missing` | Write the env file (section 2) |
| `dependency failed to start: container ... is unhealthy` | `docker compose -p peerlytics-staging logs backend` (or `collab`). Usually a missing setting such as `FIREBASE_SERVICE_ACCOUNT` |
| Caddy can't get a certificate | DuckDNS doesn't point at the server, or 80/443 are closed in the Oracle security list. `docker compose -p edge logs caddy` |
| Browser: CORS error | `CORS_ORIGIN` in `.env.staging` must be exactly `https://<owner>.github.io` (no path, no trailing slash) |
| Staging website is blank, or 404 on assets | Pages Source isn't "GitHub Actions", or the repo was renamed. The base comes from the repo name |
| `auth/unauthorized-domain` | Section 4 |
| CD staging never starts | The workflow isn't on main yet (section 5), or CI failed or ran for a PR rather than a push |
| `another deploy is still running` | A deploy holds `.deploy.lock`. Wait, or check for a stuck `deploy.sh` with `ps` |
