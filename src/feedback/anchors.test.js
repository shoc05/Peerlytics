import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createAnchor, resolveAnchor, textIndex } from './anchors.js';

const schema = getSchema([StarterKit]);
const doc = (...paragraphs) =>
  schema.nodeFromJSON({
    type: 'doc',
    content: paragraphs.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
  });

test('an anchor finds the same words again', () => {
  const text = 'Hydropower supplies most of Bhutan. It also earns export income.';
  const a = createAnchor(text, 28, 34);
  assert.equal(a.exact, 'Bhutan');
  assert.deepEqual(resolveAnchor(text, a), { start: 28, end: 34 });
});

test('repeated words: the surrounding text picks the right one', () => {
  const text = 'The river is cold. Later the river is warm.';
  const second = createAnchor(text, 29, 34); // the second "river"
  assert.equal(second.exact, 'river');
  assert.deepEqual(resolveAnchor(text, second), { start: 29, end: 34 });
  const first = createAnchor(text, 4, 9);
  assert.deepEqual(resolveAnchor(text, first), { start: 4, end: 9 });
});

test('empty, whitespace-only and missing quotes', () => {
  assert.equal(createAnchor('abc', 1, 1), null);
  assert.equal(createAnchor('a   b', 1, 4), null);
  assert.equal(resolveAnchor('nothing here', { exact: 'gone', prefix: '', suffix: '' }), null);
  assert.equal(resolveAnchor('x', null), null);
});

test('text offsets and editor positions convert both ways across paragraphs', () => {
  const d = doc('First line.', 'Second line here.');
  const index = textIndex(d);
  assert.equal(index.text, 'First line.\n\nSecond line here.');
  const start = index.text.indexOf('line here');
  const range = index.toPositions(start, start + 'line here'.length);
  assert.equal(d.textBetween(range.from, range.to), 'line here');
  assert.deepEqual(index.toOffsets(range.from, range.to), { start, end: start + 9 });
  assert.equal(index.toPositions(5, 5), null);
});
