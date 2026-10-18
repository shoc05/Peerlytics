export function mapAuthError(error) {
  const code = error?.code || '';
  const messages = {
    'auth/invalid-email': 'Invalid email address.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found with this email. Please sign up first.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
    'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase Console.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
    'auth/cancelled-popup-request': 'Google sign-in was closed before it finished.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
    'auth/account-exists-with-different-credential':
      'An account with this email already exists. Sign in with your password first.',
    'auth/unauthorized-domain': 'Google sign-in is not allowed on this website address yet.',
  };
  if (messages[code]) return messages[code];
  if (error?.message?.includes('permission') || code === 'permission-denied') {
    return 'Database permission denied. Check Firestore rules or try signing up again.';
  }
  return error?.message || 'Something went wrong. Please try again.';
}
