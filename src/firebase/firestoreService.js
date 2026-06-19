import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  arrayUnion,
} from 'firebase/firestore';
import { getFirestoreDb } from './config';
import { logger } from '../utils/logger';

function db() {
  const firestore = getFirestoreDb();
  if (!firestore) throw new Error('Firestore is not configured. Check VITE_FIREBASE_* in .env');
  return firestore;
}

// ——— Users ———

export async function createUserProfile({ uid, email, name, role, groupId, classSection }) {
  await setDoc(doc(db(), 'users', uid), {
    uid,
    email,
    name,
    role,
    classSection: classSection || '',
    groupId: groupId || null,
    createdAt: serverTimestamp(),
  });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db(), 'users', uid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Fetch multiple user profiles by uid (deduped). Used by the lecturer Reports view to resolve
// each student's class/section. Reads are allowed for any signed-in user (users rule), and
// missing/denied docs are skipped. Returns a { uid: profile } map.
export async function getUsersByIds(uids = []) {
  const unique = [...new Set(uids.filter(Boolean))];
  const out = {};
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const p = await getUserProfile(uid);
        if (p) out[uid] = p;
      } catch { /* skip unreadable */ }
    })
  );
  return out;
}

export async function updateUserProfile(uid, { name, email }) {
  if (!uid) throw new Error('User ID required');
  await updateDoc(doc(db(), 'users', uid), {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    updatedAt: serverTimestamp(),
  });
  return getUserProfile(uid);
}

export async function deleteUserProfile(uid) {
  if (!uid) throw new Error('User ID required');
  await deleteDoc(doc(db(), 'users', uid));
}

// ——— Groups ———

export async function createProjectGroup({ name, ownerId, ownerName, ownerRole, deadline }) {
  const groupId = `group-${Date.now()}`;
  const group = {
    id: groupId,
    name: name?.trim() || 'New Project',
    createdDate: new Date().toISOString(),
    deadline: deadline || null,
    memberIds: ownerRole === 'lecturer' ? [] : [ownerId],
    lecturerIds: ownerRole === 'lecturer' ? [ownerId] : [],
    submittedToLecturers: [],
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db(), 'groups', groupId), group);
  // No default folders — workspaces start empty; users create their own folders.

  const userRef = doc(db(), 'users', ownerId);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const profile = userSnap.data();
    if (!profile.groupId) {
      await updateDoc(userRef, { groupId });
    }
  }

  if (ownerRole !== 'lecturer') {
    await addGroupMember(groupId, { uid: ownerId, name: ownerName, role: 'student' });
  }

  return group;
}

export function subscribeGroupsForUser(userId, callback) {
  if (!userId) return () => {};
  const userGroups = new Map();
  const lecturerGroups = new Map();

  const emit = () => {
    const merged = Array.from(new Map([...userGroups, ...lecturerGroups]).values());
    merged.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    callback(merged);
  };

  const memberQuery = query(collection(db(), 'groups'), where('memberIds', 'array-contains', userId));
  const lecturerQuery = query(collection(db(), 'groups'), where('lecturerIds', 'array-contains', userId));

  const userUnsub = onSnapshot(
    memberQuery,
    (snap) => {
      userGroups.clear();
      snap.docs.forEach((d) => userGroups.set(d.id, { id: d.id, ...d.data() }));
      emit();
    },
    (err) => {
      logger.error('[subscribeGroupsForUser] member query', err);
    }
  );

  const lecturerUnsub = onSnapshot(
    lecturerQuery,
    (snap) => {
      lecturerGroups.clear();
      snap.docs.forEach((d) => lecturerGroups.set(d.id, { id: d.id, ...d.data() }));
      emit();
    },
    (err) => {
      logger.error('[subscribeGroupsForUser] lecturer query', err);
    }
  );

  return () => {
    userUnsub();
    lecturerUnsub();
  };
}

