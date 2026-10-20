// CI only: creates the Postman test users in the Firebase Auth emulator, gives them their
// roles as custom claims (auth contract §2), signs them in, and prints a Postman environment
// with their ID tokens to stdout. These are emulator accounts in a throwaway project, not
// app data. Needs FIREBASE_AUTH_EMULATOR_HOST (set by `firebase emulators:exec`).
//   node postman/ci/seed-emulator.mjs > env.json
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestore = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT || 'demo-peerlytics';
const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:5000';
if (!host) throw new Error('FIREBASE_AUTH_EMULATOR_HOST is not set; run inside `firebase emulators:exec`.');

const api = (path) => `http://${host}/identitytoolkit.googleapis.com/v1/${path}`;
const PASSWORD = 'emulator-only-password';

async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${url}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const users = {
  lecturer: { role: 'lecturer', name: 'Pema Lecturer' },
  lecturer2: { role: 'lecturer', name: 'Other Lecturer' },
  student1: { role: 'student', name: 'Karma Wangchuk' },
  student2: { role: 'student', name: 'Dechen Yangzom' },
  student3: { role: 'student', name: 'Tashi Dorji' },
  superAdmin: { role: 'superAdmin', name: 'Platform Admin' },
  noRole: { role: null, name: 'New Account' },
  spare: { role: 'student', name: 'Spare Student' },
};

const values = { baseUrl, firebaseProjectId: project, firestoreEmulator: firestore ? `http://${firestore}` : '' };
for (const [key, u] of Object.entries(users)) {
  const email = `${key.toLowerCase()}@peerlytics.test`;
  const { localId } = await post(api('accounts:signUp?key=emulator'), { email, password: PASSWORD, returnSecureToken: true });
  await post(
    api(`projects/${project}/accounts:update`),
    { localId, displayName: u.name, ...(u.role ? { customAttributes: JSON.stringify({ role: u.role, collegeId: null }) } : {}) },
    { Authorization: 'Bearer owner' }
  );
  // Sign in again so the token carries the claims.
  const { idToken } = await post(api('accounts:signInWithPassword?key=emulator'), { email, password: PASSWORD, returnSecureToken: true });
  values[`token_${key}`] = idToken;
  values[`uid_${key}`] = localId;
}

process.stdout.write(
  JSON.stringify({ name: 'Peerlytics CI (emulator)', values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true })) }, null, 2)
);
