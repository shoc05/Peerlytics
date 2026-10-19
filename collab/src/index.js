// Start the collab server: node src/index.js (or the Docker image).
// Config from the environment (the repo-root .env in development):
//   COLLAB_PORT (default 1234), FIREBASE_SERVICE_ACCOUNT, COLLAB_DEBOUNCE_MS (default 2000)
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { firebaseLoaders, getAdmin } from './firebase.js';
import { createCollabServer } from './server.js';
import { createFirestoreStorage } from './storage.js';

const collabDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(collabDir, '..', '.env') });

const admin = getAdmin(process.env, collabDir);
if (!admin) {
  console.error('✖ Collab server needs FIREBASE_SERVICE_ACCOUNT (or the emulators) to check tokens. Not starting.');
  process.exit(1);
}

const server = createCollabServer({
  ...firebaseLoaders(admin),
  storage: createFirestoreStorage(admin.db),
  port: Number(process.env.COLLAB_PORT) || 1234,
  debounce: Number(process.env.COLLAB_DEBOUNCE_MS) || 2000,
});

await server.listen();
console.log(`✓ Collab server on :${server.port} (health: /health)`);

// Store every open document before stopping (Kubernetes sends SIGTERM).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.destroy();
    process.exit(0);
  });
}
