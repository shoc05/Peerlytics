// Small pure helpers for live editing (step 2.2). Kept free of React and the network so
// they run under node:test.
import { ySyncPluginKey } from 'y-prosemirror';

// The editor's Yjs fragment. Must match FIELD in collab/src/server.js.
export const COLLAB_FIELD = 'default';

/** Same format as collab/src/access.js. */
export function documentName(groupId, fileId) {
  return `group:${groupId}:file:${fileId}`;
}

/**
 * The collab server's WebSocket URL, or null when not configured:
 *   VITE_COLLAB_URL when set, otherwise VITE_API_URL's server at /collab
 *   (https://api.example.org -> wss://api.example.org/collab; a trailing /api is dropped).
 */
export function collabUrl(env = {}) {
  const explicit = String(env.VITE_COLLAB_URL || '').trim();
  if (explicit) return /^wss?:\/\//.test(explicit) ? explicit.replace(/\/+$/, '') : null;
  const api = String(env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(api)) return null;
  return `${api.replace(/^http/, 'ws').replace(/\/api$/, '')}/collab`;
}

const CURSOR_COLORS = ['#1D9E75', '#4FACFE', '#E67E22', '#9B59B6', '#E74C3C', '#16A085', '#D35400', '#2C3E50'];

/** A stable cursor colour per user, so everyone sees the same colour for the same person. */
export function cursorColor(uid = '') {
  let hash = 0;
  for (const ch of String(uid)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

/**
 * True when a ProseMirror transaction came from another user through Yjs. Only local
 * transactions count towards this student's edits, pastes and writing time.
 */
export function isRemoteTransaction(transaction) {
  return transaction?.getMeta?.(ySyncPluginKey)?.isChangeOrigin === true;
}

/** Parse a stateless message from the collab server; null for anything unexpected. */
export function parseServerMessage(payload) {
  try {
    const message = JSON.parse(payload);
    return message && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}

/**
 * The badge text for a live document (step 3.2):
 *   offline (server unreachable, editing the device copy) -> "Offline — saved on this device"
 *   online with changes not yet confirmed by the server  -> "Syncing…"
 */
export function syncLabel({ status, online = true, unsynced = 0 } = {}) {
  if (status === 'connecting') return 'Connecting to live editing…';
  if (status === 'offline' || (status === 'connected' && !online)) return 'Offline — saved on this device';
  if (status === 'connected') return unsynced > 0 ? 'Syncing…' : 'Live editing';
  return null;
}
