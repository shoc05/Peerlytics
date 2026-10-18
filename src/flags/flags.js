// Feature flags (step 4.2). Values come from Firebase Remote Config; these defaults apply
// until it answers, when it can't be reached, and in every test. They must match
// remoteconfig.template.json (flags.test.js checks). See docs/feature-flags.md.

export const FLAG_DEFAULTS = Object.freeze({
  ai_provider: 'legacy',
  ai_detection_enabled: true,
  yjs_enabled: false,
  doc_tabs_enabled: false,
  offline_enabled: false,
  push_enabled: false,
  csv_invite_enabled: false,
  docx_export_enabled: false,
  licensing_enabled: false,
  peer_eval_enabled: false,
  course_dashboard_enabled: false,
  dzongkha_enabled: false,
});

export const FLAG_NAMES = Object.freeze(Object.keys(FLAG_DEFAULTS));

const STRING_CHOICES = { ai_provider: ['openai', 'legacy'] };

// Features that only work on top of another one: off when what they need is off.
const REQUIRES = { doc_tabs_enabled: 'yjs_enabled', offline_enabled: 'yjs_enabled' };

/** One raw value (Remote Config string, env string, boolean) -> a safe value for `name`. */
export function parseFlagValue(name, raw) {
  const fallback = FLAG_DEFAULTS[name];
  if (raw == null || raw === '') return fallback;
  if (typeof fallback === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return fallback;
  }
  const s = String(raw).trim();
  return STRING_CHOICES[name]?.includes(s) ? s : fallback;
}

/**
 * Merge sources into a complete, safe flag set. Later sources win; unknown names and bad
 * values are ignored. `sources` are plain objects of raw values.
 */
export function resolveFlags(...sources) {
  const flags = { ...FLAG_DEFAULTS };
  for (const source of sources) {
    for (const name of FLAG_NAMES) {
      if (source && Object.prototype.hasOwnProperty.call(source, name)) {
        flags[name] = parseFlagValue(name, source[name]);
      }
    }
  }
  for (const [name, needs] of Object.entries(REQUIRES)) {
    if (!flags[needs]) flags[name] = false;
  }
  return flags;
}

/** VITE_FLAG_YJS_ENABLED=true style overrides, for local development only. */
export function envOverrides(env = {}) {
  const out = {};
  for (const name of FLAG_NAMES) {
    const value = env[`VITE_FLAG_${name.toUpperCase()}`];
    if (value != null && value !== '') out[name] = value;
  }
  return out;
}
