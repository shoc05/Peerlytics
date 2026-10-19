// useCollab: connect one workspace file to the collab server (step 2.2, behind yjs_enabled),
// optionally keeping a copy on the device for offline editing (step 3.2, offline_enabled).
//
// status: 'off'         live editing not in use (flag off, not a document, not configured)
//         'connecting'  waiting for content; the editor stays read-only meanwhile
//         'connected'   synced with the server at least once this session
//         'offline'     server not reached yet, editing the copy saved on this device;
//                       changes merge when the connection comes back
//         'unavailable' nothing to edit within CONNECT_TIMEOUT_MS: fall back to the old sync
//         'refused'     the server said no (not a member, not submitted yet, bad token)
// Also: synced (content is loaded, so the editor may edit), online (socket connected),
// unsynced (local changes the server hasn't confirmed). Callers use the live editor only
// while liveCollab(state) is non-null.
import { useEffect, useState } from 'react';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { getFirebaseAuth } from '../firebase/config';
import { logger } from '../utils/logger';
import { collabUrl, cursorColor, documentName, parseServerMessage } from './collab';

export const CONNECT_TIMEOUT_MS = 8000;
const OFF = { status: 'off' };

export function useCollab({ enabled, offline = false, groupId, fileId, user, loadSeedHtml }) {
  const [state, setState] = useState(OFF);
  const url = collabUrl(import.meta.env);
  const uid = user?.uid;
  const name = user?.name || user?.displayName || 'Member';

  useEffect(() => {
    if (!enabled || !groupId || !fileId || !uid || !url) {
      setState(OFF);
      return undefined;
    }

    let serverSynced = false;
    let localReady = false;
    let pendingSeed = false;
    const seedListeners = new Set();
    const docName = documentName(groupId, fileId);
    const ydoc = new Y.Doc();
    const update = (patch) => setState((s) => (s.ydoc === ydoc ? { ...s, ...patch } : s));

    const websocketProvider = new HocuspocusProviderWebsocket({ url });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: docName,
      document: ydoc,
      // Called on every (re)connect, so an expired token is refreshed by the SDK.
      token: async () => (await getFirebaseAuth()?.currentUser?.getIdToken()) || '',
      onSynced: () => {
        serverSynced = true;
        update({ status: 'connected', synced: true });
      },
      onStatus: ({ status }) => update({ online: status === 'connected' }),
      onAuthenticationFailed: ({ reason }) => {
        logger.warn('[collab] refused:', reason);
        update({ status: 'refused', reason });
      },
      onStateless: ({ payload }) => {
        if (parseServerMessage(payload)?.type !== 'seed') return;
        if (seedListeners.size) seedListeners.forEach((fn) => fn());
        else pendingSeed = true;
      },
    });
    const onUnsynced = (unsynced) => update({ unsynced });
    provider.on('unsyncedChanges', onUnsynced);

    // Offline: the device copy (IndexedDB). Editing it before the server answers is allowed
    // only when it came from an earlier visit; a first visit needs the server (and its
    // one-time seed), so nothing typed offline can hide the document's existing text.
    const local = offline ? new IndexeddbPersistence(`peerlytics:${uid}:${docName}`, ydoc) : null;
    local?.on('synced', () => {
      if (serverSynced || ydoc.store.clients.size === 0) return;
      localReady = true;
      update({ status: 'offline', synced: true });
    });

    const timer = setTimeout(() => {
      if (!serverSynced && !localReady) update({ status: 'unavailable' });
    }, CONNECT_TIMEOUT_MS);

    setState({
      status: 'connecting',
      synced: false,
      online: false,
      unsynced: 0,
      ydoc,
      provider,
      user: { name, color: cursorColor(uid) },
      loadSeedHtml,
      // The editor subscribes here; a seed request that came before it is replayed.
      onSeed(fn) {
        seedListeners.add(fn);
        if (pendingSeed) {
          pendingSeed = false;
          fn();
        }
        return () => seedListeners.delete(fn);
      },
    });

    return () => {
      clearTimeout(timer);
      provider.off('unsyncedChanges', onUnsynced);
      provider.destroy();
      websocketProvider.destroy();
      local?.destroy();
      ydoc.destroy();
    };
    // loadSeedHtml is read once per connection on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, offline, groupId, fileId, uid, name, url]);

  return state;
}

/** The collab object to hand to the editor, or null to use the old sync. */
export function liveCollab(state) {
  return ['connecting', 'connected', 'offline'].includes(state.status) ? state : null;
}
