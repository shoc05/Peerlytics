# Status page (step 5.5)

Uptime Kuma runs on k3s in the `monitoring` namespace. It checks the website, the backend's `/api/health`, collab's `/health` and the notifier's `/health` every minute. It publishes a public status page and sends an e-mail when something goes down or comes back.

Uptime Kuma keeps its settings in its own database, not in files. So this folder holds the Kubernetes manifests, plus `monitors.json`, a list of exactly what to create in the UI.

## 1. Deploy (private first)

```bash
kubectl apply -f infra/k8s/monitoring/uptime-kuma/uptime-kuma.yaml
kubectl -n monitoring rollout status deploy/uptime-kuma
kubectl -n monitoring port-forward svc/uptime-kuma 3002:80
```

Open http://localhost:3002 and **create the admin account now**. The first visitor gets to create it, so this happens before the Ingress exists. Use a strong password and keep it in the team's password manager.

## 2. E-mail notification

Go to **Settings → Notifications → Setup Notification**:

| Field | Value |
|---|---|
| Notification type | Email (SMTP) |
| Host, port | `smtp.gmail.com`, `587` |
| Security | STARTTLS |
| Username, password | The alerts account and its app password (the same one Alertmanager uses) |
| From, To | The alerts account, the team's alert address |
| Options | Tick **Default enabled** and **Apply on all existing monitors** |

## 3. Monitors

Create the four monitors listed in `monitors.json`. Each one uses:

- type **HTTP(s)** (or **HTTP(s) - Keyword** when a keyword is given)
- heartbeat interval **60** seconds
- retries **2**
- the e-mail notification turned on

## 4. Status page

Go to **Status Pages → New Status Page**. Set the title to "Peerlytics status" and the slug to `peerlytics`. Add the four monitors and save.

## 5. Make it public

Edit the host in `ingress.yaml`, then run:

```bash
kubectl apply -f infra/k8s/monitoring/uptime-kuma/ingress.yaml
```

The status page is now at `https://<host>/status/peerlytics`. The admin pages on the same host still need the admin login.

## Checking it works

Run `kubectl -n peerlytics scale deploy/peerlytics-collab --replicas=0`. Within about 3 minutes (60 s interval × 2 retries) the collab monitor turns red on the status page and the e-mail arrives. Scale it back up to get the "up" e-mail.

## Backups

Everything lives on the `uptime-kuma-data` volume (`/app/data/kuma.db`). Include it in the cluster backups, or use **Settings → Backup → Export** after setting things up.