export async function getGroup(groupId) {
  const snap = await getDoc(doc(db(), 'groups', groupId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export function subscribeGroup(groupId, callback) {
  return onSnapshot(doc(db(), 'groups', groupId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// ——— Members / analytics ———

export async function addGroupMember(groupId, { uid, name, role }) {
  if (!groupId || !uid) return;
  const groupRef = doc(db(), 'groups', groupId);
  const groupSnap = await getDoc(groupRef);
  const data = groupSnap.exists() ? groupSnap.data() : {};
  const memberIds = data.memberIds || [];
  const lecturerIds = data.lecturerIds || [];
  if (role === 'Lecturer' || role === 'lecturer') {
    if (!lecturerIds.includes(uid)) {
      await updateDoc(groupRef, { lecturerIds: [...lecturerIds, uid] });
    }
  } else if (!memberIds.includes(uid)) {
    await updateDoc(groupRef, { memberIds: [...memberIds, uid] });
  }

  const memberRef = doc(db(), 'analytics', groupId, 'members', uid);
  const memberSnap = await getDoc(memberRef);
  if (!memberSnap.exists()) {
    await setDoc(memberRef, {
      uid,
      name,
      role: role || 'Member',
      edits: 0,
      timeSpent: 0,
      taskCompletion: 0,
      difficulty: 1,
      contributions: [0, 0, 0, 0, 0, 0],
      heatmap: [0, 0, 0, 0, 0, 0, 0],
    });
  }

}

export async function sendUserNotification(targetUserId, payload) {
  if (!targetUserId) return;
  await addDoc(collection(db(), 'users', targetUserId, 'notifications'), {
    ...payload,
    read: false,
    createdAt: serverTimestamp(),
  });
}

export async function notifyWorkspaceInvite(groupId, {
  targetUserId, invitedByName, invitedByUid, role, workspaceName,
}) {
  const message = `${invitedByName} invited you to join "${workspaceName}" as ${role}`;
  await sendUserNotification(targetUserId, {
    type: 'invite',
    message,
    groupId,
    workspaceName,
    invitedByName,
    invitedByUid,
    role,
  });
  await addDoc(collection(db(), 'groups', groupId, 'notifications'), {
    type: 'invite',
    targetUserId,
    message,
    invitedByName,
    invitedByUid,
    role,
    read: false,
    createdAt: serverTimestamp(),
  });
}

export function subscribeUserNotifications(userId, callback) {
  if (!userId) return () => {};
  const q = query(
    collection(db(), 'users', userId, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(30)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function inviteMemberByEmail(groupId, email, { invitedByName, invitedByUid, workspaceName } = {}) {
  const usersQ = query(collection(db(), 'users'), where('email', '==', email.trim().toLowerCase()));
  const usersSnap = await getDocs(usersQ);
  if (usersSnap.empty) {
    throw new Error('No account found for that email. Ask them to sign up first.');
  }
  const userDoc = usersSnap.docs[0];
  const data = userDoc.data();
  await addGroupMember(groupId, { uid: userDoc.id, name: data.name, role: 'Student' });
  const wsName = workspaceName || (await getDoc(doc(db(), 'groups', groupId))).data()?.name || 'workspace';
  if (invitedByName) {
    await notifyWorkspaceInvite(groupId, {
      targetUserId: userDoc.id,
      invitedByName,
      invitedByUid,
      role: 'student',
      workspaceName: wsName,
    });
  }
  return { uid: userDoc.id, name: data.name, role: 'Student' };
}

export async function inviteLecturerByEmail(groupId, email, { invitedByName, invitedByUid, workspaceName } = {}) {
  const usersQ = query(collection(db(), 'users'), where('email', '==', email.trim().toLowerCase()));
  const usersSnap = await getDocs(usersQ);
  if (usersSnap.empty) {
    throw new Error('No lecturer account found. They must sign up as Lecturer first.');
  }
  const userDocRef = usersSnap.docs[0];
  const data = userDocRef.data();
  if (data.role !== 'lecturer') {
    throw new Error('That user is not registered as a Lecturer.');
  }
  await addGroupMember(groupId, { uid: userDocRef.id, name: data.name, role: 'Lecturer' });
  const wsName = workspaceName || (await getDoc(doc(db(), 'groups', groupId))).data()?.name || 'workspace';
  if (invitedByName) {
    await notifyWorkspaceInvite(groupId, {
      targetUserId: userDocRef.id,
      invitedByName,
      invitedByUid,
      role: 'lecturer',
      workspaceName: wsName,
    });
  }
  return { uid: userDocRef.id, name: data.name, role: 'Lecturer' };
}

export async function bumpMemberActivity(groupId, uid) {
  if (!groupId || !uid) return;
  const ref = doc(db(), 'analytics', groupId, 'members', uid);
  const snap = await getDoc(ref);
  const heatmap = snap.exists() ? [...(snap.data().heatmap || [0, 0, 0, 0, 0, 0, 0])] : [0, 0, 0, 0, 0, 0, 0];
  const day = new Date().getDay();
  heatmap[day] = (heatmap[day] || 0) + 1;
  const contributions = snap.exists()
    ? [...(snap.data().contributions || [0, 0, 0, 0, 0, 0])]
    : [0, 0, 0, 0, 0, 0];
  contributions[contributions.length - 1] = (contributions[contributions.length - 1] || 0) + 1;
  await setDoc(
    ref,
    {
      heatmap,
      contributions,
      taskCompletion: Math.min(100, (snap.data()?.taskCompletion || 0) + 2),
    },
    { merge: true }
  );
}

export async function savePasteEvent(groupId, { fileId, userId, userName, changeType, pasteRanges, contentSnippet }) {
  await addDoc(collection(db(), 'groups', groupId, 'pasteEvents'), {
    fileId,
    userId,
    userName,
    changeType,
    pasteRanges,
    // Keep enough of the pasted text to highlight the WHOLE block (was 500 → only part
    // of long pastes was stored/highlighted). 20k chars is well within Firestore limits.
    contentSnippet: (contentSnippet || '').slice(0, 20000),
    timestamp: Date.now(),
    createdAt: serverTimestamp(),
  });
}

export function subscribePasteEvents(groupId, fileId, callback) {
  const q = query(collection(db(), 'groups', groupId, 'pasteEvents'), where('fileId', '==', fileId));
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    callback(list);
  });
}

export async function unlockLecturersForGroup(groupId, extraLecturerIds = []) {
  if (!groupId) return;
  const groupSnap = await getDoc(doc(db(), 'groups', groupId));
  if (!groupSnap.exists()) return;
  const lecturerIds = groupSnap.data().lecturerIds || [];
  const extras = (extraLecturerIds || []).filter(Boolean);
  const toUnlock = [...new Set([...lecturerIds, ...extras])];
  if (!toUnlock.length) return;
  // Add target lecturers to lecturerIds too — otherwise they are not group members
  // and the security rules deny their reads of reports/analytics (empty AI Report /
  // Analysis / Grading). Adding them here makes isMemberOfGroup/isLecturerOfGroup pass.
  const newLecturers = extras.filter((id) => !lecturerIds.includes(id));
  const update = { submittedToLecturers: arrayUnion(...toUnlock) };
  if (newLecturers.length) update.lecturerIds = arrayUnion(...newLecturers);
  await updateDoc(doc(db(), 'groups', groupId), update);
}

export async function getAnalyticsSnapshot(groupId) {
  if (!groupId) return [];
  const snap = await getDocs(collection(db(), 'analytics', groupId, 'members'));
  return snap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() }));
}

export async function notifyLecturersSubmission(groupId, { fileName, studentName, reportId }) {
  const groupSnap = await getDoc(doc(db(), 'groups', groupId));
  const lecturerIds = groupSnap.exists() ? groupSnap.data().lecturerIds || [] : [];
  await unlockLecturersForGroup(groupId, lecturerIds);
  const msg = `${studentName} submitted "${fileName}" for review. Report: ${reportId}`;
  await addActivity(groupId, { user: 'System', action: msg });
  for (const lid of lecturerIds) {
    await addDoc(collection(db(), 'groups', groupId, 'notifications'), {
      lecturerId: lid,
      message: msg,
      reportId,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  return { emailed: lecturerIds.length, message: msg };
}

export function subscribeGroupMembers(groupId, callback) {
  return onSnapshot(
    collection(db(), 'analytics', groupId, 'members'),
    (snap) => { callback(snap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() }))); },
    (err) => logger.error('[subscribeGroupMembers]', err.code, err.message)
  );
}

export async function incrementMemberMetric(groupId, uid, { edits = 0, timeSpent = 0 }) {
  if (!groupId || !uid) return;
  const ref = doc(db(), 'analytics', groupId, 'members', uid);
  const payload = {};
  if (edits) payload.edits = increment(edits);
  if (timeSpent) payload.timeSpent = increment(timeSpent);
  if (Object.keys(payload).length) {
    await setDoc(ref, payload, { merge: true });
  }
}

// ——— Activity ———

export async function addActivity(groupId, { user, action }) {
  await addDoc(collection(db(), 'groups', groupId, 'activity'), {
    user,
    action,
    timestamp: Date.now(),
    createdAt: serverTimestamp(),
  });
}

export function subscribeActivity(groupId, callback, maxItems = 12) {
  const q = query(
    collection(db(), 'groups', groupId, 'activity'),
    orderBy('timestamp', 'desc'),
    limit(maxItems)
  );
  return onSnapshot(q, (snap) => {
    callback(
      snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }))
    );
  });
}

// ——— Workspace folders & files ———

export function subscribeWorkspace(groupId, callback) {
  const foldersRef = collection(db(), 'groups', groupId, 'folders');
  const filesRef = collection(db(), 'groups', groupId, 'files');

  let folders = [];
  let files = [];
  const emit = () => {
    const folderList = [...folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const folderIds = new Set(folderList.map((f) => f.id));
    // Desktop model: a file lives at ROOT when it has no folderId (or its folder is gone).
    const merged = folderList.map((folder) => ({
      ...folder,
      files: files.filter((f) => f.folderId === folder.id),
    }));
    const rootFiles = files.filter((f) => !f.folderId || !folderIds.has(f.folderId));
    // `merged` keeps the legacy folder-nested shape (folder.files) for older callers;
    // the desktop Drive uses the array's `.folders` / `.rootFiles` props below.
    merged.folders = folderList.map((folder) => ({ ...folder, files: files.filter((f) => f.folderId === folder.id) }));
    merged.rootFiles = rootFiles;
    callback(merged);
  };

  const unsubFolders = onSnapshot(
    foldersRef,
    (snap) => { folders = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); },
    (err) => logger.error('[subscribeWorkspace] folders:', err.code, err.message)
  );

  const unsubFiles = onSnapshot(
    filesRef,
    (snap) => { files = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); },
    (err) => logger.error('[subscribeWorkspace] files:', err.code, err.message)
  );

  return () => {
    unsubFolders();
    unsubFiles();
  };
}

