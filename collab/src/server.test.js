// The real Hocuspocus server with real providers over WebSockets. Firebase is replaced by
// fakes (verifyToken / loadGroup / loadFile) and storage is in memory.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { documentName } from './access.js';
import { createCollabServer, FIELD } from './server.js';
import { createMemoryStorage } from './storage.js';
import { createCollabMetrics } from './metrics.js';
import { Registry } from 'prom-client';

const TOKENS = {
  'tok-a': { uid: 'stu-a', role: 'student' },
  'tok-b': { uid: 'stu-b', role: 'student' },
  'tok-out': { uid: 'outsider', role: 'student' },
  'tok-lec': { uid: 'lec', role: 'lecturer' },
};
const DOC = documentName('g1', 'f1');

let world;
const open = [];

function makeWorld({ group = {}, file = {}, storage = createMemoryStorage() } = {}) {
  return {
    storage,
    group: { memberIds: ['stu-a', 'stu-b'], lecturerIds: ['lec'], submittedToLecturers: [], ...group },
    file: { name: 'Report', submitted: false, ...file },
  };
}

async function start(w) {
  world = w;
  const server = createCollabServer({
    verifyToken: async (token) => {
      if (!TOKENS[token]) throw new Error('bad token');
      return TOKENS[token];
    },
    loadGroup: async (id) => (id === 'g1' ? world.group : null),
    loadFile: async (gid, fid) => (gid === 'g1' && fid === 'f1' ? world.file : null),
    storage: w.storage,
    port: 0,
    address: '127.0.0.1',
    debounce: 50,
    timeout: 1000,
    log: { info() {}, error() {} },
    metrics: createCollabMetrics({ registry: new Registry() }),
  });
  await server.listen();
  open.push(server);
  return server;
}

