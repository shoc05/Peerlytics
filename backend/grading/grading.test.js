import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  aiDeduction,
  DEFAULT_TIME_CAP_MINUTES,
  editsScore,
  gradeWorkspace,
  pasteDeduction,
  tasksScore,
  timeScore,
  weightedBase,
  writingScore,
} from './index.js';
import { csvCell, toCsv } from '../services/grading/csv.js';

const EVEN = { time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 };
const DEADLINE = Date.parse('2026-11-01T12:00:00Z');
const before = '2026-11-01T09:00:00.000Z';
const after = '2026-11-01T13:00:00.000Z';

describe('Time', () => {
  for (const [sec, cap, want] of [
    [0, 60, 0],
    [1800, 60, 5],
    [3600, 60, 10],
    [7200, 60, 10], // capped
    [600, 20, 5],
    [1800, null, 5], // default cap
    [-50, 60, 0],
  ]) {
    test(`${sec}s with a ${cap ?? 'default'} min cap -> ${want}`, () => assert.equal(timeScore(sec, cap), want));
  }
  test('the default cap is 60 minutes', () => assert.equal(DEFAULT_TIME_CAP_MINUTES, 60));
});

describe('Edits', () => {
  test('an equal share or more is 10', () => {
    assert.equal(editsScore(50, [50, 50]), 10);
    assert.equal(editsScore(90, [90, 10]), 10);
  });
  test('below the fair share is proportional', () => {
    assert.equal(editsScore(10, [90, 10]), 2); // fair share 50
  });
  test('a group of one needs at least the minimum fair share', () => {
    assert.equal(editsScore(5, [5]), 5); // fair share floor 10
    assert.equal(editsScore(40, [40]), 10);
  });
  test('nobody edited: 0', () => assert.equal(editsScore(0, [0, 0]), 0));
});

describe('Writing', () => {
  test('comes from the analysis', () => assert.equal(writingScore({ status: 'completed', writing_quality: '7.25' }), 7.25));
  test('missing or unavailable analysis: null', () => {
    assert.equal(writingScore(null), null);
    assert.equal(writingScore({ status: 'unavailable', writing_quality: null }), null);
    assert.equal(writingScore({ status: 'partial', writing_quality: null }), null);
  });
});

describe('Tasks', () => {
  const tasks = [
    { ownerId: 'a', tabId: null, doneAt: before },
    { ownerId: 'a', tabId: 't1', doneAt: before },
    { ownerId: 'a', tabId: null, doneAt: after }, // late
    { ownerId: 'a', tabId: null, doneAt: null }, // not done
    { ownerId: 'b', tabId: null, doneAt: before },
  ];
  test('share of own tasks done by the deadline', () => {
    assert.deepEqual(tasksScore('a', tasks, { deadlineMs: DEADLINE }), { score: 5, owned: 4, counted: 2 });
    assert.deepEqual(tasksScore('b', tasks, { deadlineMs: DEADLINE }), { score: 10, owned: 1, counted: 1 });
  });
  test('with tab tracking, a linked task needs real edits in that tab', () => {
    assert.equal(tasksScore('a', tasks, { deadlineMs: DEADLINE, tabTracking: true, tabEdits: {} }).counted, 1);
    assert.equal(tasksScore('a', tasks, { deadlineMs: DEADLINE, tabTracking: true, tabEdits: { t1: 3 } }).counted, 2);
  });
  test('the group made tasks but this student owns none: 0', () => assert.equal(tasksScore('c', tasks, { deadlineMs: DEADLINE }).score, 0));
  test('the group made no tasks: null (left out)', () => assert.equal(tasksScore('a', [], { deadlineMs: DEADLINE }).score, null));
});

describe('deductions', () => {
  for (const [n, points] of [[0, null], [1, 1], [2, 2], [3, 2], [4, 3], [9, 3]]) {
    test(`${n} large pastes -> ${points == null ? 'none' : `−${points}`}`, () => assert.equal(pasteDeduction(n)?.points ?? null, points));
  }
  const analysis = {
    flagged_sentences: [
      { sentence: 's1', reason: 'r', authorId: 'a' },
      { sentence: 's2', reason: 'r', authorId: 'a' },
      { sentence: 's3', reason: 'r', authorId: 'a' },
      { sentence: 's4', reason: 'r', authorId: 'b' },
      { sentence: 's5', reason: 'r' }, // not attributed
    ],
  };
  test('AI: only flags attributed to the student count, at most −2', () => {
    assert.equal(aiDeduction('a', analysis).points, 2);
    assert.equal(aiDeduction('b', analysis).points, 1);
    assert.equal(aiDeduction('c', analysis), null);
    assert.match(aiDeduction('b', analysis).reason, /signal, not proof/);
  });
  test('AI: unattributed flags cost nobody anything', () => {
    assert.equal(aiDeduction('a', { flagged_sentences: [{ sentence: 'x', reason: 'y' }] }), null);
    assert.equal(aiDeduction('a', null), null);
  });
});

