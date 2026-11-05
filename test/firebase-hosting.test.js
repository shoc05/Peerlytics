// The production website's security headers (docs/release-check.md check 14).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { hosting } = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const headerNames = (rule) => rule.headers.map((h) => h.key);

test('every page says not to guess content types and limits the referrer', () => {
  const everywhere = hosting.headers.find((rule) => rule.source === '**');
  assert.deepEqual(headerNames(everywhere).sort(), ['Referrer-Policy', 'X-Content-Type-Options']);
});

test('framing is refused everywhere except Firebase Auth, which runs in a frame', () => {
  const rule = hosting.headers.find((r) => headerNames(r).includes('X-Frame-Options'));
  assert.equal(rule.source, '!/__/**');
  assert.equal(rule.headers[0].value, 'DENY');
});
