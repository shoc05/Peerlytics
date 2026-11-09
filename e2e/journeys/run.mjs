// Runs the browser journeys against the real backend, a real PostgreSQL and the Firebase
// emulators. Started by `npm run test:e2e:journeys`, which brings the emulators up first. Needs
// TEST_DATABASE_URL (or DATABASE_URL); each run uses its own throwaway database. Nothing here can
// reach real Firebase: the project is demo-peerlytics, and the emulator addresses are set.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_PORT = 5177;
const WEB_PORT = 4173;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Run this through `npm run test:e2e:journeys` so the emulators are up.');
}

const dotenv = await import(pathToFileURL(path.join(root, 'backend/node_modules/dotenv/lib/main.js')).href);
dotenv.default.config({ path: path.join(root, '.env') });
const { createTestDatabase } = await import(pathToFileURL(path.join(root, 'backend/db/testDatabase.js')).href);

const children = [];
function start(command, args, env, cwd = root) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: process.platform === 'win32' });
  children.push(child);
  return child;
}

/** Waits for `url`, and fails if `child` exits first: then something else is answering. */
async function waitFor(url, label, child) {
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`${label} stopped while starting. Is another one already using its port?`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not start at ${url}`);
}

/** Refuse to run against a server left over from another run: its database may be gone. */
function canListen(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code === 'EADDRNOTAVAIL'));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}
async function assertFree(port) {
  for (const host of ['127.0.0.1', '::1']) {
    if (!(await canListen(port, host))) {
      throw new Error(`Port ${port} is in use on ${host}. Close whatever is using it, then run the journeys again.`);
    }
  }
}
await assertFree(API_PORT);
await assertFree(WEB_PORT);

const [authHost, authPort] = process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':');
const firestorePort = process.env.FIRESTORE_EMULATOR_HOST.split(':')[1];
const testDb = await createTestDatabase();

let code = 1;
try {
  const api = start('node', ['backend/server.js'], {
    PORT: String(API_PORT),
    DATABASE_URL: testDb.url,
    CORS_ORIGIN: WEB_URL,
    RUN_JOBS: 'true',
    GCLOUD_PROJECT: 'demo-peerlytics',
    FLAG_COURSES_V2: 'true',
    // No analysis or email leaves the machine during the journeys.
    HF_API_KEY: '',
    VWT_API_KEY: '',
    OPENAI_API_KEY: '',
    SMTP_USER: '',
    SMTP_PASS: '',
  });
  const web = start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
    VITE_FIREBASE_API_KEY: 'demo-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'demo-peerlytics.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-peerlytics',
    VITE_FIREBASE_STORAGE_BUCKET: '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
    VITE_FIREBASE_APP_ID: 'demo-app',
    VITE_API_URL: API_URL,
    VITE_COLLAB_URL: '',
    VITE_FLAG_COURSES_V2: 'true',
    VITE_AUTH_EMULATOR_URL: `http://${authHost}:${authPort}`,
    VITE_FIRESTORE_EMULATOR_PORT: firestorePort,
  });
  await waitFor(`${API_URL}/api/health`, 'The backend', api);
  await waitFor(WEB_URL, 'The website', web);

  const playwright = start('npx', ['playwright', 'test', '--project=journeys', ...process.argv.slice(2)], {
    JOURNEY_URL: WEB_URL,
    JOURNEY_API_URL: API_URL,
    JOURNEY_AUTH_URL: `http://${authHost}:${authPort}`,
  });
  [code] = await once(playwright, 'exit');
} finally {
  for (const child of children) {
    // Wait for it: exiting first would leave the servers running on Windows.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  }
  await testDb.drop().catch(() => {});
}
process.exit(code ?? 1);
