// useCollab: connect one workspace file to the collab server (step 2.2, behind yjs_enabled).
//
// status: 'off'         live editing not in use (flag off, not a document, not configured)
//         'connecting'  waiting for the first sync; the editor stays read-only meanwhile
//         'connected'   live; edits go through Yjs
//         'unavailable' no sync within CONNECT_TIMEOUT_MS: fall back to the old sync
//         'refused'     the server said no (not a member, not submitted yet, bad token)
// Callers use the live editor only while status is 'connecting' or 'connected'.
import { useEffect, useState } from 'react';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { getFirebaseAuth } from '../firebase/config';
import { logger } from '../utils/logger';
import { collabUrl, cursorColor, documentName, parseServerMessage } from './collab';

export const CONNECT_TIMEOUT_MS = 8000;
const OFF = { status: 'off' };

export function useCollab({ enabled, groupId, fileId, user, loadSeedHtml }) {
  const [state, setState] = useState(OFF);
  const url = collabUrl(import.meta.env);
  const uid = user?.uid;
  const name = user?.name || user?.displayName || 'Member';

  useEffect(() => {
    if (!enabled || !groupId || !fileId || !uid || !url) {
      setState(OFF);
      return undefined;
    }

    let synced = false;
    let pendingSeed = false;
    const seedListeners = new Set();
    const update = (patch) => setState((s) => (s.ydoc === ydoc ? { ...s, ...patch } : s));

    const ydoc = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({ url });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: documentName(groupId, fileId),
      document: ydoc,
      // Called on every (re)connect, so an expired token is refreshed by the SDK.
      token: async () => (await getFirebaseAuth()?.currentUser?.getIdToken()) || '',
      onSynced: () => {
        synced = true;
        update({ status: 'connected', synced: true });
      },
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

    const timer = setTimeout(() => {
      if (!synced) update({ status: 'unavailable' });
    }, CONNECT_TIMEOUT_MS);

    setState({
      status: 'connecting',
      synced: false,
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
      provider.destroy();
      websocketProvider.destroy();
      ydoc.destroy();
    };
    // loadSeedHtml is read once per connection on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, groupId, fileId, uid, name, url]);

  return state;
}

/** The collab object to hand to the editor, or null to use the old sync. */
export function liveCollab(state) {
  return state.status === 'connecting' || state.status === 'connected' ? state : null;
}
