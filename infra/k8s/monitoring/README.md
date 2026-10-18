# Monitoring and alerts (step 5.3)

This sets up kube-prometheus-stack (Prometheus, Alertmanager, Grafana) on k3s in the `monitoring` namespace. It scrapes `/metrics` on the backend, collab and notifier.

| File | What it is |
|---|---|
| `values.yaml` | Helm values: k3s fixes, storage, Grafana, Alertmanager e-mail (no secrets) |
| `values-local.example.yaml` | Template for the e-mail addresses; copy to `values-local.yaml` (git-ignored) |
| `servicemonitors.yaml` | Scrape targets: backend, collab, notifier in namespace `peerlytics` |
| `alert-rules.yaml` | Alerts: errors above 5% for 5 min, a pod restarting, the backend down |
| `dashboards/peerlytics-overview.json` | Grafana dashboard: requests, errors, response time, live editing, restarts |
| `kustomization.yaml` | Applies the monitors, the rules and the dashboard ConfigMap |

## Install

```bash
kubectl create namespace monitoring

# Secrets are created by hand (or by Ansible); never commit them.
kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=admin-user=admin --from-literal=admin-password='<strong password>'
kubectl -n monitoring create secret generic alertmanager-smtp \
  --from-literal=password='<SMTP app password>'

cp infra/k8s/monitoring/values-local.example.yaml infra/k8s/monitoring/values-local.yaml   # edit it

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --version 65.8.1 \
  -f infra/k8s/monitoring/values.yaml -f infra/k8s/monitoring/values-local.yaml

kubectl apply -k infra/k8s/monitoring
```

Open Grafana with `kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3001:80` and go to http://localhost:3001 → **Peerlytics overview**.

## What the app has to provide

- **Namespace and Services.** The app runs in namespace `peerlytics`. Each Service is labelled `app.kubernetes.io/name: peerlytics-backend` (or `peerlytics-collab`, `peerlytics-notifier`) and has a port named `http`.
- **Metrics.** The backend serves `GET /metrics` (`backend/src/metrics`) with `http_requests_total` and `http_request_duration_seconds`, plus Node.js process metrics. Collab serves `GET /metrics` (`collab/src/metrics.js`) with `collab_*` connection, refusal and document metrics.
- **The notifier (step 2.5).** It must serve `/metrics` with the same `http_*` names. Until it does, its target shows as down, which raises a warning only.
- **Access to `/metrics`.** Keep it inside the cluster: don't route `/metrics` through the Ingress. If `METRICS_TOKEN` is set, add `bearerTokenSecret` to the ServiceMonitors.

## Testing an alert

Scale the backend to zero with `kubectl -n peerlytics scale deploy/peerlytics-backend --replicas=0`. **PeerlyticsBackendDown** fires after 2 minutes and the e-mail arrives soon after. Scale it back up to get the "resolved" e-mail.

`backend/src/metrics/monitoringConfig.test.js` checks that every metric the rules and the dashboard use is one the services really export.
