import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskEmail, maskEmailsIn } from './maskEmail.js';

test('keeps the first letter and the domain, hides the rest', () => {
  assert.equal(maskEmail('sonam.dorji@rub.edu.bt'), 's**********@rub.edu.bt');
});

test('a one-letter name is still masked', () => {
  assert.equal(maskEmail('k@cst.edu.bt'), 'k*@cst.edu.bt');
});

test('missing or malformed input never reveals the value', () => {
  assert.equal(maskEmail(undefined), '');
  assert.equal(maskEmail(''), '');
  assert.equal(maskEmail('not-an-email'), '***');
  assert.equal(maskEmail('@rub.edu.bt'), '***');
});

test('masks every address inside a log line or SMTP error', () => {
  const line = '550 Recipient <tshering@rub.edu.bt> rejected; cc pema@gmail.com';
  const masked = maskEmailsIn(line);
  assert.equal(masked, '550 Recipient <t*******@rub.edu.bt> rejected; cc p***@gmail.com');
  assert.ok(!masked.includes('tshering@'));
  assert.ok(!masked.includes('pema@'));
});

test('text without addresses is unchanged', () => {
  assert.equal(maskEmailsIn('sweep failed: timeout'), 'sweep failed: timeout');
  assert.equal(maskEmailsIn(undefined), '');
});