describe('weights', () => {
  test('all four present: the rubric weights', () => {
    assert.deepEqual(weightedBase({ time: 10, edits: 6, writing: 8, tasks: 4 }, EVEN), { base: 7, effectiveWeights: EVEN });
  });
  test('a missing score shares its weight among the others in proportion', () => {
    const { base, effectiveWeights } = weightedBase({ time: 10, edits: 4, writing: null, tasks: 7 }, { time: 0.2, edits: 0.2, writing: 0.5, tasks: 0.1 });
    assert.deepEqual(effectiveWeights, { time: 0.4, edits: 0.4, tasks: 0.2 });
    assert.equal(base, 7);
  });
  test('if every remaining weight is 0, the remaining scores count equally', () => {
    assert.equal(weightedBase({ time: 8, edits: 4, writing: null, tasks: null }, { time: 0, edits: 0, writing: 1, tasks: 0 }).base, 6);
  });
});

describe('gradeWorkspace', () => {
  const base = {
    members: ['a', 'b'],
    authorMetrics: {
      a: { timeSpentSec: 3600, edits: 60, pasteEvents: 0, largePastes: 0, tabEdits: {} },
      b: { timeSpentSec: 900, edits: 20, pasteEvents: 3, largePastes: 2, tabEdits: {} },
    },
    analysis: { id: 'r1', status: 'completed', writing_quality: '8.00', flagged_sentences: [{ sentence: 'x', reason: 'y', authorId: 'b' }] },
    tasks: [
      { ownerId: 'a', tabId: null, doneAt: before },
      { ownerId: 'b', tabId: null, doneAt: after },
    ],
    weights: EVEN,
    timeCapMinutes: 60,
    deadlineMs: DEADLINE,
  };

  test('each student gets their own scores; deductions hit only the student responsible', () => {
    const [a, b] = gradeWorkspace(base);
    assert.deepEqual(a.scores, { time: 10, edits: 10, writing: 8, tasks: 10 });
    assert.deepEqual(a.deductions, []);
    assert.equal(a.suggested, 9.5);

    assert.deepEqual(b.scores, { time: 2.5, edits: 5, writing: 8, tasks: 0 });
    assert.deepEqual(b.deductions.map((d) => [d.kind, d.points]), [['paste', 2], ['ai', 1]]);
    assert.equal(b.suggested, 0.88); // 3.875 - 3 = 0.875
  });

  test('never below 0 or above 10', () => {
    const [, b] = gradeWorkspace({ ...base, authorMetrics: { ...base.authorMetrics, b: { timeSpentSec: 0, edits: 0, largePastes: 9, tabEdits: {} } } });
    assert.equal(b.suggested, 0);
  });

  test('with analysis unavailable and no tasks, Time and Edits carry the grade and the explanation says why', () => {
    const [a] = gradeWorkspace({ ...base, analysis: null, tasks: [] });
    assert.equal(a.scores.writing, null);
    assert.equal(a.scores.tasks, null);
    assert.deepEqual(a.effectiveWeights, { time: 0.5, edits: 0.5 });
    assert.equal(a.suggested, 10);
    assert.match(a.explanation, /analysis was unavailable/);
    assert.match(a.explanation, /no tasks/);
  });

  test('a member with no tracking data gets zeros, not an error', () => {
    const [, , c] = gradeWorkspace({ ...base, members: ['a', 'b', 'c'] });
    assert.deepEqual([c.scores.time, c.scores.edits], [0, 0]);
  });

  test('the explanation is plain English with the numbers', () => {
    const [, b] = gradeWorkspace(base);
    assert.match(b.explanation, /^Scores: Time 2\.5\/10 \(weight 25%\), Edits 5\/10/);
    assert.match(b.explanation, /0 of 1 own tasks done by the deadline/);
    assert.match(b.explanation, /2 large pastes by this student/);
    assert.match(b.explanation, /Suggested grade 0\.88\/10\. The lecturer can override it\.$/);
  });

  test('same inputs, same grades', () => assert.deepEqual(gradeWorkspace(base), gradeWorkspace(base)));
});

describe('CSV', () => {
  test('quotes commas, quotes and line breaks', () => {
    assert.equal(csvCell('Dorji, Pema'), '"Dorji, Pema"');
    assert.equal(csvCell('She said "hi"'), '"She said ""hi"""');
    assert.equal(csvCell('a\nb'), '"a\nb"');
  });
  test('text that could run as a formula is neutralised; numbers are not touched', () => {
    assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    for (const s of ['+1', '-1', '@SUM(A1)', '\tx']) assert.ok(csvCell(s).replace(/^"/, '').startsWith("'"), s);
    assert.equal(csvCell(-1.5), '-1.5');
    assert.equal(csvCell(null), '');
  });
  test('CRLF rows with a header', () => {
    assert.equal(toCsv([{ n: 'A', g: 7.5 }], [{ header: 'name', value: (r) => r.n }, { header: 'grade', value: (r) => r.g }]), 'name,grade\r\nA,7.5\r\n');
  });
});
