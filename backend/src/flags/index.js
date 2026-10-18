// Feature flags on the server (step 4.2). Order: FLAG_<NAME> env override, then Firebase
// Remote Config (server template through the Admin SDK, cached for a minute), then the safe
// defaults below. Never throws: when Remote Config can't be reached the last good values
// (or the defaults) are used. Defaults must match remoteconfig.template.json (index.test.js).
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { getAdmin } from '../auth/firebaseAdmin.js';

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
const REQUIRES = { doc_tabs_enabled: 'yjs_enabled', offline_enabled: 'yjs_enabled' };
export const CACHE_MS = 60_000;

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

export function envOverrides(env = process.env) {
  const out = {};
  for (const name of FLAG_NAMES) {
    const value = env[`FLAG_${name.toUpperCase()}`];
    if (value != null && value !== '') out[name] = value;
  }
  return out;
}

/** Remote Config server template -> raw values, or null when the Admin SDK isn't configured. */
async function loadRemoteConfig() {
  if (!getAdmin()) return null;
  const defaultConfig = Object.fromEntries(Object.entries(FLAG_DEFAULTS).map(([k, v]) => [k, String(v)]));
  const template = await getRemoteConfig().getServerTemplate({ defaultConfig });
  const config = template.evaluate();
  return Object.fromEntries(FLAG_NAMES.map((name) => [name, config.getString(name)]));
}

/**
 * `load` returns raw values (or null). `now` and `env` are injectable for tests.
 * Returns { all(), get(name), refresh() }.
 */
export function createFlags({ load = loadRemoteConfig, env = process.env, now = Date.now, cacheMs = CACHE_MS, log = console.warn } = {}) {
  let remote = null;
  let fetchedAt = -Infinity;
  let pending = null;
  let warned = false;

  async function refresh() {
    try {
      remote = (await load()) ?? remote;
      warned = false;
    } catch (err) {
      if (!warned) log(`⚠ Feature flags: Remote Config unavailable, using ${remote ? 'the last values' : 'defaults'} — ${err.message}`);
      warned = true;
    }
    fetchedAt = now();
  }

  async function all() {
    if (now() - fetchedAt >= cacheMs) {
      pending ??= refresh().finally(() => {
        pending = null;
      });
      await pending;
    }
    return resolveFlags(remote ?? {}, envOverrides(env));
  }

  async function get(name) {
    if (!(name in FLAG_DEFAULTS)) throw new Error(`Unknown feature flag: ${name}`);
    return (await all())[name];
  }

  return { all, get, refresh };
}

const shared = createFlags();

/** await getFlag('ai_detection_enabled') */
export const getFlag = (name) => shared.get(name);
export const getFlags = () => shared.all();
