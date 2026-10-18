import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import * as Y from 'yjs';
import { addTab, DEFAULT_TAB_ID, renameTab, tabFragment } from './tabs.js';
import { exportDocument } from './tabsExport.js';

// HTML serialising needs a DOM; the browser has one, node:test gets happy-dom.
globalThis.window = new Window();
globalThis.document = globalThis.window.document;

const schema = getSchema([StarterKit]);
const paragraphs = (...texts) => ({
  type: 'doc',
  content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
});

test('every tab is exported with the real editor schema, titles first', () => {
  const doc = new Y.Doc();
  renameTab(doc, DEFAULT_TAB_ID, 'Introduction');
  const method = addTab(doc, { title: 'Method' });
  prosemirrorJSONToYXmlFragment(schema, paragraphs('Rivers matter.'), tabFragment(doc, DEFAULT_TAB_ID));
  prosemirrorJSONToYXmlFragment(schema, paragraphs('We asked ten villages.', 'Then we measured.'), tabFragment(doc, method));

  const out = exportDocument(doc, schema);
  assert.equal(
    out.html,
    '<h1 data-tab-id="default">Introduction</h1><p>Rivers matter.</p>' +
      `<h1 data-tab-id="${method}">Method</h1><p>We asked ten villages.</p><p>Then we measured.</p>`
  );
  assert.equal(out.text, 'Introduction\nRivers matter.\n\nMethod\nWe asked ten villages.\n\nThen we measured.');
  assert.deepEqual(out.tabs.map((t) => [t.title, t.wordCount]), [['Introduction', 2], ['Method', 7]]);
});

test('a single-tab document exports exactly like the editor did before tabs', () => {
  const doc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(schema, paragraphs('Just text.'), tabFragment(doc, DEFAULT_TAB_ID));
  const out = exportDocument(doc, schema);
  assert.equal(out.html, '<p>Just text.</p>');
  assert.equal(out.text, 'Just text.');
});
