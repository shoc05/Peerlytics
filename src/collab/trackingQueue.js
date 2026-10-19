// Tracking events made while offline (step 3.2): writing time, edit counts, paste events and
// versions are kept on the device and sent when the connection is back, each with the time
// it really happened. Only what the privacy notice allows is queued — never keystrokes.
//
// createTrackingQueue({ storage, key, send, isOnline, now })
//   storage:  { getItem, setItem, removeItem } (localStorage in the browser)
//   send(event) -> Promise; event = { kind, payload, at }
//   track(kind, payload): send now when online, otherwise queue
//   flush(): send everything queued, oldest first; stops at the first failure

export const MAX_QUEUED = 2000;

function read(storage, key) {
  try {
    const list = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(storage, key, list) {
  try {
    if (list.length) storage.setItem(key, JSON.stringify(list));
    else storage.removeItem(key);
  } catch {
    /* storage full or blocked: the events stay in memory for this session */
  }
}

/** Metric increments ({ groupId, edits, timeSpent }) for the same group next to each other merge. */
function append(list, event, inFlight) {
  const last = list[list.length - 1];
  if (event.kind === 'metric' && last?.kind === 'metric' && last !== inFlight && last.payload.groupId === event.payload.groupId) {
    const merged = { ...last.payload };
    for (const [k, v] of Object.entries(event.payload)) {
      if (typeof v === 'number') merged[k] = (merged[k] || 0) + v;
    }
    return [...list.slice(0, -1), { ...last, payload: merged }];
  }
  return [...list, event].slice(-MAX_QUEUED);
}

export function createTrackingQueue({ storage, key, send, isOnline = () => true, now = Date.now }) {
  let memory = read(storage, key);
  let flushing = null;
  let inFlight = null; // the event being sent right now: never merge into it

  const save = (list) => {
    memory = list;
    write(storage, key, list);
  };

  const enqueue = (event) => save(append(memory, event, inFlight));

  async function track(kind, payload) {
    const event = { kind, payload, at: now() };
    // Anything already queued goes first, so the order is kept.
    if (isOnline() && !memory.length) {
      try {
        await send(event);
        return 'sent';
      } catch {
        enqueue(event);
        return 'queued';
      }
    }
    enqueue(event);
    if (isOnline()) flush();
    return 'queued';
  }

  async function flush() {
    // A flush asked for during another one runs again afterwards, so nothing new is missed.
    if (flushing) return flushing.then(() => flush());
    flushing = (async () => {
      let sent = 0;
      while (memory.length && isOnline()) {
        inFlight = memory[0];
        try {
          await send(inFlight);
        } catch {
          break;
        } finally {
          inFlight = null;
        }
        save(memory.slice(1));
        sent += 1;
      }
      return sent;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  return { track, flush, pending: () => memory.length };
}
