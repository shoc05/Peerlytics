// requireAuth / requireRole from docs/auth-contract.md section 4.
import { sendError } from './errors.js';
import { claimsToRole } from './roles.js';

const TOKEN_ERRORS = {
  'auth/id-token-expired': 'TOKEN_EXPIRED',
  'auth/id-token-revoked': 'TOKEN_REVOKED',
  'auth/user-disabled': 'TOKEN_REVOKED',
};
const AUTHENTICATED = Symbol('authenticated');

/** `getAuthClient()` returns a firebase-admin Auth (or null when the Admin SDK isn't configured). */
export function createRequireAuth(getAuthClient) {
  return async function requireAuth(req, res, next) {
    if (req[AUTHENTICATED]) return next();

    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) return sendError(res, 401, 'NO_TOKEN');

    let auth;
    try {
      auth = getAuthClient();
    } catch (err) {
      return next(err);
    }
    if (!auth) return sendError(res, 503, 'AUTH_UNAVAILABLE');

    let decoded;
    try {
      // `true` also rejects tokens revoked after a role change.
      decoded = await auth.verifyIdToken(match[1], true);
    } catch (err) {
      return sendError(res, 401, TOKEN_ERRORS[err?.code] || 'TOKEN_INVALID');
    }
    req.user = { uid: decoded.uid, email: decoded.email ?? null, ...claimsToRole(decoded) };
    req[AUTHENTICATED] = true;
    return next();
  };
}

export function requireRole(...roles) {
  return function checkRole(req, res, next) {
    if (!req.user?.role) return sendError(res, 403, 'NO_ROLE');
    if (!roles.includes(req.user.role)) return sendError(res, 403, 'FORBIDDEN');
    return next();
  };
}
