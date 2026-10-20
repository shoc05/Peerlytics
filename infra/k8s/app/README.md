# Peerlytics on Kubernetes (k3s)

Steps 4.1 and 5.2 · Owner: Sonam. The cluster comes from `infra/ansible` (step 3.3). Monitoring is in `infra/k8s/monitoring` (Kezang).

```
infra/k8s/app/
  base/                 shared by every environment
    config.yaml         ConfigMap peerlytics-config (no secrets)
    postgres.yaml       PostgreSQL 16 StatefulSet + Service + NetworkPolicy (backend and backup only)
    backup.yaml         nightly pg_dump CronJob (02:00 Asia/Thimphu, keeps 14 days) + its disk
    backend.yaml        API Deployment + Service; runs the migrations in an init container
    collab.yaml         Hocuspocus/Yjs websockets Deployment + Service
    notifier.yaml       notifier Deployment + Service (replicas 0 until its image exists)
    ingress.yaml        api.<domain> -> backend /api; collab.<domain> -> collab (never /metrics)
  overlays/staging/     namespace staging, hosts, image tags (develop), smaller disks
  overlays/production/  namespace production, real hosts, release tags (v*), bigger limits and disks
infra/k8s/traefik/      HTTPS with Let's Encrypt for k3s's Traefik (cluster-wide, once)
```

Every pod runs as a non-root user, with a read-only filesystem, no Linux capabilities, the RuntimeDefault seccomp profile, and CPU and memory requests and limits. Readiness and liveness probes use `/api/health` (backend) and `/health` (collab, notifier).

## One-time set-up per cluster

```bash
# HTTPS: set your email in the file first
kubectl apply -f infra/k8s/traefik/helmchartconfig.yaml
```

DNS: point `api.<env>.<domain>` and `collab.<env>.<domain>` at the server. Replace the `peerlytics.example` hosts in the overlay with your domain.

## Secrets (per namespace, never in git)

Create these once in each namespace (`staging`, later `production`). Type the values in your own terminal; don't paste them into chat, tickets or commits.

```bash
NS=staging

# Database password: letters and digits only, because it goes into a connection URL.
kubectl -n $NS create secret generic peerlytics-postgres \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"

# Firebase Admin service account (Firebase console -> Project settings -> Service accounts)
kubectl -n $NS create secret generic peerlytics-firebase \
  --from-file=service-account.json=./service-account.json

# Analysis providers: each key is optional; leave out the ones you don't have.
kubectl -n $NS create secret generic peerlytics-providers \
  --from-literal=OPENAI_API_KEY='…' --from-literal=HF_API_KEY='…' --from-literal=VWT_API_KEY='…'

# Reminder emails (optional)
kubectl -n $NS create secret generic peerlytics-smtp \
  --from-literal=SMTP_USER='…' --from-literal=SMTP_PASS='…'

# Optional: require a token on /metrics (then give it to the ServiceMonitors too)
kubectl -n $NS create secret generic peerlytics-metrics --from-literal=METRICS_TOKEN="$(openssl rand -hex 24)"
```

To change a value: `kubectl -n $NS create secret generic … --dry-run=client -o yaml | kubectl apply -f -`, then `kubectl -n $NS rollout restart deployment/peerlytics-backend`.

The database password is only read when the data folder is first created. To change it later, change it inside PostgreSQL (`ALTER USER peerlytics PASSWORD …`) as well as in the Secret.

## Deploy

```bash
cd infra/k8s/app/overlays/staging
kustomize edit set image ghcr.io/shoc05/peerlytics-backend=ghcr.io/shoc05/peerlytics-backend:<git-sha>   # the deploy job does this
kubectl apply -k .
kubectl -n staging rollout status deployment/peerlytics-backend
kubectl -n staging get pods
```

## Backups

```bash
kubectl -n staging get cronjob peerlytics-postgres-backup
kubectl -n staging create job --from=cronjob/peerlytics-postgres-backup backup-now   # run one now
kubectl -n staging logs job/backup-now
```

The dumps are on the `peerlytics-backups` disk, on the same server. Prove they restore with `infra/scripts/restore-drill.sh -n <namespace>` (see `docs/restore-drill.md`). Copying them off the server is step 5.5 (Tshewang).

## Notes

- **One replica each for the backend and collab.** The backend runs the deadline lock, the reminder emails and the rate limits in-process, and collab needs a shared broker before it can run more than one instance. Both restart automatically if they fail their probes.
- **`/metrics`** is never routed by the Ingress. Prometheus scrapes it inside the cluster. Kezang's ServiceMonitors match `app.kubernetes.io/name=peerlytics-<service>` and the port named `http`.
- **CI** builds every overlay and checks it with kubeconform (job `k8s (kustomize, kubeconform)`).
