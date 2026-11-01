import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAuthorMetrics, countWords } from './postgres.js';

describe('countWords', () => {
  test('counts words separated by any whitespace', () => {
    assert.equal(countWords('  One two\nthree\tfour  '), 4);
    assert.equal(countWords(''), 0);
    assert.equal(countWords('   '), 0);
    assert.equal(countWords(undefined), 0);
  });
});

describe('buildAuthorMetrics', () => {
  test('gives every member counts from their analytics and their own pastes', () => {
    const analytics = [
      { id: 'stu1', timeSpent: 12.5, edits: 40, tabEdits: { intro: 30, method: 10 } },
      { id: 'other', uid: 'stu2', edits: 3.6 },
    ];
    const pastes = [
      { userId: 'stu1', changeType: 'paste' },
      { userId: 'stu1', changeType: 'paste-large' },
      { userId: 'outsider', changeType: 'paste-large' },
    ];
    assert.deepEqual(buildAuthorMetrics(['stu1', 'stu2', 'stu3'], analytics, pastes), {
      stu1: { timeSpentSec: 750, edits: 40, pasteEvents: 2, largePastes: 1, tabEdits: { intro: 30, method: 10 } },
      stu2: { timeSpentSec: 0, edits: 4, pasteEvents: 0, largePastes: 0, tabEdits: {} },
      stu3: { timeSpentSec: 0, edits: 0, pasteEvents: 0, largePastes: 0, tabEdits: {} },
    });
  });

  test('never goes negative and ignores members who left', () => {
    const metrics = buildAuthorMetrics(['stu1'], [{ id: 'stu1', timeSpent: -2, edits: 'x' }, { id: 'gone', edits: 9 }], []);
    assert.deepEqual(metrics, { stu1: { timeSpentSec: 0, edits: 0, pasteEvents: 0, largePastes: 0, tabEdits: {} } });
  });
});