function connect(server, token, { name = DOC, onStateless } = {}) {
  const document = new Y.Doc();
  // An explicit socket: provider.destroy() doesn't close one the provider made itself.
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${server.port}`,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name,
    document,
    token,
    ...(onStateless ? { onStateless: ({ payload }) => onStateless(payload) } : {}),
  });
  const close = () => {
    provider.destroy();
    websocketProvider.destroy();
  };
  open.push({ close });
  const ready = new Promise((resolve, reject) => {
    provider.on('synced', () => resolve(provider));
    provider.on('authenticationFailed', ({ reason }) => reject(new Error(reason)));
  });
  return { document, provider, ready, close };
}

const paragraphText = (doc) => {
  const fragment = doc.getXmlFragment(FIELD);
  return fragment.length ? fragment.get(0).get(0).toString() : '';
};

async function until(check, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

afterEach(async () => {
  while (open.length) {
    const item = open.pop();
    if (item.close) item.close();
    else await item.destroy();
  }
});

test('/health answers 200; other paths 404', async () => {
  const server = await start(makeWorld());
  const health = await fetch(`http://127.0.0.1:${server.port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'peerlytics-collab' });
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/anything`)).status, 404);
});

test('two students typing in the same sentence lose nothing, and the result is stored', async () => {
  const w = makeWorld();
  const server = await start(w);
  const a = connect(server, 'tok-a');
  const b = connect(server, 'tok-b');
  await Promise.all([a.ready, b.ready]);

  // A writes the sentence; both see it.
  a.document.transact(() => {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('The river runs  today.')]);
    a.document.getXmlFragment(FIELD).insert(0, [p]);
  });
  await until(() => paragraphText(b.document) === 'The river runs  today.');

  // Both type into the same gap at the same time, one character at a time, without
  // waiting for each other. Each keeps a cursor right after its own last character, as
  // the editor does (a Yjs relative position), so remote text doesn't move it.
  const textOf = (doc) => doc.getXmlFragment(FIELD).get(0).get(0);
  const at = 'The river runs '.length;
  const typist = (doc) => {
    let cursor = null;
    return (ch) => {
      const text = textOf(doc);
      const index = cursor ? Y.createAbsolutePositionFromRelativePosition(cursor, doc).index : at;
      text.insert(index, ch);
      cursor = Y.createRelativePositionFromTypeIndex(text, index + 1, -1);
    };
  };
  const wordA = 'fast';
  const wordB = 'deep';
  const typeA = typist(a.document);
  const typeB = typist(b.document);
  for (let i = 0; i < 4; i += 1) {
    typeA(wordA[i]);
    typeB(wordB[i]);
    await new Promise((r) => setImmediate(r));
  }

  await until(() => paragraphText(a.document) === paragraphText(b.document) && paragraphText(a.document).length === 30);
  const final = paragraphText(a.document);
  assert.ok(final.includes(wordA), final);
  assert.ok(final.includes(wordB), final);
  assert.ok(final.startsWith('The river runs ') && final.endsWith(' today.'), final);

  // Stored for the next session, and a new connection after a restart gets it back.
  await until(() => {
    const stored = w.storage.docs.get(DOC);
    if (!stored) return false;
    const copy = new Y.Doc();
    Y.applyUpdate(copy, stored);
    return paragraphText(copy) === final;
  });
  for (const client of [a, b]) {
    client.close();
    open.splice(open.findIndex((item) => item.close === client.close), 1);
  }
  await server.destroy();
  open.splice(open.indexOf(server), 1);
  const restarted = await start(w);
  const c = connect(restarted, 'tok-a');
  await c.ready;
  assert.equal(paragraphText(c.document), final);
});

test('refused: bad token, outsider, lecturer before submission, unknown document', async () => {
  const server = await start(makeWorld());
  await assert.rejects(connect(server, 'tok-forged').ready, /TOKEN_INVALID|permission/i);
  await assert.rejects(connect(server, 'tok-out').ready, /NOT_A_MEMBER|permission/i);
  await assert.rejects(connect(server, 'tok-lec').ready, /NOT_SUBMITTED|permission/i);
  await assert.rejects(connect(server, 'tok-a', { name: 'group:g1:file:nope' }).ready, /NO_FILE|permission/i);
  await assert.rejects(connect(server, 'tok-a', { name: 'somewhere/else' }).ready, /BAD_DOCUMENT|permission/i);
});

test('after submission a lecturer reads live but cannot change anything', async () => {
  const server = await start(makeWorld({ group: { submittedToLecturers: ['lec'] } }));
  const student = connect(server, 'tok-a');
  await student.ready;
  student.document.getXmlFragment(FIELD).insert(0, [new Y.XmlElement('paragraph')]);
  student.document.getXmlFragment(FIELD).get(0).insert(0, [new Y.XmlText('Student text')]);

  const lec = connect(server, 'tok-lec');
  await lec.ready;
  await until(() => paragraphText(lec.document) === 'Student text');

  lec.document.getXmlFragment(FIELD).get(0).get(0).insert(0, 'LECTURER ');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(paragraphText(student.document), 'Student text');
});

test('a submitted file or a locked workspace is read-only for students too', async () => {
  for (const w of [makeWorld({ file: { submitted: true } }), makeWorld({ group: { locked: true } })]) {
    const server = await start(w);
    const a = connect(server, 'tok-a');
    const b = connect(server, 'tok-b');
    await Promise.all([a.ready, b.ready]);
    a.document.getXmlFragment(FIELD).insert(0, [new Y.XmlElement('paragraph')]);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(b.document.getXmlFragment(FIELD).length, 0);
    await server.destroy();
    open.splice(open.indexOf(server), 1);
  }
});

test('an empty document asks exactly one writer to seed it from the old Firestore text', async () => {
  const server = await start(makeWorld());
  const seen = { a: 0, b: 0 };
  const a = connect(server, 'tok-a', { onStateless: () => (seen.a += 1) });
  await a.ready;
  const b = connect(server, 'tok-b', { onStateless: () => (seen.b += 1) });
  await b.ready;
  await until(() => seen.a === 1);
  assert.equal(seen.b, 0);

  // A leaves without seeding: B is asked instead.
  a.close();
  await until(() => seen.b === 1);
});

test('edits made offline merge with everyone else\'s when the connection comes back (step 3.2)', async () => {
  const server = await start(makeWorld());
  const a = connect(server, 'tok-a');
  const b = connect(server, 'tok-b');
  await Promise.all([a.ready, b.ready]);
  a.document.transact(() => {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Shared start.')]);
    a.document.getXmlFragment(FIELD).insert(0, [p]);
  });
  await until(() => paragraphText(b.document) === 'Shared start.');

  // A goes offline and keeps writing; B writes at the same time.
  a.provider.disconnect();
  const textOf = (doc) => doc.getXmlFragment(FIELD).get(0).get(0);
  textOf(a.document).insert(textOf(a.document).length, ' Written offline.');
  textOf(b.document).insert(0, 'Online: ');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(paragraphText(b.document), 'Online: Shared start.');

  await a.provider.connect();
  const merged = 'Online: Shared start. Written offline.';
  await until(() => paragraphText(a.document) === merged && paragraphText(b.document) === merged);
});

test('/metrics reports connections, refusals and open documents', async () => {
  const server = await start(makeWorld());
  const a = connect(server, 'tok-a');
  await a.ready;
  await assert.rejects(connect(server, 'tok-out').ready);
  const res = await fetch(`http://127.0.0.1:${server.port}/metrics`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /collab_connections_total\{app="peerlytics-collab"\} 1/);
  assert.match(body, /collab_active_connections\{app="peerlytics-collab"\} 1/);
  assert.match(body, /collab_open_documents\{app="peerlytics-collab"\} 1/);
  assert.match(body, /collab_auth_refused_total\{reason="NOT_A_MEMBER",app="peerlytics-collab"\} 1/);
});
