import axios from 'axios';

// AI detection via Hugging Face Inference Providers (router.huggingface.co — the current
// endpoint; the old api-inference host was deprecated and no longer serves text-classification
// detectors). We ask a free open chat model to RATE the AI-likelihood of the text and return
// a number, then normalise to the same shape the rest of the app expects:
//   { available, aiScore (0-100), classification: 'AI'|'Mixed'|'Human', raw }
//
// This is a SIGNAL for a prototype, not a forensic detector. On any failure we return
// { available:false } so the submission flow degrades gracefully ("AI checker unavailable").
const HF_URL = 'https://router.huggingface.co/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/Llama-3.1-8B-Instruct:fastest';
const TIMEOUT_MS = 30000;

const SYSTEM_PROMPT =
  'You are an AI-text detector. Given a student submission, estimate the probability it was ' +
  'AI/LLM-generated AND quote the exact sentences that look most AI-generated (verbatim, copied ' +
  'character-for-character from the text). Respond with ONLY a compact JSON object, no prose:\n' +
  '{"ai_probability": <integer 0-100>, "reason": "<short phrase>", "ai_excerpts": ["<verbatim sentence>", ...]}\n' +
  'Rules: ai_excerpts must be EXACT substrings of the submission (no paraphrasing), at most 5, ' +
  'each at least 8 words. If the text seems human, return an empty ai_excerpts array. ' +
  'Be conservative; avoid false accusations.';

export async function detectAIWithHuggingFace(text) {
  const apiKey = process.env.HF_API_KEY;
  const model = process.env.HF_AI_MODEL || DEFAULT_MODEL;
  if (!apiKey || apiKey === 'your_hf_key_here') {
    return { available: false, reason: 'no-key' };
  }
  if (!text || text.trim().length < 30) {
    return { available: false, reason: 'too-short' };
  }

  // Retry transient failures (cold-start 503, timeout, 429) a couple of times so a single
  // hiccup doesn't get permanently frozen into the submission report as "unavailable".
  const payload = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Text to assess:\n"""\n${text.slice(0, 4000)}\n"""` },
    ],
    temperature: 0,
    max_tokens: 80,
  };
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  let data, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ({ data } = await axios.post(HF_URL, payload, { headers, timeout: TIMEOUT_MS }));
      break;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retriable = !status || status === 503 || status === 429 || status === 500 || err.code === 'ECONNABORTED';
      if (!retriable || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // backoff
    }
  }
  if (!data) {
    console.error('[HuggingFace] request failed after retries:', lastErr?.response?.status || '', lastErr?.message);
    return { available: false, reason: 'error', message: lastErr?.message };
  }

  try {
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonish(content);
    if (parsed == null || parsed.ai_probability == null) {
      return { available: false, reason: 'bad-response', raw: content };
    }
    const aiScore = clampPct(parsed.ai_probability);
    const classification = aiScore >= 70 ? 'AI' : aiScore >= 40 ? 'Mixed' : 'Human';
    // Verbatim AI-suspected sentences → flaggedSegments (so the document can show red
    // highlights and the grader can attribute AI content to whoever wrote it). We keep
    // only excerpts that are actually present in the source text (the LLM occasionally
    // paraphrases) so highlighting stays accurate.
    // Normalise both sides (collapse whitespace, lowercase) before the substring test so an
    // excerpt is kept whenever it is highlightable — the document viewer normalises identically.
    // Keeping the raw excerpt text for display, but gating on the normalised match.
    const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const normText = normalize(text);
    const aiExcerpts = Array.isArray(parsed.ai_excerpts) ? parsed.ai_excerpts : [];
    const flaggedSegments = aiExcerpts
      .map((s) => String(s || '').trim())
      .filter((s) => s.length >= 12 && normText.includes(normalize(s)))
      .slice(0, 5)
      .map((s, i) => ({ id: `ai-${i}`, type: 'ai-generated', highlight: 'red', text: s, reason: 'Flagged as likely AI-generated' }));

    return { available: true, aiScore, classification, reason: parsed.reason || '', flaggedSegments, raw: data };
  } catch (err) {
    console.error('[HuggingFace] request failed:', err.response?.status || '', err.message);
    return { available: false, reason: 'error', message: err.message };
  }
}

// Pull the first JSON object out of the model's reply (it may add stray text/markdown).
function parseJsonish(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* try to extract */ }
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return null;
}

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
}
