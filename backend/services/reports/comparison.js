// Course comparison (step 4.7): every submitted group side by side. Pure functions here; the
// route loads the rows. Nothing is new data: it summarises the frozen metrics snapshot, the
// latest analysis and the final grades.

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Gini coefficient of the members' edit counts: 0 = edits evenly shared, 1 = one person did
 * everything. Mean absolute difference over all pairs, divided by twice the mean.
 * A group of one, or nobody editing, is 0 (nothing to be unequal about).
 */
export function gini(values) {
  const xs = values.map((v) => Math.max(0, Number(v) || 0));
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  if (n < 2 || total === 0) return 0;
  let diff = 0;
  for (const a of xs) for (const b of xs) diff += Math.abs(a - b);
  // Normalised by n(n-1) instead of n², so one person doing everything scores exactly 1.
  return round2(diff / (2 * (n - 1) * total));
}

/** Large pastes per member: 0 none, up to 0.5 low, up to 1.5 medium, above that high. */
export function pasteLevel(largePastes, members) {
  if (members === 0 || largePastes === 0) return 'none';
  const per = largePastes / members;
  if (per <= 0.5) return 'low';
  if (per <= 1.5) return 'medium';
  return 'high';
}

/**
 * @param {{ id, name, assignment_id, author_metrics, ai_likelihood }} row  one submitted workspace
 * @param {number[]} finals  the members' final grades (suggested, or the latest override)
 */
export function compareGroup(row, finals) {
  const metrics = Object.values(row.author_metrics || {});
  const largePastes = metrics.reduce((s, m) => s + (m.largePastes || 0), 0);
  const avg = finals.length ? round2(finals.reduce((a, b) => a + b, 0) / finals.length) : null;
  return {
    workspaceId: row.id,
    name: row.name,
    assignmentId: row.assignment_id,
    memberCount: metrics.length,
    contributionGini: gini(metrics.map((m) => m.edits)),
    aiLikelihood: row.ai_likelihood ?? null,
    pasteLevel: pasteLevel(largePastes, metrics.length),
    largePastes,
    averageGrade: avg,
    minGrade: finals.length ? Math.min(...finals) : null,
    maxGrade: finals.length ? Math.max(...finals) : null,
  };
}
