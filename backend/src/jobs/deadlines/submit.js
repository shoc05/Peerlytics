// Submit one workspace file at the deadline, writing the same documents the browser's
// saveFullSubmission + notifyLecturersSubmission write (src/firebase/firestoreService.js).
// Document ids are fixed per file, so a retry after a crash overwrites instead of duplicating.
import { detectContentDifficulty } from '../../../../src/utils/difficultyDetection.js';

export const AUTO_SUBMITTER = 'deadline';
export const AUTO_SUBMITTER_NAME = 'Deadline auto-submit';

const AI_UNAVAILABLE_MESSAGE =
  'AI evaluation unavailable — submission received successfully. The work has been ' +
  'delivered to the lecturer; automated writing analysis could not be generated at this time.';

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Same shape as buildUnavailableReport in src/services/api.js: no score, message only. */
export function buildUnavailableReport({ reportId, nowIso, userId, fileId, groupId, fileName, studentName, difficulty, versions, pasteEvents }) {
  const largePasteCount = pasteEvents.filter((p) => p.changeType === 'paste-large').length;
  return {
    id: reportId,
    createdAt: nowIso,
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

const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * Returns { submitted: true, reportId } or { skipped: reason }. `analyze` is analyzeSubmission
 * from backend/routes/check.js; if it fails, the "AI evaluation unavailable" report is used,
 * so a submission never fails because analysis failed.
 */
export async function submitFile({ db, groupId, group, file, analyze, nowMs, log = () => {} }) {
  const groupRef = db.collection('groups').doc(groupId);
  const contentSnap = await db.collection('documents').doc(file.id).get();
  const stored = contentSnap.exists ? contentSnap.data() : {};
  const html = stored.html || file.contentHtml || '';
  const text = stored.text || file.content || stripHtml(html);
  if (text.trim().length < 10) return { skipped: 'too-short' };

  const [versionSnap, pasteSnap, analyticsSnap] = await Promise.all([
    groupRef.collection('versions').where('fileId', '==', file.id).get(),
    groupRef.collection('pasteEvents').where('fileId', '==', file.id).get(),
    db.collection('analytics').doc(groupId).collection('members').get(),
  ]);
  const versions = docsOf(versionSnap).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 25);
  // Paste events keep each author's userId, so per-student penalties still apply.
  const pasteEvents = docsOf(pasteSnap);
  const analytics = docsOf(analyticsSnap);

  const nowIso = new Date(nowMs).toISOString();
  const reportId = `auto_${groupId}_${file.id}`;
  const difficulty = detectContentDifficulty({ text, html, type: file.type });
  const input = {
    text,
    html,
    userId: AUTO_SUBMITTER,
    fileId: file.id,
    groupId,
    fileName: file.name,
    studentName: AUTO_SUBMITTER_NAME,
    difficulty,
    versions,
    pasteEvents,
  };

  let report;
  try {
    ({ report } = await analyze(input));
  } catch (err) {
    log(`[deadlines] analysis failed for ${groupId}/${file.id}, using the unavailable report: ${err.message}`);
  }
  report = { ...(report || buildUnavailableReport({ ...input, reportId, nowIso })), id: reportId };

  const trimmedVersions = versions.slice(0, 25);
  const trimmedPastes = pasteEvents.slice(0, 30);
  const aiReport = {
    aiScore: report.scores?.aiUsageScore ?? report.scores?.aiAuthenticityScore ?? 0,
    plagiarismScore: report.scores?.plagiarismScore ?? 0,
    feedback: report.feedback || {},
  };
  const documentContent = { html, text };
  const common = { fileId: file.id, groupId, workspaceId: groupId };
  const createdAt = new Date(nowMs);

  await db.collection('reports').doc(reportId).set(
    {
      ...report,
      ...common,
      userId: AUTO_SUBMITTER,
      documentId: file.id,
      projectId: groupId,
      studentName: AUTO_SUBMITTER_NAME,
      submittedAt: nowIso,
      updatedAt: nowIso,
      autoSubmitted: true,
      documentContent,
      versionHistory: trimmedVersions,
      pasteEvents: trimmedPastes,
      analytics,
      aiReport,
      aiScore: aiReport.aiScore,
      plagiarismScore: aiReport.plagiarismScore,
      feedback: report.feedback ?? {},
      createdAt,
    },
    { merge: true }
  );

  // Per-file lock marker, as saveSubmissionReport writes it.
  await db.collection('submissions').doc(`${file.id}_${AUTO_SUBMITTER}`).set(
    { ...common, userId: AUTO_SUBMITTER, reportId, status: 'submitted', locked: true, submittedAt: nowIso },
    { merge: true }
  );

  // One full submission per lecturer, as saveFullSubmission writes them.
  const lecturerIds = group.lecturerIds || [];
  const payload = {
    workspaceId: groupId,
    submittedBy: AUTO_SUBMITTER,
    submittedByName: AUTO_SUBMITTER_NAME,
    autoSubmitted: true,
    classSection: '',
    lecturerEmail: null,
    type: 'file',
    fileId: file.id,
    fileName: file.name || null,
    folderId: null,
    folderName: null,
    reportId,
    status: 'submitted',
    submittedAt: nowIso,
    createdAt,
    documentContent,
    versionHistory: trimmedVersions,
    pasteEvents: trimmedPastes,
    analytics,
    aiReport,
  };
  const baseId = `auto_${groupId}_${file.id}`;
  const targets = lecturerIds.length ? lecturerIds : [null];
  for (const lid of targets) {
    const sid = targets.length === 1 ? baseId : `${baseId}_${lid}`;
    await db.collection('submissions').doc(sid).set({
      id: sid,
      ...payload,
      lecturerId: lid,
      parentSubmissionId: targets.length > 1 ? baseId : null,
    });
  }

  await groupRef.collection('files').doc(file.id).set(
    { submitted: true, autoSubmitted: true, submittedAt: nowIso, updatedAt: createdAt },
    { merge: true }
  );

  const message = `${AUTO_SUBMITTER_NAME} submitted "${file.name}" for review at the deadline. Report: ${reportId}`;
  await groupRef.collection('activity').doc(`auto_${file.id}`).set({ user: 'System', action: message, timestamp: nowMs, createdAt });
  for (const lid of lecturerIds) {
    await groupRef.collection('notifications').doc(`auto_${file.id}_${lid}`).set({
      lecturerId: lid,
      message,
      reportId,
      read: false,
      createdAt,
    });
  }

  return { submitted: true, reportId };
}
