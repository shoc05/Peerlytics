// Small pure helpers for live editing (step 2.2). Kept free of React and the network so
// they run under node:test.
import { ySyncPluginKey } from 'y-prosemirror';

// The editor's Yjs fragment. Must match FIELD in collab/src/server.js.
export const COLLAB_FIELD = 'default';

/** Same format as collab/src/access.js. */
export function documentName(groupId, fileId) {
  return `group:${groupId}:file:${fileId}`;
}

/** The collab server's WebSocket URL from VITE_COLLAB_URL, or null when not configured. */
export function collabUrl(env = {}) {
  const url = String(env.VITE_COLLAB_URL || '').trim();
  return /^wss?:\/\//.test(url) ? url.replace(/\/+$/, '') : null;
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
