// JSON error bodies from docs/auth-contract.md section 4: `error` for people, `code` for programs.
const MESSAGES = {
  NO_TOKEN: 'Please sign in first.',
  TOKEN_INVALID: 'Your sign-in could not be verified. Please sign in again.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_REVOKED: 'Your role was changed. Please sign in again.',
  NO_ROLE: 'Choose whether you are a student or a lecturer first.',
  FORBIDDEN: 'You do not have permission to do this.',
  INVALID_BODY: 'The request is not valid.',
  ROLE_ALREADY_SET: 'Your role is already set. Ask an administrator to change it.',
  CANNOT_CHANGE_OWN_ROLE: 'You cannot change your own role.',
  USER_NOT_FOUND: 'That user does not exist.',
  AUTH_UNAVAILABLE: 'Sign-in checks are not configured on the server.',
};

export function sendError(res, status, code, details) {
  const body = { error: MESSAGES[code] || 'Request failed.', code };
  if (details) body.details = details;
  return res.status(status).json(body);
}

/** Zod issues as [{ path, message }], without echoing the submitted values. */
export function zodDetails(zodError) {
  return zodError.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
