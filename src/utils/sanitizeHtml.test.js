import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { makeSanitizer } from './sanitizeHtml.js';
import { injectHighlightsIntoHtml } from './highlightHelpers.js';

const sanitize = makeSanitizer(new JSDOM('').window);

test('removes script tags and inline event handlers', () => {
  const out = sanitize('<p>Hi<script>alert(1)</script></p><p onclick="steal()">there</p><svg onload="x()"></svg>');
  assert.equal(out, '<p>Hi</p><p>there</p>');
});

test('drops images, so a stored <img onerror> cannot run or track the lecturer', () => {
  assert.equal(sanitize('<p>a<img src="x" onerror="alert(1)">b</p>'), '<p>ab</p>');
  assert.equal(sanitize('<img src="https://evil.example/pixel.gif">'), '');
});

test('removes javascript: and data: links but keeps https links, opened safely', () => {
  assert.equal(sanitize('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitize('<a href="data:text/html,<script>1</script>">x</a>'), '<a>x</a>');
  assert.equal(
    sanitize('<a href="https://rub.edu.bt">RUB</a>'),
    '<a href="https://rub.edu.bt" target="_blank" rel="noopener noreferrer nofollow">RUB</a>',
  );
});

test('removes iframes, forms, styles and other active content', () => {
  const out = sanitize('<iframe src="https://x"></iframe><form><input name="p"></form><style>*{}</style><object></object><p>ok</p>');
  assert.equal(out, '<p>ok</p>');
});

test('drops inline CSS that can load a URL, keeps harmless CSS', () => {
  assert.equal(sanitize('<p style="background:url(https://evil.example/x)">a</p>'), '<p>a</p>');
  assert.equal(sanitize('<p style="text-align: center">a</p>'), '<p style="text-align: center">a</p>');
});

test('keeps the formatting the editor produces: headings, lists, bold, italic, underline', () => {
  const html = '<h1>Title</h1><h2>Part</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s></p>'
    + '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><pre><code>c</code></pre>';
  assert.equal(sanitize(html), html);
});

test('keeps the report card highlight marks intact', () => {
  const html = injectHighlightsIntoHtml('<p>This sentence was pasted from somewhere.</p>', [
    { text: 'This sentence was pasted from somewhere.', type: 'plagiarism', authorName: 'Dorji W' },
  ]);
  assert.match(html, /<mark /);
  assert.equal(sanitize(html), html);
});

test('treats null and undefined as empty', () => {
  assert.equal(sanitize(null), '');
  assert.equal(sanitize(undefined), '');
});
