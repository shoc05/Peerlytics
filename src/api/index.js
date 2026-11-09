// The app's API client: every backend call goes through here with the user's Firebase ID token.
import { signOut } from 'firebase/auth';
import { logger } from '../utils/logger';
import { getFirebaseAuth } from '../firebase/config';
import { createApiClient } from './client';
import { createBillingApi } from './billingEndpoints';
import { createCourseApi } from './courseEndpoints';
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
export const { addLicence, chooseRole, createCollege, getMe, grantExtension, listColleges, setUserRole, submitForCheck, healthCheck } = createApi(client, { warn: logger.warn });

// Course site: the methods in COURSE_API_METHODS (src/courses/courseApi.js) over the real routes.
export const courseApi = createCourseApi(client);

// Plans, payments, seats and the college admin's page (docs/billing.md).
export const billingApi = createBillingApi(client);
