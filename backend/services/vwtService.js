import axios from 'axios';

const VWT_URL = 'https://console.virtualwritingtutor.com/console/grammar/check-grammar';
const TIMEOUT_MS = 20000;

/**
 * Grammar + writing evaluation via Virtual Writing Tutor.
 * Returns a normalised shape:
 *   { available, grammarErrors (number), feedback (string[]), writingScore (0-100), raw }
 * Returns { available:false } on missing key / failure so callers can fall back.
 */
export async function checkGrammarWithVWT(text) {
  const apiKey = process.env.VWT_API_KEY;
  if (!apiKey || apiKey === 'your_vwt_key_here') {
    return { available: false, reason: 'no-key' };
  }
  if (!text || text.trim().length < 10) {
    return { available: false, reason: 'too-short' };
  }

  try {
    const { data } = await axios.post(
      VWT_URL,
      { text },
      {
        headers: { vwtApiKey: apiKey, 'Content-Type': 'application/json' },
        timeout: TIMEOUT_MS,
      }
    );

    // VWT's real response shape (verified against the live API):
    //   error_grammar_count_total : number of grammar/spelling errors
    //   error_grammar_percent     : "27%" — VWT's own error-density estimate
    //   check_grammar_feedback    : [{ error_grammar, feedback_grammar, feedback_grammar_suggestion }]
    // (older defensive fallbacks kept in case the schema shifts.)
    const fb = Array.isArray(data?.check_grammar_feedback)
      ? data.check_grammar_feedback
      : (data?.matches || data?.errors || []);

    const grammarErrors =
      typeof data?.error_grammar_count_total === 'number'
        ? data.error_grammar_count_total
        : (Array.isArray(fb) ? fb.length : 0);

    const feedback = Array.isArray(fb)
      ? fb
          .map((m) => m.feedback_grammar || m.message || m.shortMessage || m.suggestion || '')
          .filter(Boolean)
          .slice(0, 12)
      : [];

    // Writing score derived from VWT's own error-percent when present, else from error
    // density. error_grammar_percent like "27%" means ~27% of checks flagged an issue —
    // a higher percent → lower score. Penalty is weighted so heavy-error text drops clearly.
    const wordCount = text.split(/\s+/).filter(Boolean).length || 1;
    let writingScore;
    const pctRaw = parseFloat(String(data?.error_grammar_percent ?? '').replace('%', ''));
    if (!Number.isNaN(pctRaw)) {
      writingScore = clampPct(100 - pctRaw * 1.5); // 27% errors → ~60; 0% → 100
    } else {
      const errorDensity = (grammarErrors / wordCount) * 100;
      writingScore = clampPct(100 - errorDensity * 6);
    }

    return { available: true, grammarErrors, feedback, writingScore, raw: data };
  } catch (err) {
    console.error('[VWT] request failed:', err.response?.status || '', err.message);
    return { available: false, reason: 'error', message: err.message };
  }
}

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
}
