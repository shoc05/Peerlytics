// Assignment rubric: Time, Edits, Writing and Tasks weights (CLAUDE.md "Grade").
// Weights are fractions that sum to 1; the form edits them as percentages.
export const RUBRIC_CRITERIA = Object.freeze(['time', 'edits', 'writing', 'tasks']);

export const DEFAULT_RUBRIC = Object.freeze({ time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 });

const round2 = (n) => Math.round(n * 100) / 100;

/** Rubric fractions -> percentage strings for the form inputs. */
export function toPercentInputs(rubric = DEFAULT_RUBRIC) {
  return Object.fromEntries(RUBRIC_CRITERIA.map((k) => [k, String(round2((rubric[k] ?? 0) * 100))]));
}

/**
 * Percentage inputs -> { rubric, errors, total }.
 * rubric is null unless every weight is a number from 0 to 100 and they add up to 100.
 * errors maps a criterion (or `total`) to a string key in ./strings.js.
 */
export function rubricFromPercents(inputs) {
  const errors = {};
  const rubric = {};
  let total = 0;
  for (const k of RUBRIC_CRITERIA) {
    const raw = String(inputs?.[k] ?? '').trim();
    const n = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      errors[k] = 'weightInvalid';
      continue;
    }
    rubric[k] = n / 100;
    total += n;
  }
  total = round2(total);
  if (Object.keys(errors).length) return { rubric: null, errors, total };
  // 33.33 x 3 + 33.34 style splits are fine; anything further from 100 is not.
  if (Math.abs(total - 100) > 0.01) return { rubric: null, errors: { total: 'weightsTotal' }, total };
  return { rubric, errors: {}, total };
}
