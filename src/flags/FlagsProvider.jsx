// <FlagsProvider> loads Remote Config once and useFlag('yjs_enabled') reads a flag anywhere.
// Until Remote Config answers (or when it can't), every flag has its safe default, so a
// feature behind a flag simply stays hidden.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { getFirebaseApp } from '../firebase/config';
import { logger } from '../utils/logger';
import { envOverrides, FLAG_DEFAULTS, FLAG_NAMES, resolveFlags } from './flags';

// Remote Config caches values on the device; ask the server again after this long.
const FETCH_INTERVAL_MS = 10 * 60 * 1000;

const local = envOverrides(import.meta.env);
const FlagsContext = createContext(resolveFlags(local));

async function loadRemoteFlags() {
  const app = getFirebaseApp();
  if (!app) return {};
  const { fetchAndActivate, getRemoteConfig, getValue } = await import('firebase/remote-config');
  const rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = FETCH_INTERVAL_MS;
  rc.defaultConfig = Object.fromEntries(Object.entries(FLAG_DEFAULTS).map(([k, v]) => [k, String(v)]));
  await fetchAndActivate(rc);
  return Object.fromEntries(FLAG_NAMES.map((name) => [name, getValue(rc, name).asString()]));
}

export function FlagsProvider({ children }) {
  const [flags, setFlags] = useState(() => resolveFlags(local));

  useEffect(() => {
    let cancelled = false;
    loadRemoteFlags()
      .then((remote) => {
        if (!cancelled) setFlags(resolveFlags(remote, local));
      })
      .catch((err) => logger.warn('[flags] Remote Config unavailable, using defaults:', err?.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>;
}

/** All flags as one object. */
export function useFlags() {
  return useContext(FlagsContext);
}

/** One flag's value: a boolean, or a string for ai_provider. */
export function useFlag(name) {
  const flags = useContext(FlagsContext);
  if (!(name in FLAG_DEFAULTS)) throw new Error(`Unknown feature flag: ${name}`);
  return flags[name];
}
