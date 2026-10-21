// Turns API state into what a course screen shows. Error keys are entries in ./strings.js.

/** Message key for an ApiError (src/api/client.js; codes from docs/auth-contract.md). */
export function errorKey(err) {
  if (!err) return null;
  const { status, code } = err;
  if (status === 0) return 'errorOffline';
  if (status === 401) return 'errorSignedOut';
  if (code === 'NO_ROLE') return 'errorNoRole';
  if (status === 403) return 'errorForbidden';
  if (status === 404) return 'errorNotFound';
  if (status === 501) return 'errorUnavailable';
  if (status === 429) return 'errorRateLimited';
  if (status === 400 || code === 'INVALID_BODY') return 'errorInvalid';
  return 'errorGeneric';
}

/** 'unavailable' | 'loading' | 'error' | 'empty' | 'ready' for a list backed by the API. */
export function listViewState({ ready, loading, error, items }) {
  if (!ready) return 'unavailable';
  if (loading) return 'loading';
  if (error) return 'error';
  return Array.isArray(items) && items.length > 0 ? 'ready' : 'empty';
}
