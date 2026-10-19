import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { reportTabs } from './reportTabs.js';

const TEXT = 'Introduction\nRivers matter.\n\nMethod\nWe asked ten villages.';
const TABS = [
  { id: 'default', title: 'Introduction', depth: 0, wordCount: 2 },
  { id: 'k3j2', title: 'Method', depth: 0, wordCount: 4 },
];
let analyzeSubmission;

before(async () => {
  delete process.env.HF_API_KEY;
  delete process.env.VWT_API_KEY;
  ({ analyzeSubmission } = await import('../../routes/check.js'));
});

test('valid tab lists are kept, extra fields dropped', () => {
  assert.deepEqual(reportTabs([{ ...TABS[0], html: '<p>x</p>' }]), [TABS[0]]);
});

test('missing or invalid tab lists become null instead of failing', () => {
  assert.equal(reportTabs(undefined), null);
  assert.equal(reportTabs([]), null);
  assert.equal(reportTabs('tabs'), null);
  assert.equal(reportTabs([{ id: 'a', title: '', depth: 0, wordCount: 1 }]), null);
  assert.equal(reportTabs([{ id: 'a', title: 'x', depth: 7, wordCount: 1 }]), null);
  assert.equal(reportTabs(Array.from({ length: 51 }, (_, i) => ({ id: `t${i}`, title: 't', depth: 0, wordCount: 0 }))), null);
});

test('/api/check keeps tab titles on the report', async () => {
  const { report } = await analyzeSubmission({ text: TEXT, userId: 'u', fileId: 'f', groupId: 'g', fileName: 'Doc', tabs: TABS });
  assert.deepEqual(report.tabs, TABS);
  const plain = await analyzeSubmission({ text: TEXT, userId: 'u', fileId: 'f', groupId: 'g', fileName: 'Doc', tabs: 'junk' });
  assert.equal('tabs' in plain.report, false);
});
