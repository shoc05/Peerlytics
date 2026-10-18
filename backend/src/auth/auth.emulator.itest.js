// Integration test against the Firebase Auth and Firestore emulators with real ID tokens.
// Run from the repo root: npm run test:auth  (firebase emulators:exec sets the *_EMULATOR_HOST vars).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { initializeApp as initClient, deleteApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth as getClientAuth,
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import { createAuthRouter } from './routes.js';
import { getAdmin } from './firebaseAdmin.js';

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!host || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Run this through `npm run test:auth` so the Auth and Firestore emulators are up.');
}
const projectId = process.env.GCLOUD_PROJECT || 'demo-peerlytics';

let server;
let baseUrl;
let clientApp;
let clientAuth;
let admin;

before(async () => {
  admin = getAdmin();
  assert.ok(admin, 'Admin SDK should start against the emulator');
  const app = express();
  app.use(express.json());
  app.use('/api', createAuthRouter());
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  clientApp = initClient({ apiKey: 'demo-key', projectId, authDomain: `${projectId}.firebaseapp.com` }, 'itest');
  clientAuth = getClientAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${host}`, { disableWarnings: true });

  // Start from an empty emulator so reruns are independent.
  await fetch(`http://${host}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await deleteApp(clientApp);
});

async function call(method, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

let counter = 0;
async function emailUser() {
  counter += 1;
  const cred = await createUserWithEmailAndPassword(clientAuth, `user${counter}@example.com`, 'secret123');
  return cred.user;
}

async function googleUser(email) {
  const credential = GoogleAuthProvider.credential(
    JSON.stringify({ sub: `google-${email}`, email, email_verified: true, name: 'Google User' })
  );
  const cred = await signInWithCredential(clientAuth, credential);
  return cred.user;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1100)); // revocation has 1 s granularity

test('email sign-up: no role, pick student once, the refreshed token carries the claim', async () => {
  const user = await emailUser();
  let token = await user.getIdToken();

  const me = await call('GET', '/api/auth/me', token);
  assert.equal(me.status, 200);
  assert.equal(me.body.role, null);

  const pick = await call('POST', '/api/auth/role', token, { role: 'student' });
  assert.deepEqual([pick.status, pick.body], [200, { role: 'student', collegeId: null }]);

  token = await user.getIdToken(true);
  const { claims } = await user.getIdTokenResult();
  assert.equal(claims.role, 'student');
  assert.equal(claims.collegeId, null);
  assert.equal((await call('GET', '/api/auth/me', token)).body.role, 'student');

  const mirror = await admin.db.collection('users').doc(user.uid).get();
  assert.equal(mirror.get('role'), 'student');

  // A second pick is refused.
  const again = await call('POST', '/api/auth/role', token, { role: 'lecturer' });
  assert.deepEqual([again.status, again.body.code], [409, 'ROLE_ALREADY_SET']);
});

test('Google sign-in (OpenID Connect) gets a token the backend accepts, and can pick lecturer', async () => {
  const user = await googleUser('lect@example.com');
  assert.equal(user.providerData[0].providerId, 'google.com');
  const token = await user.getIdToken();
  const me = await call('GET', '/api/auth/me', token);
  assert.deepEqual([me.status, me.body.email, me.body.role], [200, 'lect@example.com', null]);
  assert.equal((await call('POST', '/api/auth/role', token, { role: 'lecturer' })).status, 200);
});

test('nobody can pick collegeAdmin or superAdmin for themselves', async () => {
  const user = await emailUser();
  const token = await user.getIdToken();
  for (const role of ['collegeAdmin', 'superAdmin']) {
    const r = await call('POST', '/api/auth/role', token, { role });
    assert.deepEqual([r.status, r.body.code], [400, 'INVALID_BODY']);
  }
  const record = await admin.auth.getUser(user.uid);
  assert.equal(record.customClaims?.role, undefined);
});

test('superAdmin route: students are refused; a superAdmin can promote others but not change itself', async () => {
  const stu = await emailUser();
  let stuToken = await stu.getIdToken();
  await call('POST', '/api/auth/role', stuToken, { role: 'student' });
  stuToken = await stu.getIdToken(true);

  const self = await call('POST', `/api/admin/users/${stu.uid}/role`, stuToken, { role: 'superAdmin' });
  assert.deepEqual([self.status, self.body.code], [403, 'FORBIDDEN']);

  // First superAdmin is made outside HTTP, as set-role.js does.
  const sa = await emailUser();
  await admin.auth.setCustomUserClaims(sa.uid, { role: 'superAdmin', collegeId: null });
  const saToken = await sa.getIdToken(true);

  const own = await call('POST', `/api/admin/users/${sa.uid}/role`, saToken, { role: 'student' });
  assert.deepEqual([own.status, own.body.code], [403, 'CANNOT_CHANGE_OWN_ROLE']);

  const missing = await call('POST', '/api/admin/users/no-such-uid/role', saToken, { role: 'student' });
  assert.deepEqual([missing.status, missing.body.code], [404, 'USER_NOT_FOUND']);

  await tick();
  const promote = await call('POST', `/api/admin/users/${stu.uid}/role`, saToken, { role: 'collegeAdmin', collegeId: 'cst' });
  assert.deepEqual(promote.body, { uid: stu.uid, role: 'collegeAdmin', collegeId: 'cst' });
  const record = await admin.auth.getUser(stu.uid);
  assert.deepEqual(record.customClaims, { role: 'collegeAdmin', collegeId: 'cst' });

  // The student's old token was revoked by the role change.
  const stale = await call('GET', '/api/auth/me', stuToken);
  assert.deepEqual([stale.status, stale.body.code], [401, 'TOKEN_REVOKED']);
});

test('no token and a forged token are refused', async () => {
  assert.equal((await call('GET', '/api/auth/me')).body.code, 'NO_TOKEN');
  assert.equal((await call('GET', '/api/auth/me', 'not-a-jwt')).body.code, 'TOKEN_INVALID');
});
