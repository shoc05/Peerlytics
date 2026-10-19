// Backend endpoints, built on a client from createApiClient (src/api/client.js).
// Kept free of Firebase imports so they can be tested with a stubbed client.

export const AI_UNAVAILABLE_MESSAGE =
  'AI evaluation unavailable — submission received successfully. The work has been ' +
  'delivered to the lecturer; automated writing analysis could not be generated at this time.';

// ── Fallback report when the check service / AI evaluation is unavailable ──
// No score is produced (spec: "no score, message only"). Submission still completes,
// and the lecturer sees the unavailable message. Plagiarism can't run client-side,
// so it's reported as unknown (0) and the lecturer reviews manually.
export function buildUnavailableReport({ userId, fileId, groupId, fileName, studentName, difficulty = 1, versions = [], pasteEvents = [] }) {
  const largePasteCount = pasteEvents.filter((p) => p.changeType === 'paste-large').length;
  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    meta: { userId, fileId, groupId, fileName, studentName, difficulty, versionCount: versions.length, pasteEventCount: pasteEvents.length, largePasteCount },
    scores: {},
    flaggedContent: [],
    feedback: {
      strengths: [],
      weaknesses: [],
      summary: AI_UNAVAILABLE_MESSAGE,
      pasteReview: pasteEvents.length > 0 ? `${pasteEvents.length} paste/edit event(s) logged.` : 'No paste events flagged.',
    },
    audit: { versionCount: versions.length, pasteEventCount: pasteEvents.length, largePasteCount, difficulty },
    recommendation: 'Manual review',
    suggestedGrade: null,
    status: 'completed',
    aiEvaluation: 'unavailable',
    aiUnavailableMessage: AI_UNAVAILABLE_MESSAGE,
  };
}

export function createApi(client, { warn = () => {} } = {}) {
  return {
    /** Pick student or lecturer once, right after sign-up. Returns { role, collegeId }. */
    chooseRole: (role) => client.request('/api/auth/role', { method: 'POST', body: { role } }),

    /** The signed-in user as the backend sees them: { uid, email, role, collegeId }. */
    getMe: () => client.request('/api/auth/me'),

    /** Lecturer: give one group a new deadline (step 4.6). deadline is an ISO string. */
    grantExtension: (groupId, { deadline, reason }) =>
      client.request(`/api/groups/${encodeURIComponent(groupId)}/extension`, { method: 'POST', body: { deadline, reason } }),

    async submitForCheck(payload) {
      try {
        return await client.request('/api/check', { method: 'POST', body: payload });
      } catch (err) {
        // ANY failure (backend unreachable, OpenAI quota exceeded, API/server error)
        // must NOT block submission. Return an "AI evaluation unavailable" report so the
        // submission still completes and the lecturer sees the fallback message.
        warn('[api] Check failed, submitting with AI evaluation unavailable:', err.message);
        return {
          report: buildUnavailableReport(payload),
          extraction: {
            text: payload.text || '',
            html: payload.html || '',
            wordCount: (payload.text || '').split(/\s+/).filter(Boolean).length,
          },
        };
      }
    },

    /** The only call without an Authorization header. */
    healthCheck: () => client.request('/api/health', { auth: false }),
  };
}