/**
 * No-op: workspaces no longer auto-create default folders ("Project Files" / "Resources").
 * Kept so existing callers don't break; users create their own folders via the Drive UI.
 */
export async function ensureWorkspaceFolders() {
  /* intentionally does nothing */
}

export async function saveWorkspaceFile(groupId, file) {
  if (!groupId || !file?.id) throw new Error('Missing workspace or file id');
  const { id, files: _nested, ...data } = file;
  await setDoc(
    doc(db(), 'groups', groupId, 'files', id),
    {
      ...data,
      id,
      groupId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Persist file metadata + document body (for TipTap / text editors). */
export async function persistOpenFile(groupId, userId, file, { html = '', text = '' } = {}) {
  if (!groupId || !file?.id) throw new Error('Missing workspace or file id');
  const payload = {
    ...file,
    content: text ?? file.content ?? '',
    contentHtml: html ?? file.contentHtml ?? '',
    lastEditedAt: Date.now(),
  };
  await saveWorkspaceFile(groupId, payload);
  if (file.type === 'document' || html || text) {
    await saveDocumentContent({
      fileId: file.id,
      userId: userId || file.lastEditedBy || 'unknown',
      groupId,
      html: html || '',
      text: text || '',
    });
  }
  return payload;
}

export async function deleteWorkspaceFile(groupId, fileId) {
  await deleteDoc(doc(db(), 'groups', groupId, 'files', fileId));
  await deleteDoc(doc(db(), 'documents', fileId)).catch(() => {});
}

export async function saveWorkspaceFolder(groupId, folder) {
  await setDoc(
    doc(db(), 'groups', groupId, 'folders', folder.id),
    {
      id: folder.id,
      name: folder.name,
      order: folder.order ?? 99,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function deleteWorkspaceFolder(groupId, folderId) {
  await deleteDoc(doc(db(), 'groups', groupId, 'folders', folderId));
}

// ——— Document content ———

export async function saveDocumentContent({ fileId, userId, groupId, html, text }) {
  await setDoc(
    doc(db(), 'documents', fileId),
    {
      fileId,
      userId,
      groupId,
      html: html || '',
      text: text || '',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getDocumentContent(fileId) {
  const snap = await getDoc(doc(db(), 'documents', fileId));
  return snap.exists() ? snap.data() : null;
}

// ——— Versions ———

export async function saveDocumentVersion(groupId, fileId, version) {
  await addDoc(collection(db(), 'groups', groupId, 'versions'), {
    fileId,
    ...version,
    createdAt: serverTimestamp(),
  });
}

export function subscribeFileVersions(groupId, fileId, callback) {
  const q = query(collection(db(), 'groups', groupId, 'versions'), where('fileId', '==', fileId));
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    callback(list.slice(0, 25));
  });
}

// ——— Reports & submissions ———

export async function saveSubmissionReport(report, { userId, fileId, groupId }) {
  const submittedAt = report.submittedAt || new Date().toISOString();
  const payload = {
    ...report,
    userId,
    fileId,
    groupId,
    workspaceId: groupId,
    documentId: fileId,
    projectId: groupId,
    submittedAt,
    updatedAt: new Date().toISOString(),
    aiScore: report.aiScore ?? report.scores?.aiUsageScore ?? report.aiReport?.aiScore ?? 0,
    plagiarismScore: report.plagiarismScore ?? report.scores?.plagiarismScore ?? report.aiReport?.plagiarismScore ?? 0,
    feedback: report.feedback ?? report.aiReport?.feedback ?? {},
  };

  await setDoc(doc(db(), 'reports', report.id), { ...payload, createdAt: serverTimestamp() }, { merge: true });
  await setDoc(
    doc(db(), 'submissions', `${fileId}_${userId}`),
    {
      fileId,
      userId,
      groupId,
      workspaceId: groupId,
      reportId: report.id,
      status: 'submitted',
      locked: true,
      submittedAt,
    },
    { merge: true }
  );

  window.dispatchEvent(new CustomEvent('peerlytics:report-saved', { detail: payload }));
  return payload;
}

/** Full submission: AI report + analytics + versions + paste log + lecturer unlock. */
export async function saveFullSubmission({
  report,
  userId,
  fileId,
  groupId,
  submittedByName,
  lecturerId = null,
  lecturerEmail = null,
  type = 'file',
  fileName = null,
  folderId = null,
  folderName = null,
  documentContent = null,
  versionHistory = [],
  pasteEvents = [],
  analytics = [],
}) {
  if (!report?.id || !groupId || !userId) throw new Error('Missing report, group, or user');

  const submittedAt = new Date().toISOString();
  const enrichedReport = {
    ...report,
    userId,
    fileId,
    groupId,
    workspaceId: groupId,
    documentId: fileId,
    projectId: groupId,
    studentName: submittedByName,
    submittedAt,
    documentContent,
    versionHistory: (versionHistory || []).slice(0, 25),
    pasteEvents: (pasteEvents || []).slice(0, 30),
    analytics: analytics || [],
    aiReport: {
      aiScore: report.scores?.aiUsageScore ?? report.scores?.aiAuthenticityScore ?? 0,
      plagiarismScore: report.scores?.plagiarismScore ?? 0,
      feedback: report.feedback || {},
    },
  };

  const saved = await saveSubmissionReport(enrichedReport, { userId, fileId, groupId });

  const groupSnap = await getDoc(doc(db(), 'groups', groupId));
  const groupLecturerIds = groupSnap.exists() ? groupSnap.data().lecturerIds || [] : [];
  const lecturerTargets = lecturerId
    ? [lecturerId]
    : groupLecturerIds.length
      ? groupLecturerIds
      : [];

  const baseId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const submissionPayload = {
    workspaceId: groupId,
    submittedBy: userId,
    submittedByName,
    lecturerEmail,
    type,
    fileId: fileId || null,
    fileName,
    folderId,
    folderName,
    reportId: report.id,
    status: 'submitted',
    submittedAt,
    createdAt: serverTimestamp(),
    documentContent,
    versionHistory: enrichedReport.versionHistory,
    pasteEvents: enrichedReport.pasteEvents,
    analytics: enrichedReport.analytics,
    aiReport: enrichedReport.aiReport,
  };

  if (lecturerTargets.length === 0) {
    await setDoc(doc(db(), 'submissions', baseId), { id: baseId, ...submissionPayload, lecturerId: null });
  } else {
    for (const lid of lecturerTargets) {
      const sid = lecturerTargets.length === 1 ? baseId : `${baseId}_${lid}`;
      await setDoc(doc(db(), 'submissions', sid), {
        id: sid,
        ...submissionPayload,
        lecturerId: lid,
        parentSubmissionId: lecturerTargets.length > 1 ? baseId : null,
      });
    }
  }

  await unlockLecturersForGroup(groupId, lecturerTargets);

  return { report: saved, submissionId: baseId };
}

export async function getReportByFileId(fileId) {
  const q = query(collection(db(), 'reports'), where('fileId', '==', fileId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export function subscribeReportsByGroup(groupId, callback) {
  const q = query(collection(db(), 'reports'), where('groupId', '==', groupId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      callback(list);
    },
    (err) => logger.error('[subscribeReportsByGroup]', err.code, err.message)
  );
}

// ——— Grades ———

// Persist a lecturer's grade decision. We store BOTH the AI-suggested grade and the lecturer's
// final grade, plus a MANDATORY reason whenever the final differs from the suggestion — this is
// the fairness/accountability trail (it surfaces in the admin dashboard so over-/under-grading
// can be reviewed). `lecturerId`/`lecturerName` record who made the decision.
export async function saveGradeOverride(groupId, memberId, grade, opts = {}) {
  const { suggestedGrade = null, reason = '', lecturerId = null, lecturerName = '' } = opts;
  const isOverride = suggestedGrade != null && Number(grade) !== Number(suggestedGrade);
  await setDoc(doc(db(), 'groups', groupId, 'grades', String(memberId)), {
    memberId: String(memberId),
    grade,
    suggestedGrade,
    isOverride,
    overrideReason: isOverride ? String(reason || '') : '',
    lecturerId,
    lecturerName,
    updatedAt: serverTimestamp(),
  });
}

export async function clearGradeOverride(groupId, memberId) {
  await deleteDoc(doc(db(), 'groups', groupId, 'grades', String(memberId)));
}

export function subscribeGradeOverrides(groupId, callback) {
  return onSnapshot(
    collection(db(), 'groups', groupId, 'grades'),
    (snap) => {
      const map = {};
      // Keep the plain grade value under the member key for backward compatibility, and the
      // full decision record under `__records` so callers that need the reason/audit can read it.
      const records = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        const key = data.memberId || d.id;
        map[key] = data.grade;
        records[key] = data;
      });
      Object.defineProperty(map, '__records', { value: records, enumerable: false });
      callback(map);
    },
    (err) => logger.error('[subscribeGradeOverrides]', err.code, err.message)
  );
}

// ——— Admin oversight (read-only; gated by role:'admin' in Firestore rules) ———

// Every group in the system. Admins use this to audit grading across all lecturers/workspaces.
export async function getAllGroups() {
  const snap = await getDocs(collection(db(), 'groups'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Every user profile. Admins use this to resolve lecturer names and student classes.
export async function getAllUsers() {
  const snap = await getDocs(collection(db(), 'users'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Read every grade decision across all of a lecturer's / the system's groups — used by the
// admin dashboard to audit grading fairness. Returns flat records with group + override info.
export async function getAllGradeDecisions(groupIds = []) {
  const out = [];
  for (const gid of groupIds) {
    try {
      const snap = await getDocs(collection(db(), 'groups', gid, 'grades'));
      snap.docs.forEach((d) => out.push({ groupId: gid, ...d.data() }));
    } catch { /* skip groups we can't read */ }
  }
  return out;
}

// ——— Notifications ———

export function subscribeNotifications(groupId, userId, callback) {
  if (!groupId || !userId) return () => {};
  const q = query(
    collection(db(), 'groups', groupId, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  return onSnapshot(q, (snap) => {
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (n) =>
          n.targetUserId === userId ||
          n.userId === userId ||
          n.lecturerId === userId ||
          (!n.lecturerId && !n.targetUserId && !n.userId)
      );
    callback(items);
  });
}

export async function markNotificationRead(groupId, notificationId) {
  await updateDoc(doc(db(), 'groups', groupId, 'notifications', notificationId), { read: true });
}

export async function markUserNotificationRead(userId, notificationId) {
  await updateDoc(doc(db(), 'users', userId, 'notifications', notificationId), { read: true });
}

export async function deleteNotification(groupId, notificationId) {
  await deleteDoc(doc(db(), 'groups', groupId, 'notifications', notificationId));
}

export async function deleteUserNotification(userId, notificationId) {
  await deleteDoc(doc(db(), 'users', userId, 'notifications', notificationId));
}

// ——— Workspace management ———

export async function updateWorkspace(workspaceId, data) {
  await updateDoc(doc(db(), 'groups', workspaceId), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteWorkspace(workspaceId) {
  await deleteDoc(doc(db(), 'groups', workspaceId));
}

export async function removeMember(workspaceId, userId, role) {
  const ref = doc(db(), 'groups', workspaceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (role === 'lecturer') {
    await updateDoc(ref, { lecturerIds: (data.lecturerIds || []).filter(id => id !== userId) });
  } else {
    await updateDoc(ref, { memberIds: (data.memberIds || []).filter(id => id !== userId) });
  }
}

export async function moveFileTo(workspaceId, fileId, targetFolderId) {
  await updateDoc(doc(db(), 'groups', workspaceId, 'files', fileId), {
    folderId: targetFolderId,
    updatedAt: serverTimestamp(),
  });
}

export async function renameWorkspaceFile(workspaceId, fileId, name) {
  await updateDoc(doc(db(), 'groups', workspaceId, 'files', fileId), {
    name,
    updatedAt: serverTimestamp(),
  });
}

export async function renameWorkspaceFolder(workspaceId, folderId, name) {
  await updateDoc(doc(db(), 'groups', workspaceId, 'folders', folderId), {
    name,
    updatedAt: serverTimestamp(),
  });
}

// ——— Real-time document content ———

export function subscribeDocumentContent(fileId, callback) {
  if (!fileId) return () => {};
  return onSnapshot(doc(db(), 'documents', fileId), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

// ——— Presence ———

const PRESENCE_COLORS = ['#1D9E75','#4facfe','#f093fb','#ffc107','#e74c3c','#a29bfe','#00cec9','#fd79a8'];

export async function savePresence(workspaceId, userId, { displayName, fileId, fileName }) {
  const color = PRESENCE_COLORS[userId.charCodeAt(0) % PRESENCE_COLORS.length];
  await setDoc(doc(db(), 'groups', workspaceId, 'presence', userId), {
    displayName,
    color,
    fileId,
    fileName: fileName || null,
    lastSeen: serverTimestamp(),
  }, { merge: true });
}

export function subscribePresence(workspaceId, fileId, callback) {
  if (!workspaceId) return () => {};
  return onSnapshot(collection(db(), 'groups', workspaceId, 'presence'), (snap) => {
    const now = Date.now();
    const users = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.fileId === fileId && u.lastSeen && (now - u.lastSeen.toMillis()) < 45000);
    callback(users);
  });
}

export async function removePresence(workspaceId, userId) {
  await deleteDoc(doc(db(), 'groups', workspaceId, 'presence', userId)).catch(() => {});
}

// ——— Submissions v2 (file or folder) ———

export async function createWorkspaceSubmission({
  workspaceId, submittedBy, submittedByName, lecturerEmail, lecturerId,
  type, fileId, fileName, folderId, folderName, reportId, status = 'submitted',
  documentContent, versionHistory, pasteEvents, analytics, aiReport,
}) {
  const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const submittedAt = new Date().toISOString();
  await setDoc(doc(db(), 'submissions', id), {
    id, workspaceId,
    submittedBy, submittedByName,
    lecturerEmail: lecturerEmail || null,
    lecturerId: lecturerId || null,
    type,
    fileId: fileId || null,
    fileName: fileName || null,
    folderId: folderId || null,
    folderName: folderName || null,
    reportId: reportId || null,
    status,
    submittedAt,
    createdAt: serverTimestamp(),
    documentContent: documentContent || null,
    versionHistory: versionHistory || [],
    pasteEvents: pasteEvents || [],
    analytics: analytics || [],
    aiReport: aiReport || null,
  });
  if (workspaceId) await unlockLecturersForGroup(workspaceId, lecturerId ? [lecturerId] : []);
  return id;
}

function sortSubmissionsDesc(list) {
  return [...list].sort((a, b) => {
    const ta = a.submittedAt
      ? new Date(a.submittedAt).getTime()
      : a.createdAt?.toMillis?.() ?? a.createdAt ?? 0;
    const tb = b.submittedAt
      ? new Date(b.submittedAt).getTime()
      : b.createdAt?.toMillis?.() ?? b.createdAt ?? 0;
    return tb - ta;
  });
}

export function subscribeSubmissionsForLecturer(lecturerId, callback) {
  if (!lecturerId) return () => {};
  const q = query(
    collection(db(), 'submissions'),
    where('lecturerId', '==', lecturerId),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(sortSubmissionsDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    },
    (err) => {
      logger.error('[subscribeSubmissionsForLecturer]', err.code, err.message);
      callback([]);
    }
  );
}

/** Lecturer inbox: direct assignments + all submissions in their workspaces. */
export function subscribeInboxForLecturer(lecturerId, workspaceIds = [], callback) {
  if (!lecturerId) return () => {};
  const merged = {};
  const emit = () => callback(sortSubmissionsDesc(Object.values(merged)));

  const unsubs = [];

  const qDirect = query(
    collection(db(), 'submissions'),
    where('lecturerId', '==', lecturerId),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  unsubs.push(
    onSnapshot(
      qDirect,
      (snap) => {
        snap.docs.forEach((d) => {
          merged[d.id] = { id: d.id, ...d.data() };
        });
        emit();
      },
      (err) => {
        logger.error('[inbox direct]', err.code, err.message);
        if (err.code === 'failed-precondition') {
          logger.error('[inbox direct] Missing Firestore index — run: firebase deploy --only firestore:indexes', err.message);
        }
      }
    )
  );

  const uniqueWs = [...new Set(workspaceIds.filter(Boolean))].slice(0, 12);
  uniqueWs.forEach((wsId) => {
    const qWs = query(
      collection(db(), 'submissions'),
      where('workspaceId', '==', wsId),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    unsubs.push(
      onSnapshot(
        qWs,
        (snap) => {
          snap.docs.forEach((d) => {
            const data = d.data();
            if (!data.lecturerId || data.lecturerId === lecturerId) {
              merged[d.id] = { id: d.id, ...data };
            }
          });
          emit();
        },
        (err) => {
          logger.error('[inbox workspace]', wsId, err.code, err.message);
          if (err.code === 'failed-precondition') {
            logger.error('[inbox workspace] Missing Firestore index — run: firebase deploy --only firestore:indexes', err.message);
          }
        }
      )
    );
  });

  return () => unsubs.forEach((u) => u());
}

export function subscribeSubmissionsForUser(userId, callback) {
  if (!userId) return () => {};
  const q = query(
    collection(db(), 'submissions'),
    where('submittedBy', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(q, (snap) => {
    callback(sortSubmissionsDesc(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  });
}

export async function updateSubmissionStatus(submissionId, status) {
  await updateDoc(doc(db(), 'submissions', submissionId), { status, reviewedAt: serverTimestamp() });
}

/** Lecturer-only: remove a submission from storage. */
export async function deleteSubmission(submissionId) {
  if (!submissionId) return;
  await deleteDoc(doc(db(), 'submissions', submissionId));
}
