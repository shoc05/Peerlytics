// The app's API client: every backend call goes through here with the user's Firebase ID token.
import { signOut } from 'firebase/auth';
import { logger } from '../utils/logger';
import { getFirebaseAuth } from '../firebase/config';
import { createApiClient } from './client';
import { createApi } from './endpoints';

export { ApiError } from './client';
export { AI_UNAVAILABLE_MESSAGE } from './endpoints';

const client = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL || '',
  fetchImpl: (...args) => fetch(...args),
  getUser: () => getFirebaseAuth()?.currentUser ?? null,
  onRevoked: async () => {
    const auth = getFirebaseAuth();
    if (auth) await signOut(auth);
  },
});

export const { authHeaders, request } = client;
export const { chooseRole, getMe, grantExtension, submitForCheck, healthCheck } = createApi(client, { warn: logger.warn });

// Course site (step 1.7). The backend has no course routes yet (step 2.1 adds them with
// backend/openapi.yaml), so this stays null and the Courses tab says "Not available yet".
// Step 2.6 replaces it with wrappers over the real routes that provide the methods in
// COURSE_API_METHODS (src/courses/courseApi.js); that switches the course site on.
export const courseApi = null;
