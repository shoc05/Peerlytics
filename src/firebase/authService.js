import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getFirebaseAuth } from './config';
import { createUserProfile, getUserProfile, updateUserProfile } from './firestoreService';
import { chooseRole } from '../services/api';
import { buildSessionUser } from '../utils/authRole';

function auth() {
  const a = getFirebaseAuth();
  if (!a) throw new Error('Firebase is not configured. Add VITE_FIREBASE_* to your .env file.');
  return a;
}

/**
 * The signed-in user as the app sees it. The role comes from the ID token's custom claim
 * (docs/auth-contract.md); role null means the user still has to pick one.
 */
export async function loadSessionUser(fbUser, { forceRefresh = false } = {}) {
  const [{ claims }, profile] = await Promise.all([
    fbUser.getIdTokenResult(forceRefresh),
    getUserProfile(fbUser.uid),
  ]);
  return buildSessionUser({ fbUser, claims, profile });
}

/**
 * Pick student or lecturer, once. The backend sets the custom claim; the client only stores
 * the class/section. Then the token is refreshed so it carries the new claim.
 */
export async function pickRole({ role, classSection }) {
  const fbUser = auth().currentUser;
  if (!fbUser) throw new Error('Please sign in first.');
  await chooseRole(role);
  if (role === 'student') {
    await updateUserProfile(fbUser.uid, { classSection: (classSection || '').trim() });
  }
  return loadSessionUser(fbUser, { forceRefresh: true });
}

export async function signUp({ email, password, name, role, classSection }) {
  const authClient = auth();
  const credential = await createUserWithEmailAndPassword(authClient, email.trim(), password);
  const uid = credential.user.uid;
  const displayName = name.trim() || email.split('@')[0];

  // The profile has no role field: only the backend writes it (firestore.rules).
  await createUserProfile({
    uid,
    email: email.trim().toLowerCase(),
    name: displayName,
    // Students choose a class/section so lecturer reports can group them.
    classSection: role === 'student' ? (classSection || '').trim() : '',
  });

  const profile = await getUserProfile(uid);
  if (!profile) {
    throw new Error('Account created but profile could not be loaded. Check Firestore rules.');
  }
  try {
    return await pickRole({ role, classSection });
  } catch {
    // The account exists; without the backend the role can't be set yet. The role picker
    // appears on the dashboard so the user can try again.
    return loadSessionUser(credential.user);
  }
}

export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth(), email.trim(), password);
  const profile = await getUserProfile(credential.user.uid);
  if (!profile) {
    throw new Error(
      'Signed in to Firebase but no user profile was found. Please sign up again or contact support.'
    );
  }
  return loadSessionUser(credential.user);
}

/**
 * Google sign-in (Firebase Auth's OpenID Connect provider). A first-time Google user gets a
 * profile without a role and picks one on the role picker.
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { user } = await signInWithPopup(auth(), provider);
  if (!(await getUserProfile(user.uid))) {
    await createUserProfile({
      uid: user.uid,
      email: (user.email || '').toLowerCase(),
      name: user.displayName || user.email?.split('@')[0] || 'User',
      classSection: '',
    });
  }
  return loadSessionUser(user);
}

export async function logOut() {
  await signOut(auth());
}

export function subscribeAuth(callback) {
  return onAuthStateChanged(auth(), callback);
}
