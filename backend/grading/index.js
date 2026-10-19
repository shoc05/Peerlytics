// Server-side grading (step 2.8). Pure functions: no database, no network, no clock. The
// caller passes a frozen snapshot (the submission's author metrics, the analysis row, the
// group's tasks and the assignment's rubric), so the same inputs always give the same grade.
//
// Grade = weighted Time, Edits, Writing and Tasks scores (0-10, rubric weights per assignment,
// default 0.25 each), minus deductions that apply only to the student responsible, clamped to
// 0-10. A score that can't be measured (no analysis, or a group that made no tasks) is left
// out and its weight is shared among the others; the explanation says so. The lecturer's
// override, stored separately, is always final.

export const DEFAULT_TIME_CAP_MINUTES = 60;
/** A student's fair share of edits is never taken as less than this (so a group of one, or a tiny group, can't score 10 on two edits). */
export const MIN_FAIR_SHARE_EDITS = 10;
export const SCORE_KEYS = ['time', 'edits', 'writing', 'tasks'];

const clamp = (v, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** 10 when the student reached the time cap (minutes of active writing), proportionally less below it. */
export function timeScore(timeSpentSec, timeCapMinutes) {
  const cap = (timeCapMinutes > 0 ? timeCapMinutes : DEFAULT_TIME_CAP_MINUTES) * 60;
  return round2(clamp((10 * Math.max(0, timeSpentSec || 0)) / cap));
}

/** 10 when the student made at least an equal share of the group's edits. */
export function editsScore(edits, groupEdits) {
  const total = groupEdits.reduce((a, b) => a + Math.max(0, b || 0), 0);
  const fairShare = Math.max(total / Math.max(1, groupEdits.length), MIN_FAIR_SHARE_EDITS);
  return round2(clamp((10 * Math.max(0, edits || 0)) / fairShare));
}

/** The analysis's writing_quality (the same for the whole group), or null when there is none. */
export function writingScore(analysis) {
  if (!analysis || analysis.status === 'unavailable' || analysis.writing_quality == null) return null;
  return round2(clamp(Number(analysis.writing_quality)));
}

/**
 * Share of the student's own tasks done by the deadline, with real edits in the linked tab.
 * null when the group made no tasks (Tasks is then left out); 0 when the group has tasks but
 * the student owns none.
 *   tabTracking: whether any per-tab edit counts were recorded for this workspace. Without
 *   them the tab check can't be made, so a done-by-deadline task counts on its own.
 * @returns {{ score: number|null, owned: number, counted: number }}
 */
export function tasksScore(uid, tasks, { deadlineMs, tabEdits = {}, tabTracking = false }) {
  if (tasks.length === 0) return { score: null, owned: 0, counted: 0 };
  const owned = tasks.filter((t) => t.ownerId === uid);
  if (owned.length === 0) return { score: 0, owned: 0, counted: 0 };
  const counted = owned.filter((t) => {
    if (t.doneAt == null || Date.parse(t.doneAt) > deadlineMs) return false;
    if (t.tabId && tabTracking) return (tabEdits[t.tabId] || 0) > 0;
    return true;
  }).length;
  return { score: round2((10 * counted) / owned.length), owned: owned.length, counted };
}

/** Large pastes by this student: 1 -> -1, 2-3 -> -2, 4 or more -> -3. */
export function pasteDeduction(largePastes) {
  const n = Math.max(0, largePastes || 0);
  if (n === 0) return null;
  const points = n >= 4 ? 3 : n >= 2 ? 2 : 1;
  return { kind: 'paste', points, reason: `${n} large paste${n === 1 ? '' : 's'} by this student (−${points}).` };
}

/**
 * Only sentences the analysis attributes to this student count, so a flag never costs a
 * teammate anything: 1-2 flags -> -1, 3 or more -> -2. AI likelihood is a signal, not proof.
 */
export function aiDeduction(uid, analysis) {
  const mine = (analysis?.flagged_sentences || []).filter((f) => f && f.authorId === uid).length;
  if (mine === 0) return null;
  const points = mine >= 3 ? 2 : 1;
  return {
    kind: 'ai',
    points,
    reason: `${mine} sentence${mine === 1 ? '' : 's'} written by this student flagged as possibly AI-generated (−${points}; a signal, not proof).`,
  };
}

/**
 * Weighted average of the scores that exist. Missing scores give their weight to the others in
 * proportion; if every remaining weight is 0, the remaining scores count equally.
 * @returns {{ base: number, effectiveWeights: Record<string, number> }}
 */
export function weightedBase(scores, weights) {
  const present = SCORE_KEYS.filter((k) => scores[k] != null);
  const total = present.reduce((s, k) => s + (Number(weights[k]) || 0), 0);
  const w = Object.fromEntries(present.map((k) => [k, total > 0 ? (Number(weights[k]) || 0) / total : 1 / present.length]));
  const base = present.reduce((s, k) => s + scores[k] * w[k], 0);
  return { base: round2(base), effectiveWeights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, round2(v)])) };
}

