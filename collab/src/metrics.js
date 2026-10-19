// Prometheus metrics for the collab server (step 5.3), served at GET /metrics.
import client from 'prom-client';

export function createCollabMetrics({ registry = new client.Registry() } = {}) {
  // "app", not "service": Prometheus adds "service" itself from the Kubernetes Service.
  registry.setDefaultLabels({ app: 'peerlytics-collab' });
  client.collectDefaultMetrics({ register: registry });
  const opts = (o) => ({ ...o, registers: [registry] });
  return {
    registry,
    connections: new client.Counter(opts({ name: 'collab_connections_total', help: 'Accepted editor connections.' })),
    refused: new client.Counter(opts({ name: 'collab_auth_refused_total', help: 'Refused connections, by reason.', labelNames: ['reason'] })),
    active: new client.Gauge(opts({ name: 'collab_active_connections', help: 'Editor connections open now.' })),
    documents: new client.Gauge(opts({ name: 'collab_open_documents', help: 'Documents loaded in memory now.' })),
    storeErrors: new client.Counter(opts({ name: 'collab_store_errors_total', help: 'Failed saves of Yjs state.' })),
  };
}
