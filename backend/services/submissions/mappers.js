// submissions and analysis_results rows -> the Submission and AnalysisResult shapes in
// backend/openapi.yaml.
import { iso } from '../courses/mappers.js';

export const AI_NOTICE = 'AI likelihood is a signal, not proof. A lecturer reviews every flag.';

/** `viewerUid`: a student sees only their own author metrics; null shows everyone's (staff). */
export function submission(row, { viewerUid = null } = {}) {
  const metrics = row.author_metrics || {};
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    submittedBy: row.submitted_by ? { id: row.submitted_by, displayName: row.submitted_by_name ?? row.submitted_by } : null,
    trigger: row.trigger,
    wordCount: row.word_count,
    tabs: row.tabs ?? null,
    authorMetrics: viewerUid ? (metrics[viewerUid] ? { [viewerUid]: metrics[viewerUid] } : {}) : metrics,
    submittedAt: iso(row.submitted_at),
  };
}

export function analysisResult(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    fallbackReason: row.fallback_reason,
    aiLikelihood: row.ai_likelihood,
    flaggedSentences: row.flagged_sentences,
    writingQuality: row.writing_quality == null ? null : Number(row.writing_quality),
    writingFeedback: row.writing_feedback,
    difficulty: row.difficulty,
    gradeExplanation: row.grade_explanation,
    notice: AI_NOTICE,
    createdAt: iso(row.created_at),
  };
}
