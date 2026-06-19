import { Router } from 'express';
import { detectAIWithHuggingFace } from '../services/huggingFaceService.js';
import { checkGrammarWithVWT } from '../services/vwtService.js';

const router = Router();

/**
 * POST /api/analyze
 * Body: { text }
 * Runs Hugging Face (AI detection) + Virtual Writing Tutor (grammar/writing) in parallel
 * and returns the combined format. Never throws on a single provider failure.
 */
router.post('/', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (text.length < 10) {
      return res.status(400).json({ error: 'Content too short for analysis (min 10 characters).' });
    }

    const [ai, writing] = await Promise.all([
      detectAIWithHuggingFace(text),
      checkGrammarWithVWT(text),
    ]);

    const anyFailed = !ai.available || !writing.available;

    res.json({
      aiScore: ai.available ? ai.aiScore : 0,
      aiClassification: ai.available ? ai.classification : 'Unknown',
      grammarErrors: writing.available ? writing.grammarErrors : 0,
      feedback: writing.available ? writing.feedback : [],
      writingScore: writing.available ? writing.writingScore : 0,
      providers: {
        aiDetector: ai.available ? 'ok' : ai.reason || 'unavailable',
        vwt: writing.available ? 'ok' : writing.reason || 'unavailable',
      },
      ...(anyFailed && {
        notice:
          'One or more analysis providers were unavailable. Results shown are partial; the submission is unaffected.',
      }),
    });
  } catch (err) {
    console.error('[analyze]', err);
    res.status(500).json({ error: 'Analysis failed', message: err.message });
  }
});

export default router;
