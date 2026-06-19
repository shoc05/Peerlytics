// Dev-only logger. In production builds (import.meta.env.DEV === false) these are
// no-ops, so the browser console stays clean for end users. `error` is kept in all
// environments because genuine errors are worth surfacing even in production.
const isDev = import.meta.env?.DEV ?? true;

export const logger = {
  log: (...args) => { if (isDev) console.log(...args); },
  warn: (...args) => { if (isDev) console.warn(...args); },
  error: (...args) => { console.error(...args); }, // always — real failures matter
};

export default logger;
