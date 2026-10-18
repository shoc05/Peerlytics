import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  addTab, DEFAULT_TAB_ID, deleteTab, ensureTabs, exportTabs, fragmentName, listTabs, MAX_TABS,
  moveTab, renameTab, tabFragment,
} from './tabs.js';

const titles = (doc) => listTabs(doc).map((t) => `${'  '.repeat(t.depth)}${t.title}`);

// Two replicas that exchange every update, like two browsers on the collab server.
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u, origin) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote'));
  b.on('update', (u, origin) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote'));
  return [a, b];
}

function write(doc, tabId, text) {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  tabFragment(doc, tabId).push([p]);
}

const serialize = (fragment) => {
  const text = fragment.toArray().map((p) => p.toArray().map((t) => t.toString()).join('')).join('\n');
  return { html: text ? `<p>${text}</p>` : '', text };
};

test('a document written before tabs is "Tab 1" on the default fragment', () => {
  const doc = new Y.Doc();
  write(doc, DEFAULT_TAB_ID, 'Old text');
  assert.deepEqual(listTabs(doc), [{ id: 'default', title: 'Tab 1', parentId: null, order: 0, depth: 0 }]);
  assert.equal(fragmentName(DEFAULT_TAB_ID), 'default');
  ensureTabs(doc);
  assert.equal(listTabs(doc).length, 1);
  assert.equal(exportTabs(doc, serialize).text, 'Old text');
});

test('each tab has its own fragment', () => {
  const doc = new Y.Doc();
  const id = addTab(doc, { title: 'Method' });
  assert.equal(fragmentName(id), `tab:${id}`);
  write(doc, id, 'Method text');
  write(doc, DEFAULT_TAB_ID, 'Intro text');
  assert.equal(serialize(tabFragment(doc, id)).text, 'Method text');
  assert.equal(serialize(tabFragment(doc, DEFAULT_TAB_ID)).text, 'Intro text');
});

test('add, rename, nest and reorder are synced live to the other member', () => {
  const [a, b] = pair();
  const method = addTab(a, { title: 'Method' });
  const results = addTab(b, { title: 'Results' });
  const sample = addTab(a, { title: 'Sample', parentId: method });
  renameTab(b, DEFAULT_TAB_ID, '  Introduction  ');
  assert.deepEqual(titles(a), ['Introduction', 'Method', '  Sample', 'Results']);
  assert.deepEqual(titles(b), titles(a));

  moveTab(b, results, { parentId: null, index: 0 });
  assert.deepEqual(titles(a), ['Results', 'Introduction', 'Method', '  Sample']);
  moveTab(a, sample, { parentId: results, index: 0 });
  assert.deepEqual(titles(b), ['Results', '  Sample', 'Introduction', 'Method']);
});

test('two members opening a new document at once still get one "Tab 1"', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  ensureTabs(a);
  ensureTabs(b);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.deepEqual(titles(a), ['Tab 1']);
  assert.deepEqual(titles(b), ['Tab 1']);
});

test('deleting a tab removes its sub-tabs and their text; the last tab stays', () => {
  const doc = new Y.Doc();
  const method = addTab(doc, { title: 'Method' });
  const sample = addTab(doc, { title: 'Sample', parentId: method });
  write(doc, method, 'm');
  write(doc, sample, 's');
  assert.deepEqual(deleteTab(doc, method).sort(), [method, sample].sort());
  assert.deepEqual(titles(doc), ['Tab 1']);
  assert.equal(tabFragment(doc, method).length, 0);
  assert.equal(tabFragment(doc, sample).length, 0);
  assert.throws(() => deleteTab(doc, DEFAULT_TAB_ID), /at least one tab/);
  assert.deepEqual(deleteTab(doc, 'gone'), []);
});

test('a sub-tab whose parent another member deleted moves to the top level', () => {
  const b = new Y.Doc();
  const method = addTab(b, { title: 'Method' });
  // Two copies that are offline from each other while this happens.
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(b));
  deleteTab(b, method);
  addTab(c, { title: 'Late sub-tab', parentId: method });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(c));
  assert.deepEqual(titles(b), ['Tab 1', 'Late sub-tab']);
});

test('guards: titles, nesting depth, cycles, tab count', () => {
  const doc = new Y.Doc();
  assert.throws(() => addTab(doc, { title: '   ' }), /needs a title/);
  assert.throws(() => renameTab(doc, 'nope', 'x'), /no longer exists/);
  const l1 = addTab(doc, { title: 'L1' });
  const l2 = addTab(doc, { title: 'L2', parentId: l1 });
  const l3 = addTab(doc, { title: 'L3', parentId: l2 });
  assert.throws(() => addTab(doc, { title: 'L4', parentId: l3 }), /3 levels/);
  assert.throws(() => moveTab(doc, l1, { parentId: l3 }), /inside itself/);
  const other = addTab(doc, { title: 'Other' });
  assert.throws(() => moveTab(doc, l1, { parentId: other }), /3 levels/); // Other > L1 > L2 > L3
  moveTab(doc, l2, { parentId: other }); // Other > L2 > L3: three levels, fine
  assert.equal(addTab(doc, { title: 'x'.repeat(300) }).length > 0, true);
  assert.equal(listTabs(doc).at(-1).title.length, 100);
  while (listTabs(doc).length < MAX_TABS) addTab(doc, { title: 'more' });
  assert.throws(() => addTab(doc, { title: 'one too many' }), /at most 50/);
});

test('export keeps tab titles for saving, analysis and the report', () => {
  const doc = new Y.Doc();
  renameTab(doc, DEFAULT_TAB_ID, 'Intro & aims');
  const method = addTab(doc, { title: 'Method' });
  const sample = addTab(doc, { title: 'Sample', parentId: method });
  write(doc, DEFAULT_TAB_ID, 'We study rivers.');
  write(doc, sample, 'Ten villages.');
  const out = exportTabs(doc, serialize);
  assert.equal(
    out.html,
    '<h1 data-tab-id="default">Intro &amp; aims</h1><p>We study rivers.</p>' +
      `<h1 data-tab-id="${method}">Method</h1>` +
      `<h2 data-tab-id="${sample}">Sample</h2><p>Ten villages.</p>`
  );
  assert.equal(out.text, 'Intro & aims\nWe study rivers.\n\nMethod\n\nSample\nTen villages.');
  assert.deepEqual(out.tabs, [
    { id: 'default', title: 'Intro & aims', depth: 0, wordCount: 3 },
    { id: method, title: 'Method', depth: 0, wordCount: 0 },
    { id: sample, title: 'Sample', depth: 1, wordCount: 2 },
  ]);
});
