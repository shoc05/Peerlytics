// The XML report against backend/reports/report.xsd (real libxml2 via xmllint-wasm), and
// backend/reports/report.xsl run in Node (xslt-processor). No database: the data is built here.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildReportXml, escapeXml } from './workspaceReport.js';
import { toHtml, validate, XSL } from '../../reports/testTools.js';

const GENERATED = '2026-11-02T08:00:00.000Z';

function data(over = {}) {
  return {
    head: {
      course_id: 'c-1', course_code: 'CTE412', course_title: 'Mini project',
      assignment_id: 'a-1', assignment_title: 'Group report', deadline: '2026-11-01T12:00:00Z',
      weight_time: '0.25', weight_edits: '0.25', weight_writing: '0.25', weight_tasks: '0.25', time_cap_minutes: 60,
      workspace_id: 'Grp123', workspace_name: 'Team Druk', status: 'submitted', submitted_at: '2026-11-01T10:00:00Z',
      trigger: 'manual', word_count: 1200,
      author_metrics: {
        'stu-1': { timeSpentSec: 3600, edits: 75, pasteEvents: 0, largePastes: 0 },
        'stu-2': { timeSpentSec: 900, edits: 25, pasteEvents: 3, largePastes: 2 },
      },
    },
    analysis: {
      provider: 'openai', status: 'completed', fallback_reason: null, ai_likelihood: 35, writing_quality: '7.50',
      created_at: '2026-11-01T10:01:00Z',
      flagged_sentences: [
        { sentence: 'Hydropower is the backbone of the economy.', reason: 'Generic phrasing', authorId: 'stu-2' },
        { sentence: 'Tourism follows a high-value, low-volume policy.', reason: 'Listy' },
      ],
    },
    grades: [
      { user_id: 'stu-1', time_score: '10.00', edits_score: '10.00', writing_score: '7.50', tasks_score: null, deductions: [], suggested: '9.17', override_grade: null, explanation: 'Strong, even contribution.' },
      {
        user_id: 'stu-2', time_score: '2.50', edits_score: '5.00', writing_score: '7.50', tasks_score: null,
        deductions: [{ kind: 'paste', points: 2, reason: '2 large pastes by this student (−2).' }, { kind: 'ai', points: 1, reason: '1 sentence flagged (−1; a signal, not proof).' }],
        suggested: '2.00', override_grade: '4.00', override_reason: 'Interviews done offline', override_by: 'Pema Lecturer', override_at: '2026-11-02T07:00:00Z',
        explanation: 'Low time and pastes.',
      },
    ],
    uids: ['stu-1', 'stu-2'],
    names: new Map([['stu-1', 'Karma Wangchuk'], ['stu-2', 'Dechen Yangzom']]),
    ...over,
  };
}

describe('escaping', () => {
  test('markup characters become entities', () => {
    assert.equal(escapeXml(`<b>"Tom" & 'Jerry'</b>`), '&lt;b&gt;&quot;Tom&quot; &amp; &apos;Jerry&apos;&lt;/b&gt;');
  });
  test('characters XML 1.0 forbids are dropped; tabs, new lines and Dzongkha are kept', () => {
    assert.equal(escapeXml('a\u0000b\u0007c\u001Fd'), 'abcd');
    assert.equal(escapeXml('a\tb\nc'), 'a\tb\nc');
    assert.equal(escapeXml('རྫོང་ཁ'), 'རྫོང་ཁ');
  });
  test('a hostile name stays text inside the report', async () => {
    const d = data();
    d.names.set('stu-1', '</name><script>alert(1)</script>\u0007');
    const xml = buildReportXml(d, { generatedAt: GENERATED });
    assert.equal(xml.includes('<script>'), false);
    assert.equal((await validate(xml)).valid, true);
  });
});

