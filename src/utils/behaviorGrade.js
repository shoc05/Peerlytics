// Behavioral + writing-quality grading (fair, neutral, conservative).
//
// Implements the spec:
//   STEP 1  writing score  = avg(grammar, clarity, structure, content)  → 0–10
//   STEP 2  behaviour analysis (time / edits / paste / ai)
//   STEP 3  conservative penalties
//   STEP 4  final = base − penalties, clamped 0–10
//   STEP 5  flags
//   STEP 6  lecturer note
//   STEP 7  JSON output { scores, baseScore, penalties, recommendedScore, flags,
//                         behaviorSummary, lecturerNote }
//
// AI detection is treated as a WEAK signal only: an AI penalty applies solely when
// ai_probability > 0.7 AND (high paste OR low edits). No cheating accusations.
//
// Locking: this is a pure function of static inputs. Callers pass the frozen snapshot
// for a locked submission, so the output is itself a frozen snapshot.

const clamp = (v, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

// Tunables for the behaviour thresholds.
const LOW_TIME_SECONDS = 300;        // < 5 min total → possible low effort
const VERY_LOW_TIME_SECONDS = 120;   // < 2 min → stronger low-effort signal
const VERY_LOW_EDITS = 3;            // ≤ 3 edits → possible copy/paste
// Paste is penalised PROGRESSIVELY from a modest threshold so that a student who pasted
// a meaningful share is charged more than one who pasted nothing — earlier the threshold
// was 70%, which meant a realistic 17% paste produced zero penalty and two clearly
// different submissions scored identically. Conservative: small paste is ignored.
const PASTE_START = 10;              // paste_percentage ≤ 10 → no penalty (incidental: a quote/heading)
const HIGH_PASTE = 70;              // paste_percentage > 70 → strong copy indicator (max penalty)
const AI_HIGH = 0.7;                 // ai_probability > 0.7 → high (weak signal)

/**
 * @param {object} input
 * @param {object} input.writing  { grammar, clarity, structure, content } each 0–10
 * @param {number} input.timeSpentSeconds
 * @param {number} input.editCount
 * @param {number} input.pastePercentage   0–100
 * @param {number} input.aiProbability      0–1
 */
export function gradeSubmission({
  writing = {},
  timeSpentSeconds = 0,
  editCount = 0,
  pastePercentage = 0,
  aiProbability = 0,
  // Lecturer-configured expected active-writing time (minutes). Low-effort thresholds
  // derive from it: < 25% of expected → −2, < 50% → −1. Falls back to fixed defaults.
  timeCapMinutes = 0,
} = {}) {
  // ── STEP 1: writing score (0–10) ──
  const scores = {
    grammar: clamp(num(writing.grammar)),
    clarity: clamp(num(writing.clarity)),
    structure: clamp(num(writing.structure)),
    content: clamp(num(writing.content)),
  };
  const baseScore = round1((scores.grammar + scores.clarity + scores.structure + scores.content) / 4);

  // ── STEP 2/3: behaviour analysis + conservative penalties ──
  const penalties = { time: 0, edits: 0, paste: 0, ai: 0 };

  // Low time → −1 to −2, relative to the lecturer's expected time when set.
  const veryLow = timeCapMinutes > 0 ? timeCapMinutes * 60 * 0.25 : VERY_LOW_TIME_SECONDS;
  const low = timeCapMinutes > 0 ? timeCapMinutes * 60 * 0.5 : LOW_TIME_SECONDS;
  if (timeSpentSeconds > 0 && timeSpentSeconds < veryLow) penalties.time = 2;
  else if (timeSpentSeconds > 0 && timeSpentSeconds < low) penalties.time = 1;

  // Very low edits → −1
  if (editCount <= VERY_LOW_EDITS) penalties.edits = 1;

  // Paste penalty scales progressively from PASTE_START (no penalty ≤20%) up to −4 at
  // ≥HIGH_PASTE (70%). e.g. 20%→0, ~33%→−1, ~46%→−2, ~58%→−3, ≥70%→−4. This charges a
  // student who pasted a real share more than one who pasted nothing, instead of the old
  // all-or-nothing 70% cliff that made different submissions score the same.
  if (pastePercentage > PASTE_START) {
    const span = HIGH_PASTE - PASTE_START; // 50
    const frac = Math.min(1, (pastePercentage - PASTE_START) / span);
    penalties.paste = Math.min(4, Math.max(1, Math.round(frac * 4)));
  }

  // AI penalty: a person whose OWN writing is attributed as AI is penalised on the AI signal
  // itself — it no longer REQUIRES paste/low-edit corroboration. The previous gate meant a
  // student who *typed* AI-generated text (many edits, no paste) escaped any AI penalty and
  // scored the same as a student with no AI at all, which is the opposite of fair attribution.
  //   ai > 0.5 → −1,  ai > 0.7 → −2,  ai > 0.85 → −3.
  // Corroboration (high paste OR very few edits) adds +1 (capped at −4) as a stronger signal.
  const aiHigh = aiProbability > AI_HIGH;
  const corroborated = pastePercentage > HIGH_PASTE || editCount <= VERY_LOW_EDITS;
  if (aiProbability > 0.5) {
    let p = aiProbability > 0.85 ? 3 : aiProbability > AI_HIGH ? 2 : 1;
    if (corroborated && p < 4) p += 1;
    penalties.ai = Math.min(4, p);
  }

  const totalPenalty = penalties.time + penalties.edits + penalties.paste + penalties.ai;

  // ── STEP 4: final score ──
  const recommendedScore = round1(clamp(baseScore - totalPenalty));

  // ── STEP 5: flags ──
  const flags = [];
  if (penalties.time > 0) flags.push('Low Effort');
  if (penalties.paste > 0) flags.push('High Paste Usage');
  if (penalties.ai > 0) flags.push('Possible AI Assistance');

  // ── STEP 6: behaviour summary + lecturer note ──
  const behaviorSummary = {
    timeSpentSeconds: Math.round(timeSpentSeconds),
    editCount,
    pastePercentage: Math.round(pastePercentage),
    aiProbability: round2(aiProbability),
    aiLevel: aiProbability > AI_HIGH ? 'high' : aiProbability >= 0.4 ? 'medium' : 'low',
    effort: penalties.time === 2 ? 'very low' : penalties.time === 1 ? 'low' : 'adequate',
  };

  const lecturerNote = buildLecturerNote({ baseScore, recommendedScore, penalties, flags, behaviorSummary, scores });

  return { scores, baseScore, penalties, recommendedScore, flags, behaviorSummary, lecturerNote };
}

function buildLecturerNote({ baseScore, recommendedScore, penalties, flags, behaviorSummary, scores }) {
  // Lead with the writing-quality basis (Virtual Writing Tutor: grammar, clarity,
  // structure, content) so the lecturer sees what the base score reflects.
  let bits;
  if (scores) {
    const axes = [
      ['grammar', scores.grammar], ['clarity', scores.clarity],
      ['structure', scores.structure], ['content', scores.content],
    ];
    const weakest = axes.slice().sort((a, b) => a[1] - b[1])[0];
    const strongest = axes.slice().sort((a, b) => b[1] - a[1])[0];
    bits = [
      `Writing base ${baseScore}/10 from the Virtual Writing Tutor analysis ` +
      `(grammar ${scores.grammar}, clarity ${scores.clarity}, structure ${scores.structure}, content ${scores.content}).`,
      `Strongest: ${strongest[0]}; weakest: ${weakest[0]}.`,
    ];
  } else {
    bits = [`Writing base ${baseScore}/10.`];
  }
  const deductions = [];
  if (penalties.time) deductions.push(`low time (−${penalties.time})`);
  if (penalties.edits) deductions.push(`very few edits (−${penalties.edits})`);
  if (penalties.paste) deductions.push(`high paste usage (−${penalties.paste})`);
  if (penalties.ai) deductions.push(`possible AI assistance (−${penalties.ai}, weak signal)`);
  if (deductions.length) bits.push(`Adjusted for ${deductions.join(', ')}.`);
  else bits.push('No behavioural penalties applied.');
  bits.push(`Recommended ${recommendedScore}/10.`);
  if (flags.length) bits.push(`Flags: ${flags.join(', ')} — please review and override if the context warrants it.`);
  else bits.push('No concerns flagged.');
  bits.push('AI detection is a signal only; your override is final.');
  return bits.join(' ');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

/**
 * Build the writing sub-scores (0–10) from a submission report's AI metrics.
 * Maps the available OpenAI outputs to the spec's four axes:
 *   grammar→grammar, clarity→coherence, structure→argumentStrength, content→writingQuality.
 * Values in the report are 0–100, so divide by 10. Falls back to 5/10 when missing.
 */
export function writingFromReport(report) {
  const m = report?.scores || {};
  const metrics = report?.metrics || report?.aiMetrics || {};
  const pct = (v, fallback) => (Number.isFinite(Number(v)) ? clamp(Number(v) / 10) : fallback);
  const wq = pct(m.writingQualityScore, 5);
  return {
    grammar: pct(metrics.grammar, wq),
    clarity: pct(metrics.coherence ?? metrics.clarity, wq),
    structure: pct(metrics.argumentStrength ?? metrics.structure, wq),
    content: wq,
  };
}
