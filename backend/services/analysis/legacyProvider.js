// The backup provider: Hugging Face (AI likelihood and flagged sentences) and Virtual Writing
// Tutor (grammar and writing score), the services /api/check has always used, mapped to the
// analysis-result.json shape. Each service already returns { available:false } instead of
// throwing, so this never throws either.
import { detectAIWithHuggingFace } from '../huggingFaceService.js';
import { checkGrammarWithVWT } from '../vwtService.js';
import { detectContentDifficulty } from '../../../src/utils/difficultyDetection.js';
import { keepVerbatim } from './text.js';

/**
 * @param {{ detectAI?, checkGrammar?, now? }} [deps] the real services by default; tests pass stubs.
 */
export function createLegacyProvider({ detectAI = detectAIWithHuggingFace, checkGrammar = checkGrammarWithVWT, now = Date.now } = {}) {
  /**
   * @returns {{ status: 'completed'|'partial'|'unavailable', result, usage: object[] }}
   *   usage: one row per external call, for the usage table.
   */
  async function analyse(text, { aiDetection = true } = {}) {
    const timed = async (provider, fn) => {
      const started = now();
      const out = await fn();
      return { out, row: { provider, model: null, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: now() - started, outcome: out.available ? 'ok' : 'error' } };
    };
    const [ai, writing] = await Promise.all([
      aiDetection ? timed('huggingface', () => detectAI(text)) : null,
      timed('vwt', () => checkGrammar(text)),
    ]);
    const aiOk = Boolean(ai?.out.available);
    const writingOk = Boolean(writing.out.available);

    const flags = aiOk
      ? keepVerbatim(
          (ai.out.flaggedSegments || []).map((s) => ({ sentence: String(s.text).slice(0, 1000), reason: String(s.reason || 'Flagged as likely AI-generated').slice(0, 500) })),
          text
        )
      : [];
    const quality = writingOk ? Math.round(writing.out.writingScore) / 10 : null;
    const feedback = writingOk ? (writing.out.feedback || []).filter(Boolean).slice(0, 10).map((f) => String(f).slice(0, 300)) : [];
    const difficulty = Math.min(3, Math.max(1, Math.round(detectContentDifficulty({ text }))));

    const result = {
      ai_likelihood: aiOk ? ai.out.aiScore : null,
      flagged_sentences: flags,
      writing_quality: quality,
      writing_feedback: {
        strengths: [],
        weaknesses: feedback,
        summary: writingOk
          ? `${writing.out.grammarErrors} grammar issue(s) found by Virtual Writing Tutor.`
          : 'Writing analysis was unavailable for this submission.',
      },
      difficulty,
      grade_explanation: writingOk
        ? `Writing quality ${quality}/10 comes from Virtual Writing Tutor's grammar check (${writing.out.grammarErrors} issue(s)).`
        : null,
    };
    const expected = aiDetection ? 2 : 1;
    const working = (aiOk ? 1 : 0) + (writingOk ? 1 : 0);
    const status = working === 0 ? 'unavailable' : working < expected ? 'partial' : 'completed';
    return { status, result, usage: [ai?.row, writing.row].filter(Boolean) };
  }

  return { analyse };
}
