// The version shown in the footer (step 5.8): VITE_APP_VERSION, set by the deploy workflows to
// the commit or tag. A screenshot of it proves which build is live.

/** VITE_APP_VERSION, a full 40-char commit SHA shortened to 7 characters; "dev" when unset. */
export function appVersion(env = {}) {
  const version = String(env.VITE_APP_VERSION || '').trim();
  if (!version) return 'dev';
  return /^[0-9a-f]{40}$/i.test(version) ? version.slice(0, 7) : version;
}
