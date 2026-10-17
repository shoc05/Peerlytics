// useTrackingQueue — sends writing-time, edit, paste and version events, queuing them on the
// device while offline (step 3.2). With offline_enabled off it sends straight away, exactly
// as before. `senders` maps each kind to the Firestore write: senders[kind](payload, at).
import { useEffect, useMemo, useRef } from 'react';
import { createTrackingQueue } from './trackingQueue';

const RETRY_MS = 15000;

export function useTrackingQueue({ enabled, uid, isOnline, senders }) {
  // Latest values without re-creating the queue on every render.
  const live = useRef({ isOnline, senders });
  live.current = { isOnline, senders };

  const queue = useMemo(() => {
    if (!enabled || !uid) return null;
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }
    return createTrackingQueue({
      storage,
      key: `peerlytics-tracking-queue:${uid}`,
      send: ({ kind, payload, at }) => live.current.senders[kind](payload, at),
      isOnline: () => navigator.onLine !== false && live.current.isOnline(),
    });
  }, [enabled, uid]);

  useEffect(() => {
    if (!queue) return undefined;
    const flush = () => queue.flush();
    flush();
    window.addEventListener('online', flush);
    const timer = setInterval(flush, RETRY_MS);
    return () => {
      window.removeEventListener('online', flush);
      clearInterval(timer);
    };
  }, [queue]);

  return useMemo(
    () => ({
      track: (kind, payload) =>
        queue ? queue.track(kind, payload) : Promise.resolve(live.current.senders[kind](payload, Date.now())),
    }),
    [queue]
  );
}
