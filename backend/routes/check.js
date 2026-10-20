import { Router } from 'express';
import { detectAIWithHuggingFace } from '../services/huggingFaceService.js';
import { checkGrammarWithVWT } from '../services/vwtService.js';
import { buildSubmissionReport } from '../services/reportGenerator.js';
import { getFlag } from '../src/flags/index.js';
import { reportTabs } from '../src/tabs/reportTabs.js';

const router = Router();
const CONTENT_TOO_SHORT_MESSAGE = 'Content too short for analysis (min 10 characters).';

/**
 * POST /api/check — submission analysis used by the Peerlytics submission flow.
 * AI detection now comes from GPTZero, grammar/writing from Virtual Writing Tutor
 * (both called in parallel). "Plagiarism" is the copy-paste percentage derived from
 * the submission's paste events (real signal; EyeSift was removed). The report shape
 * is unchanged so the existing lecturer UI (AI Report / Analysis / Grading) keeps working.
 */
router.post('/', async (req, res, next) => {
  try {
    res.json(await analyzeSubmission(req.body || {}));
  } catch (err) {
    if (err.code === 'CONTENT_TOO_SHORT') {
      return res.status(400).json({ error: CONTENT_TOO_SHORT_MESSAGE });
    }
    return next(err);
  }
});

/**
 * The analysis behind POST /api/check, also used by the server-side deadline job
 * (backend/src/jobs/deadlines). Throws an error with status 400 for content under 10 characters.
 */
export async function analyzeSubmission(body) {
    const {
      text,
      html,
      userId,
      fileId,
      groupId,
      fileName,
      versions = [],
      pasteEvents = [],
      difficulty = 1,
      studentName,
      tabs,
    } = body;
    const plainText = (text || '').trim() || stripHtml(html || '');

    if (plainText.length < 10) {
      throw Object.assign(new Error(CONTENT_TOO_SHORT_MESSAGE), { status: 400, code: 'CONTENT_TOO_SHORT' });
    }

    // Both providers run simultaneously; neither failing blocks the submission.
    // ai_detection_enabled off: detection is skipped and reported as unavailable.
    const aiDetectionOn = await getFlag('ai_detection_enabled');
    const [aiResult, writing] = await Promise.all([
      aiDetectionOn ? detectAIWithHuggingFace(plainText) : { available: false, reason: 'disabled' },
      checkGrammarWithVWT(plainText),
    ]);

    // Map provider output into the shape reportGenerator expects.
    // If BOTH AI + writing providers are unavailable, mark AI evaluation unavailable
    // so the report shows the graceful fallback (submission still succeeds).
    const aiAvailable = aiResult.available || writing.available;
    const ai = {
      aiAvailable,
      // Whether GPTZero (AI detection) specifically succeeded. When false, the UI shows
      // "AI detection currently unavailable" rather than a misleading 0% score.
      aiDetectionAvailable: aiResult.available,
      // Whether VWT (writing analysis) succeeded. When false the UI hides the
      // writing-quality score instead of showing a misleading default (e.g. 100/100).
      writingAnalysisAvailable: writing.available,
      aiGeneratedProbability: aiResult.available ? aiResult.aiScore : 0,
      aiScore: aiResult.available ? 100 - aiResult.aiScore : 0,
      writingQualityScore: writing.available ? writing.writingScore : 50,
      // AI-suspected verbatim sentences from Hugging Face → red highlights + AI attribution.
      flaggedSegments: aiResult.available ? (aiResult.flaggedSegments || []) : [],
      metrics: {
        classification: aiResult.available ? aiResult.classification : 'Unknown',
        grammarErrors: writing.available ? writing.grammarErrors : 0,
        feedbackSuggestions: writing.available ? writing.feedback : [],
        providers: {
          aiDetector: aiResult.available ? 'ok' : aiResult.reason || 'unavailable',
          vwt: writing.available ? 'ok' : writing.reason || 'unavailable',
        },
      },
    };

    // "Plagiarism" = copy-paste percentage from paste events vs total content length.
    const pastedChars = pasteEvents.reduce(
      (sum, p) => sum + String(p.contentSnippet || '').length,
      0
    );
    const pastePct = plainText.length
      ? Math.min(100, Math.round((pastedChars / plainText.length) * 100))
      : 0;
    const plagiarism = { plagiarismScore: pastePct, flaggedSegments: [], source: 'paste' };

    const report = buildSubmissionReport({
      text: plainText,
      ai,
      plagiarism,
      meta: {
        userId,
        fileId,
        groupId,
        fileName,
        studentName,
        htmlLength: (html || '').length,
        difficulty,
        versionCount: versions.length,
        pasteEventCount: pasteEvents.length,
        largePasteCount: pasteEvents.filter((p) => p.changeType === 'paste-large').length,
        versions: versions.slice(0, 15),
        pasteEvents: pasteEvents.slice(0, 20),
      },
    });

    // Document tab titles (step 2.3) stay on the report.
    const keptTabs = reportTabs(tabs);
    if (keptTabs) report.tabs = keptTabs;

    return {
      success: true,
      report,
      extraction: {
        text: plainText,
        html: html || '',
        wordCount: plainText.split(/\s+/).filter(Boolean).length,
      },
    };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'peerlytics-check' });
});

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default router;
