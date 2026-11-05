// Runs the analysis for one submission and writes it once to analysis_results (step 2.4).
//
// Which provider:
//   1. ai_provider flag = 'legacy'           -> legacy, fallback_reason 'flag_legacy'
//   2. OpenAI key or model not set            -> legacy, 'openai_not_configured'
//   3. licensing_enabled and the college's
//      monthly budget is spent (or no licence) -> legacy, 'budget_reached'
//   4. otherwise OpenAI; if it errors, times out or its reply fails the schema
//                                             -> legacy, 'openai_error' | 'openai_timeout' | 'openai_invalid_output'
// ai_detection_enabled = false drops AI likelihood and flags whichever provider runs.
// Every external call is recorded in usage (college, tokens, cost estimate, outcome).
//
// It never throws because a provider failed: if nothing works, the row says 'unavailable'.
// A submission must never fail because analysis failed (CLAUDE.md).
import { getFlag as defaultGetFlag } from '../../src/flags/index.js';
import { validateAnalysisResult } from './validate.js';

/** Spent this calendar month (UTC) vs the current licence. No licence counts as no budget. */
export async function budgetReached(q, collegeId) {
  if (!collegeId) return false;
  const { rows } = await q.query(
    `SELECT l.monthly_ai_budget_usd AS budget,
            (SELECT COALESCE(sum(u.cost_usd), 0) FROM usage u
              WHERE u.college_id = $1
                AND u.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS spent
       FROM (SELECT 1) one
       LEFT JOIN LATERAL (
         SELECT monthly_ai_budget_usd FROM licences
          WHERE college_id = $1 AND starts_on <= current_date AND (ends_on IS NULL OR ends_on >= current_date)
          ORDER BY starts_on DESC LIMIT 1
       ) l ON true`,
    [collegeId]
  );
  const { budget, spent } = rows[0];
  if (budget == null) return true;
  return Number(spent) >= Number(budget);
}

const MIN_CHARS = 10;

const EMPTY_RESULT = Object.freeze({
  ai_likelihood: null,
  flagged_sentences: [],
  writing_quality: null,
  writing_feedback: { strengths: [], weaknesses: [], summary: 'Analysis was unavailable for this submission.' },
  difficulty: null,
  grade_explanation: null,
});

/**
 * @param {{ openai: ReturnType<import('./openaiProvider.js').createOpenAIProvider>,
 *           legacy: ReturnType<import('./legacyProvider.js').createLegacyProvider>,
 *           getFlag?: (name: string) => Promise<unknown> }} deps
 */
export function createAnalysisService({ openai, legacy, getFlag = defaultGetFlag }) {
  /**
   * Analyse `text` for a submission and insert the analysis_results row and usage rows with `q`.
   * @returns the inserted analysis_results row
   */
  async function run(q, { submissionId, text, collegeId = null, courseId = null, provider: wanted = 'auto' }) {
    // Nothing worth sending (an empty or near-empty file): no paid call, the row says why.
    if (String(text ?? '').trim().length < MIN_CHARS) {
      return insert(q, {
        submissionId,
        provider: 'legacy',
        status: 'unavailable',
        result: { ...EMPTY_RESULT, writing_feedback: { ...EMPTY_RESULT.writing_feedback, summary: 'The submitted text was too short to analyse.' } },
      });
    }
    const aiDetection = (await getFlag('ai_detection_enabled')) !== false;
    let reason = null;
    // A lecturer's re-run can ask for a provider; 'auto' follows the ai_provider flag.
    if (wanted === 'legacy' || (wanted === 'auto' && (await getFlag('ai_provider')) === 'legacy')) reason = 'flag_legacy';
    else if (!openai.configured) reason = 'openai_not_configured';
    else if ((await getFlag('licensing_enabled')) === true && (await budgetReached(q, collegeId))) reason = 'budget_reached';

    const usage = [];
    let provider;
    let model = null;
    let status;
    let result;

    if (!reason) {
      const r = await openai.analyse(text);
      usage.push(r.usage);
      if (r.ok) {
        provider = 'openai';
        model = openai.model;
        status = 'completed';
        result = r.result;
      } else {
        reason = r.reason;
      }
    }
    if (reason) {
      const l = await legacy.analyse(text, { aiDetection });
      usage.push(...l.usage);
      provider = 'legacy';
      status = l.status;
      result = l.result;
    }
    if (!aiDetection) result = { ...result, ai_likelihood: null, flagged_sentences: [] };
    // Defence in depth: nothing reaches the table without passing the schema.
    if (!validateAnalysisResult(result).valid) {
      status = 'unavailable';
      result = EMPTY_RESULT;
    }

    const row = await insert(q, { submissionId, provider, model, status, reason, result });
    for (const u of usage) {
      await q.query(
        `INSERT INTO usage (college_id, course_id, submission_id, provider, model, outcome, prompt_tokens, completion_tokens, cost_usd, latency_ms)
         VALUES ((SELECT id FROM colleges WHERE id = $1::uuid), $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [collegeId, courseId, submissionId, u.provider, u.model, u.outcome, u.promptTokens, u.completionTokens, u.costUsd, u.latencyMs]
      );
    }
    return row;
  }

  async function insert(q, { submissionId, provider, model = null, status, reason = null, result }) {
    const { rows } = await q.query(
      `INSERT INTO analysis_results (submission_id, provider, model, status, fallback_reason, ai_likelihood, flagged_sentences,
                                     writing_quality, writing_feedback, difficulty, grade_explanation, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        submissionId,
        provider,
        model,
        status,
        reason,
        result.ai_likelihood,
        JSON.stringify(result.flagged_sentences),
        result.writing_quality,
        JSON.stringify(result.writing_feedback),
        result.difficulty,
        result.grade_explanation,
        JSON.stringify(result),
      ]
    );
    return rows[0];
  }

  return { run };
}
