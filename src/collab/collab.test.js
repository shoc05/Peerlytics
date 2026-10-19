import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ySyncPluginKey } from 'y-prosemirror';
import { collabUrl, cursorColor, documentName, isRemoteTransaction, parseServerMessage, syncLabel } from './collab.js';

test('document names match the collab server', () => {
  assert.equal(documentName('group-1', 'file-2'), 'group:group-1:file:file-2');
});

test('collabUrl accepts ws/wss only and trims trailing slashes', () => {
  assert.equal(collabUrl({ VITE_COLLAB_URL: 'wss://collab.example.org/' }), 'wss://collab.example.org');
  assert.equal(collabUrl({ VITE_COLLAB_URL: 'ws://localhost:1234' }), 'ws://localhost:1234');
  assert.equal(collabUrl({ VITE_COLLAB_URL: 'http://localhost:1234' }), null);
  assert.equal(collabUrl({}), null);
});

test('cursor colours are stable per user', () => {
  assert.equal(cursorColor('uid-1'), cursorColor('uid-1'));
  assert.match(cursorColor(''), /^#[0-9A-F]{6}$/i);
});

test('only transactions from Yjs count as remote', () => {
  const tr = (meta) => ({ getMeta: (key) => (key === ySyncPluginKey ? meta : undefined) });
  assert.equal(isRemoteTransaction(tr({ isChangeOrigin: true })), true);
  assert.equal(isRemoteTransaction(tr({ isChangeOrigin: false })), false);
  assert.equal(isRemoteTransaction(tr(undefined)), false);
  assert.equal(isRemoteTransaction(undefined), false);
});

test('server messages: JSON with a type, or null', () => {
  assert.deepEqual(parseServerMessage('{"type":"seed"}'), { type: 'seed' });
  assert.equal(parseServerMessage('not json'), null);
  assert.equal(parseServerMessage('{"kind":"x"}'), null);
});

test('sync badge text', () => {
  assert.equal(syncLabel({ status: 'offline', online: false }), 'Offline — saved on this device');
  assert.equal(syncLabel({ status: 'connected', online: false }), 'Offline — saved on this device');
  assert.equal(syncLabel({ status: 'connected', online: true, unsynced: 2 }), 'Syncing…');
  assert.equal(syncLabel({ status: 'connected', online: true, unsynced: 0 }), 'Live editing');
  assert.equal(syncLabel({ status: 'connecting', online: false }), 'Connecting to live editing…');
  assert.equal(syncLabel({ status: 'off' }), null);
});
