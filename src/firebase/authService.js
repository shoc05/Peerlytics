import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getFirebaseAuth } from './config';
import { createUserProfile, getUserProfile } from './firestoreService';

function auth() {
  const a = getFirebaseAuth();
  if (!a) throw new Error('Firebase is not configured. Add VITE_FIREBASE_* to your .env file.');
  return a;
}

export async function signUp({ email, password, name, role, classSection }) {
  const authClient = auth();
  const credential = await createUserWithEmailAndPassword(authClient, email.trim(), password);
  const uid = credential.user.uid;
  const displayName = name.trim() || email.split('@')[0];

  await createUserProfile({
    uid,
    email: email.trim().toLowerCase(),
    name: displayName,
    role,
    // Students choose a class/section so lecturer reports can group them. Lecturers/admins
    // have no class. Stored as-is (e.g. "CS Year 2", "Open Level 3").
    classSection: role === 'student' ? (classSection || '').trim() : '',
  });

  const profile = await getUserProfile(uid);
  if (!profile) {
    throw new Error('Account created but profile could not be loaded. Check Firestore rules.');
  }
  return profile;
}

export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth(), email.trim(), password);
  const profile = await getUserProfile(credential.user.uid);
  if (!profile) {
    throw new Error(
      'Signed in to Firebase but no user profile was found. Please sign up again or contact support.'
    );
  }
  return profile;
}

export async function logOut() {
  await signOut(auth());
}

export function subscribeAuth(callback) {
  return onAuthStateChanged(auth(), callback);
}