describe('report.xsd', () => {
  test('a full report is valid', async () => {
    const xml = buildReportXml(data(), { generatedAt: GENERATED });
    assert.deepEqual(await validate(xml), { valid: true, errors: [] });
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<\?xml-stylesheet type="text\/xsl" href="\/api\/reports\/report\.xsl"\?>\n<report /);
  });

  test('a report with no analysis and an ungraded student is valid', async () => {
    const d = data({ analysis: null, grades: [] });
    assert.equal((await validate(buildReportXml(d, { generatedAt: GENERATED }))).valid, true);
  });

  test('a flag naming a student outside the report is written without authorRef', async () => {
    const d = data();
    d.analysis.flagged_sentences.push({ sentence: 'Ghost sentence here.', reason: 'x', authorId: 'not-in-group' });
    const xml = buildReportXml(d, { generatedAt: GENERATED });
    assert.equal(xml.includes('not-in-group'), false);
    assert.equal((await validate(xml)).valid, true);
  });

  const valid = () => buildReportXml(data(), { generatedAt: GENERATED });
  for (const [what, edit] of [
    ['a grade above 10', (x) => x.replace('suggested="9.17"', 'suggested="10.5"')],
    ['a score with three decimals', (x) => x.replace('suggested="9.17"', 'suggested="9.175"')],
    ['AI likelihood above 100', (x) => x.replace('aiLikelihood="35"', 'aiLikelihood="135"')],
    ['a negative edit count', (x) => x.replace('edits="75"', 'edits="-1"')],
    ['an unknown deduction kind', (x) => x.replace('kind="paste"', 'kind="late"')],
    ['two students with the same id', (x) => x.replace('<student id="stu-1">', '<student id="stu-2">')],
    ['a flag pointing at nobody', (x) => x.replace('authorRef="stu-2"', 'authorRef="stu-9"')],
    ['a missing course code', (x) => x.replace(' code="CTE412"', '')],
  ]) {
    test(`rejects ${what}`, async () => {
      const broken = edit(valid());
      assert.notEqual(broken, valid(), 'the edit applied');
      assert.equal((await validate(broken)).valid, false);
    });
  }
});

describe('report.xsl', () => {
  test('per-student rows: totals from XPath, yellow for pastes, the lecturer’s final grade', async () => {
    const html = await toHtml(buildReportXml(data(), { generatedAt: GENERATED }));
    const rows = [...html.matchAll(/<tr( class="paste")?>([\s\S]*?)<\/tr>/g)].map((m) => ({
      paste: Boolean(m[1]),
      cells: [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()),
    }));
    const body = rows.filter((r) => r.cells.length === 13);
    // Sorted by name: Dechen, then Karma.
    assert.deepEqual(body[0], {
      paste: true,
      cells: ['Dechen Yangzom', '15', '25', '25%', '2', '1', '2.5', '5', '7.5', 'n/a', '−3', '2', '4 (lecturer)'],
    });
    assert.deepEqual(body[1], {
      paste: false,
      cells: ['Karma Wangchuk', '60', '75', '75%', '0', '0', '10', '10', '7.5', 'n/a', '0', '9.17', '9.17'],
    });
  });

  test('group totals in the footer', async () => {
    const html = await toHtml(buildReportXml(data(), { generatedAt: GENERATED }));
    const foot = html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)[1].replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ');
    for (const part of ['2 students', '75', '100', '1 with pastes', '2', '6.59']) assert.ok(foot.includes(part), `${part} in ${foot}`);
  });

  test('AI flags are red, with the notice and the author where known', async () => {
    const html = await toHtml(buildReportXml(data(), { generatedAt: GENERATED }));
    const flags = [...html.matchAll(/<div class="ai">([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    assert.equal(flags.length, 2);
    assert.match(flags[0], /^Hydropower is the backbone of the economy\. Generic phrasing · written by Dechen Yangzom$/);
    assert.doesNotMatch(flags[1], /written by/);
    assert.match(html, /AI likelihood is a signal, not proof/);
    assert.match(html, /Lecturer override by Pema Lecturer/);
  });

  test('with no analysis the page says so', async () => {
    const html = await toHtml(buildReportXml(data({ analysis: null }), { generatedAt: GENERATED }));
    assert.match(html, /No analysis was available for this submission\./);
  });

  test('the stylesheet explains its XPath for the write-up', () => {
    for (const expr of ['sum(deductions/deduction/@points)', 'metrics/@edits div $groupEdits', "count(/report/analysis/flaggedSentence[@authorRef = $id])"]) {
      assert.ok(XSL.includes(expr), expr);
    }
  });
});
