// Spec scoring formula:
//   Score      = 0.25·T + 0.25·E + 0.25·W + 0.25·Q   (Difficulty removed)
//   FinalGrade = Score × (1 − plagiarism%) × (1 − aiUsage%)
//
// Where each component is on a 0–100 scale:
//   T  = Time spent (capped against TIME_CAP_HOURS)
//   E  = Edit count (capped against EDIT_CAP)
//   W  = Writing quality (from OpenAI analysis; defaults to 50 when missing)
//   Q  = Task completion (already a percentage)
//   D  = Content difficulty (raw 0–3 scale → 0–100)
//
// Penalties (applied per-student, attributed to responsible author):
//   Large paste events: −10 to −25 points
//   High AI usage:      −10 to −30 points

// Difficulty (D) was removed — its 0.10 weight folded into Writing + Tasks (equal quarters).
export const SPEC_WEIGHTS = Object.freeze({ T: 0.25, E: 0.25, W: 0.25, Q: 0.25 });

// timeSpent is stored in MINUTES. Full time-marks at this many minutes of active writing.
// Lecturer-configurable per workspace (default 60); pass via options.timeCapMinutes.
export const DEFAULT_TIME_CAP_MINUTES = 60;
const EDIT_CAP = 250;

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function componentScores(member, timeCapMinutes = DEFAULT_TIME_CAP_MINUTES) {
  const cap = timeCapMinutes > 0 ? timeCapMinutes : DEFAULT_TIME_CAP_MINUTES;
  const time = clamp(((member.timeSpent ?? 0) / cap) * 100);
  const edits = clamp(((member.edits ?? 0) / EDIT_CAP) * 100);
  const writing = clamp(member.writingQuality ?? 50);
  const tasks = clamp(member.taskCompletion ?? 0);
  return { T: time, E: edits, W: writing, Q: tasks };
}

/** Pre-penalty weighted score on a 0–100 scale. */
export function calculateBaseScore(member, weights = SPEC_WEIGHTS, timeCapMinutes = DEFAULT_TIME_CAP_MINUTES) {
  const s = componentScores(member, timeCapMinutes);
  const raw =
    s.T * weights.T +
    s.E * weights.E +
    s.W * weights.W +
    s.Q * weights.Q;
  return Math.round(clamp(raw));
}

// Backwards-compatible alias — older UI code reads `effortScore`.
export const calculateEffortScore = calculateBaseScore;

// NOTE: The grade calculation lives in ./behaviorGrade.js (the single grading source).
// This file keeps only the contribution-roster helpers below (ranks, badges, fairness,
// free-rider detection) which the dashboard/Analysis views use. The old spec-formula
// grade functions (computeFinalGrade/explainGrade/suggestGrade/penalties) were removed
// to avoid two divergent grading paths.

// ─── Fairness / status / cosmetic helpers (kept for UI compatibility) ───

export const calculateFairnessScore = (member, allMembers) => {
  if (!allMembers?.length) return 0;
  const totalEdits = allMembers.reduce((a, b) => a + (b.edits ?? 0), 0);
  const totalTime = allMembers.reduce((a, b) => a + (b.timeSpent ?? 0), 0);
  const avgEdits = totalEdits / allMembers.length || 1;
  const avgTime = totalTime / allMembers.length || 1;
  const consistency = 1 - (Math.abs((member.edits ?? 0) - avgEdits) / avgEdits) * 0.5;
  const distribution = 1 - (Math.abs((member.timeSpent ?? 0) - avgTime) / avgTime) * 0.5;
  return Math.round(clamp(((consistency + distribution) / 2) * 100));
};

export const detectFreeRider = (member, allMembers) => {
  if (!allMembers?.length) return 'balanced';
  const avgEdits = allMembers.reduce((a, b) => a + (b.edits ?? 0), 0) / allMembers.length || 1;
  const avgTime = allMembers.reduce((a, b) => a + (b.timeSpent ?? 0), 0) / allMembers.length || 1;
  if ((member.edits ?? 0) < avgEdits * 0.6 && (member.timeSpent ?? 0) < avgTime * 0.6) return 'low-contributor';
  if ((member.edits ?? 0) > avgEdits * 1.5 && (member.taskCompletion ?? 0) > 70) return 'top-contributor';
  return 'balanced';
};

export const getRank = (effortScore) => {
  if (effortScore >= 85) return { label: 'Gold', emoji: '', color: '#ffc107' };
  if (effortScore >= 70) return { label: 'Silver', emoji: '', color: '#c0c0c0' };
  return { label: 'Bronze', emoji: '', color: '#cd7f32' };
};

export const getBadges = (member) => {
  const badges = [];
  if (member.status === 'top-contributor') badges.push({ label: 'Top Contributor', color: '#1D9E75' });
  if ((member.edits ?? 0) > 120) badges.push({ label: 'Editor', color: '#4facfe' });
  if ((member.difficulty ?? 0) >= 2.5) badges.push({ label: 'Researcher', color: '#9b59b6' });
  if ((member.fairnessScore ?? 0) > 75 && member.status === 'balanced') badges.push({ label: 'Consistent Worker', color: '#3498db' });
  if ((member.taskCompletion ?? 0) > 80) badges.push({ label: 'Team Player', color: '#1D9E75' });
  if (member.status === 'low-contributor') badges.push({ label: 'Needs Support', color: '#e74c3c' });
  return badges;
};

export const enrichMembers = (members, weights) =>
  members
    .map((m) => {
      const effortScore = calculateBaseScore(m, weights);
      const fairnessScore = calculateFairnessScore(m, members);
      const status = detectFreeRider(m, members);
      return {
        ...m,
        effortScore,
        fairnessScore,
        status,
        rank: getRank(effortScore),
        badges: getBadges({ ...m, effortScore, fairnessScore, status }),
      };
    })
    .sort((a, b) => b.effortScore - a.effortScore);

