import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app = null;
let auth = null;
let db = null;

// Only the browser journeys (npm run test:e2e:journeys) set these.
const authEmulator = import.meta.env.VITE_AUTH_EMULATOR_URL;
const firestoreEmulatorPort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT);

export function isFirebaseConfigured() {
  return Boolean(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID);
}

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) return null;
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth() {
  if (!isFirebaseConfigured()) return null;
  if (!auth) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    if (authEmulator) connectAuthEmulator(auth, authEmulator, { disableWarnings: true });
  }
  return auth;
}

export function getFirestoreDb() {
  if (!isFirebaseConfigured()) return null;
  if (!db) {
    if (!app) app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    if (firestoreEmulatorPort) connectFirestoreEmulator(db, '127.0.0.1', firestoreEmulatorPort);
  }
  return db;
}
