import { signOut } from 'firebase/auth';
import { logger } from '../utils/logger';
import { getFirebaseAuth } from '../firebase/config';
import { isTokenRevoked } from '../utils/authRole';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Every backend call except /api/health sends the Firebase ID token (docs/auth-contract.md).
// The SDK refreshes the token itself; pass forceRefresh after a role change.
export async function authHeaders({ forceRefresh = false } = {}) {
  const user = getFirebaseAuth()?.currentUser;
  if (!user) return {};
  return { Authorization: `Bearer ${await user.getIdToken(forceRefresh)}` };
}

async function apiFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (isTokenRevoked(res.status, data)) {
    // An admin changed this user's role; the old session must end.
    const auth = getFirebaseAuth();
    if (auth) await signOut(auth);
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Pick student or lecturer once, right after sign-up. Returns { role, collegeId }. */
export function chooseRole(role) {
  return apiFetch('/api/auth/role', { method: 'POST', body: { role } });
}

export async function submitForCheck(payload) {
  try {
    return await apiFetch('/api/check', { method: 'POST', body: payload });
  } catch (err) {
    // ANY failure (backend unreachable, OpenAI quota exceeded, API/server error)
    // must NOT block submission. Return an "AI evaluation unavailable" report so the
    // submission still completes and the lecturer sees the fallback message.
    logger.warn('[api] Check failed, submitting with AI evaluation unavailable:', err.message);
    return {
      report: buildUnavailableReport(payload),
      extraction: {
        text: payload.text || '',
        html: payload.html || '',
        wordCount: (payload.text || '').split(/\s+/).filter(Boolean).length,
      },
    };
  }
}

export const AI_UNAVAILABLE_MESSAGE =
  'AI evaluation unavailable — submission received successfully. The work has been ' +
  'delivered to the lecturer; automated writing analysis could not be generated at this time.';

export async function healthCheck() {
  const res = await fetch(`${API_BASE}/api/health`);
  return res.json();
}

// ── Fallback report when the check service / AI evaluation is unavailable ──
// No score is produced (spec: "no score, message only"). Submission still completes,
// and the lecturer sees the unavailable message. Plagiarism can't run client-side,
// so it's reported as unknown (0) and the lecturer reviews manually.

function buildUnavailableReport({ userId, fileId, groupId, fileName, studentName, difficulty = 1, versions = [], pasteEvents = [] }) {
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