const LABEL = { time: 'Time', edits: 'Edits', writing: 'Writing', tasks: 'Tasks' };

function explain({ scores, weights, effectiveWeights, base, deductions, suggested, details }) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const parts = SCORE_KEYS.filter((k) => scores[k] != null).map((k) => `${LABEL[k]} ${scores[k]}/10 (weight ${pct(effectiveWeights[k])})`);
  const lines = [`Scores: ${parts.join(', ')}. Weighted total ${base}/10.`];
  const missing = SCORE_KEYS.filter((k) => scores[k] == null && Number(weights[k]) > 0);
  if (missing.includes('writing')) lines.push('Writing could not be measured because the analysis was unavailable, so its weight was shared among the other scores.');
  if (missing.includes('tasks')) lines.push('The group made no tasks, so the Tasks weight was shared among the other scores.');
  lines.push(details.time, details.edits);
  if (details.tasks) lines.push(details.tasks);
  if (deductions.length) lines.push(`Deductions for this student only: ${deductions.map((d) => d.reason).join(' ')}`);
  else lines.push('No deductions.');
  lines.push(`Suggested grade ${suggested}/10. The lecturer can override it.`);
  return lines.join(' ');
}

/**
 * Grades for every member of one submitted workspace.
 * @param {{
 *   members: string[],                     uids, in order
 *   authorMetrics: Record<string, { timeSpentSec, edits, pasteEvents, largePastes, tabEdits }>,
 *   analysis: { status, writing_quality, flagged_sentences } | null,
 *   tasks: { ownerId, tabId, doneAt }[],
 *   weights: { time, edits, writing, tasks },
 *   timeCapMinutes: number | null,
 *   deadlineMs: number,                   the effective deadline (with the group's extension)
 * }} input
 * @returns {Array<{ uid, scores, deductions, suggested, explanation, effectiveWeights }>}
 */
export function gradeWorkspace({ members, authorMetrics, analysis, tasks, weights, timeCapMinutes, deadlineMs }) {
  const metric = (uid) => authorMetrics[uid] || { timeSpentSec: 0, edits: 0, pasteEvents: 0, largePastes: 0, tabEdits: {} };
  const groupEdits = members.map((uid) => metric(uid).edits);
  const tabTracking = members.some((uid) => Object.keys(metric(uid).tabEdits || {}).length > 0);
  const writing = writingScore(analysis);
  const cap = timeCapMinutes > 0 ? timeCapMinutes : DEFAULT_TIME_CAP_MINUTES;

  return members.map((uid) => {
    const m = metric(uid);
    const t = tasksScore(uid, tasks, { deadlineMs, tabEdits: m.tabEdits || {}, tabTracking });
    const scores = {
      time: timeScore(m.timeSpentSec, timeCapMinutes),
      edits: editsScore(m.edits, groupEdits),
      writing,
      tasks: t.score,
    };
    const { base, effectiveWeights } = weightedBase(scores, weights);
    const deductions = [pasteDeduction(m.largePastes), aiDeduction(uid, analysis)].filter(Boolean);
    const suggested = round2(clamp(base - deductions.reduce((s, d) => s + d.points, 0)));
    const details = {
      time: `Active writing time ${Math.round((m.timeSpentSec || 0) / 60)} of ${cap} minutes.`,
      edits: `${m.edits || 0} edits against a fair share of ${Math.round(Math.max(groupEdits.reduce((a, b) => a + (b || 0), 0) / members.length, MIN_FAIR_SHARE_EDITS))}.`,
      tasks: t.score == null ? null : t.owned === 0 ? 'Owned none of the group’s tasks.' : `${t.counted} of ${t.owned} own tasks done by the deadline.`,
    };
    return {
      uid,
      scores,
      deductions,
      suggested,
      effectiveWeights,
      explanation: explain({ scores, weights, effectiveWeights, base, deductions, suggested, details }),
    };
  });
}
