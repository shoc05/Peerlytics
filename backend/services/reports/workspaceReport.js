// The workspace report as XML (step 2.10): workspace, students, metrics, deductions, grades,
// and the AI and paste flags. backend/reports/report.xsd describes it, and report.xsl turns it
// into a printable HTML page. Everything comes from PostgreSQL after submission: the frozen
// metrics snapshot, the grades (with the latest override), and the latest analysis.
//
// The XML is written by hand with every value escaped, so a student's name or a flagged
// sentence can never break the document or inject markup.
import { AI_NOTICE } from '../submissions/mappers.js';

export const REPORT_VERSION = 1;
export const STYLESHEET_PATH = '/api/reports/report.xsl';

// Characters XML 1.0 forbids (most C0 controls, lone surrogates, U+FFFE/FFFF) are dropped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(value) {
  return String(value ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const iso = (d) => (d == null ? null : new Date(d).toISOString());
const num = (v) => (v == null ? null : Number(v));

/** attrs({ a: 1, b: null }) -> ' a="1"' (null and undefined are left out). */
function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
}

const el = (name, attributes, children = '') =>
  children === '' ? `<${name}${attrs(attributes)}/>` : `<${name}${attrs(attributes)}>${children}</${name}>`;
const text = (name, value) => `<${name}>${escapeXml(value)}</${name}>`;

/** Everything the report needs for one submitted workspace, or null if it has no submission. */
export async function loadReportData(q, workspaceId) {
  const { rows } = await q.query(
    `SELECT w.id AS workspace_id, w.name AS workspace_name, w.status,
            a.id AS assignment_id, a.title AS assignment_title, a.deadline,
            a.weight_time, a.weight_edits, a.weight_writing, a.weight_tasks, a.time_cap_minutes,
            c.id AS course_id, c.code AS course_code, c.title AS course_title,
            s.id AS submission_id, s.submitted_at, s.trigger, s.word_count, s.author_metrics
       FROM workspaces w
       JOIN assignments a ON a.id = w.assignment_id
       JOIN courses c ON c.id = a.course_id
       JOIN submissions s ON s.workspace_id = w.id
      WHERE w.id = $1`,
    [workspaceId]
  );
  const head = rows[0];
  if (!head) return null;

  const { rows: analysisRows } = await q.query(
    `SELECT provider, model, status, fallback_reason, ai_likelihood, writing_quality, flagged_sentences, created_at
       FROM analysis_results WHERE submission_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [head.submission_id]
  );
  const { rows: grades } = await q.query(
    `SELECT g.*, u.display_name,
            o.new_grade AS override_grade, o.reason AS override_reason, o.created_at AS override_at, ol.display_name AS override_by
       FROM grades g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN LATERAL (
         SELECT new_grade, reason, created_at, lecturer_id FROM overrides WHERE grade_id = g.id ORDER BY created_at DESC, id DESC LIMIT 1
       ) o ON true
       LEFT JOIN users ol ON ol.id = o.lecturer_id
      WHERE g.workspace_id = $1`,
    [workspaceId]
  );
  // Students: everyone in the metrics snapshot, plus anyone graded (normally the same people).
  const uids = [...new Set([...Object.keys(head.author_metrics || {}), ...grades.map((g) => g.user_id)])];
  const { rows: users } = await q.query('SELECT id, display_name FROM users WHERE id = ANY($1)', [uids]);
  const names = new Map(users.map((u) => [u.id, u.display_name]));

  return { head, analysis: analysisRows[0] ?? null, grades, uids, names };
}

/** Build the XML text. `generatedAt` is passed in so the output is reproducible in tests. */
export function buildReportXml({ head, analysis, grades, uids, names }, { generatedAt, stylesheetHref = STYLESHEET_PATH }) {
  const gradeOf = new Map(grades.map((g) => [g.user_id, g]));
  const studentIds = new Set(uids);
  const metrics = head.author_metrics || {};

  const students = uids
    .slice()
    .sort((a, b) => String(names.get(a) ?? a).localeCompare(String(names.get(b) ?? b)) || a.localeCompare(b))
    .map((uid) => {
      const m = metrics[uid] || {};
      const g = gradeOf.get(uid);
      const metricsEl = el('metrics', {
        timeSpentSec: m.timeSpentSec ?? 0,
        edits: m.edits ?? 0,
        pasteEvents: m.pasteEvents ?? 0,
        largePastes: m.largePastes ?? 0,
      });
      let gradeEls = '';
      if (g) {
        const deductions = (g.deductions || [])
          .map((d) => el('deduction', { kind: d.kind, points: d.points }, text('reason', d.reason)))
          .join('');
        const overridden = g.override_grade != null;
        const override = overridden
          ? el('override', { by: g.override_by, at: iso(g.override_at) }, text('reason', g.override_reason))
          : '';
        gradeEls =
          el('scores', { time: num(g.time_score), edits: num(g.edits_score), writing: num(g.writing_score), tasks: num(g.tasks_score) }) +
          el('deductions', {}, deductions) +
          el('grade', { suggested: num(g.suggested), final: overridden ? num(g.override_grade) : num(g.suggested), overridden }, override) +
          text('explanation', g.explanation);
      }
      return el('student', { id: uid }, text('name', names.get(uid) ?? uid) + metricsEl + gradeEls);
    })
    .join('');

  let analysisEl = '';
  if (analysis) {
    const flags = (analysis.flagged_sentences || [])
      .map((f) =>
        el(
          'flaggedSentence',
          // Only refer to a student who is in this report, so the keyref in report.xsd holds.
          { authorRef: f.authorId && studentIds.has(f.authorId) ? f.authorId : null },
          text('sentence', f.sentence) + text('reason', f.reason)
        )
      )
      .join('');
    analysisEl = el(
      'analysis',
      {
        provider: analysis.provider,
        status: analysis.status,
        fallbackReason: analysis.fallback_reason,
        aiLikelihood: analysis.ai_likelihood,
        writingQuality: num(analysis.writing_quality),
        analysedAt: iso(analysis.created_at),
      },
      text('notice', AI_NOTICE) + flags
    );
  }

  const body =
    el('course', { id: head.course_id, code: head.course_code }, text('title', head.course_title)) +
    el(
      'assignment',
      { id: head.assignment_id, deadline: iso(head.deadline), timeCapMinutes: head.time_cap_minutes },
      text('title', head.assignment_title) +
        el('rubric', { time: num(head.weight_time), edits: num(head.weight_edits), writing: num(head.weight_writing), tasks: num(head.weight_tasks) })
    ) +
    el(
      'workspace',
      { id: head.workspace_id, status: head.status, submittedAt: iso(head.submitted_at), trigger: head.trigger, wordCount: head.word_count },
      text('name', head.workspace_name)
    ) +
    analysisEl +
    el('students', {}, students);

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<?xml-stylesheet type="text/xsl" href="${escapeXml(stylesheetHref)}"?>\n` +
    `${el('report', { version: REPORT_VERSION, generatedAt }, body)}\n`
  );
}
