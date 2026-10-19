// Join codes. Their format is set by the courses API (step 2.1), which doesn't exist yet,
// so the client only trims the code and requires one; the server decides if it is valid.
export const normalizeJoinCode = (value) => String(value ?? '').trim();

/** null when there is a code to send, otherwise a string key in ./strings.js. */
export function validateJoinCode(value) {
  return normalizeJoinCode(value) ? null : 'joinCodeRequired';
}
