// HTTP client for the Peerlytics backend (docs/auth-contract.md section 3).
// No Firebase or Vite imports, so it runs under `node --test`; src/api/index.js wires it up.
import { isTokenRevoked } from '../utils/authRole.js';

/**
 * Seconds to wait before retrying, from a Retry-After header (seconds or an HTTP date)
 * or a `retryAfter` field in the JSON body. null when neither is usable.
 */
export function parseRetryAfter(headerValue, body, now = Date.now()) {
  if (headerValue != null && headerValue !== '') {
    const secs = Number(headerValue);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
    const at = Date.parse(headerValue);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - now) / 1000));
  }
  const fromBody = Number(body?.retryAfter);
  return Number.isFinite(fromBody) && fromBody >= 0 ? Math.ceil(fromBody) : null;
}

/** An error from the API. `status` is 0 when the backend could not be reached. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = null, retryAfter = null, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    if (details !== undefined) this.details = details;
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl]   e.g. VITE_API_URL; '' uses the Vite /api proxy
 * @param {Function} opts.fetchImpl the fetch to use
 * @param {Function} opts.getUser   returns the signed-in Firebase user, or null
 * @param {Function} [opts.onRevoked] called when the backend says TOKEN_REVOKED (sign out)
 */
export function createApiClient({ baseUrl = '', fetchImpl, getUser, onRevoked = async () => {} }) {
  // Every backend call except /api/health sends the Firebase ID token.
  // The SDK refreshes the token itself; pass forceRefresh after a role change.
  async function authHeaders({ forceRefresh = false } = {}) {
    const user = getUser();
    if (!user) return {};
    return { Authorization: `Bearer ${await user.getIdToken(forceRefresh)}` };
  }

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    if (auth) Object.assign(headers, await authHeaders());

    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError('Could not reach the Peerlytics server. Check your connection and try again.', {
        code: 'NETWORK_ERROR',
      });
    }

    const data = await res.json().catch(() => ({}));
    if (isTokenRevoked(res.status, data)) {
      // An admin changed this user's role; the old session must end.
      await onRevoked();
    }
    if (!res.ok) {
      throw new ApiError(data.error || data.message || `Request failed (${res.status})`, {
        status: res.status,
        code: data.code ?? null,
        retryAfter: res.status === 429 ? parseRetryAfter(res.headers?.get?.('Retry-After'), data) : null,
        details: data.details,
      });
    }
    return data;
  }

  return { authHeaders, request };
}
