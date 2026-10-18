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
