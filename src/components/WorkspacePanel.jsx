import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  APA_STYLE,
  createVersionEntry,
  getDefaultFileContent,
  isStudentWorkspaceFile,
  newFileFromType,
  renderVersionContent,
  CHANGE_TYPE_LABELS,
} from '../utils/workspaceHelpers';
import WorkspaceEditor from './WorkspaceEditor';
import ReportCard from './ReportCard';
import SheetsEditor from './SheetsEditor';
import SlidesEditor from './SlidesEditor';
import { submitForCheck } from '../services/api';
import {
  getReportByFileId,
  subscribeWorkspace,
  saveWorkspaceFile,
  persistOpenFile,
  ensureWorkspaceFolders,
  deleteWorkspaceFile,
  saveWorkspaceFolder,
  deleteWorkspaceFolder,
  saveDocumentContent,
  getDocumentContent,
  saveDocumentVersion,
  subscribeFileVersions,
  subscribePasteEvents,
  incrementMemberMetric,
  savePasteEvent,
  bumpMemberActivity,
  notifyLecturersSubmission,
  subscribeDocumentContent,
  savePresence,
  subscribePresence,
  removePresence,
  saveFullSubmission,
  getAnalyticsSnapshot,
  getUserProfile,
  getGroup,
  inviteMemberByEmail,
  inviteLecturerByEmail,
} from '../firebase/firestoreService';
import { classifyPasteDelta, buildPasteRanges } from '../utils/pasteDetection';
import { detectContentDifficulty } from '../utils/difficultyDetection';
import { gradeSubmission, writingFromReport } from '../utils/behaviorGrade';
import { logger } from '../utils/logger';

const PASTE_MSG = 'Large content pasted in short time';

const HIGHLIGHT_STYLES = {
  paste: { background: 'rgba(231, 76, 60, 0.35)', color: '#b71c1c', borderBottom: '2px solid #e74c3c' },
  insert: { background: 'rgba(46, 204, 113, 0.35)', color: '#1b5e20', borderBottom: '2px solid #2ecc71' },
  normal: {},
};

function VersionContentPreview({ version, darkMode }) {
  const parts = renderVersionContent(version.content, version);
  return (
    <div
      style={{
        fontFamily: '"Times New Roman", Times, serif',
        fontSize: 13,
        lineHeight: 1.7,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        padding: 12,
        background: darkMode ? '#121212' : '#fff',
        borderRadius: 8,
        border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
        maxHeight: 160,
        overflowY: 'auto',
      }}
    >
      {parts.map((part, i) => (
        <span key={i} style={HIGHLIGHT_STYLES[part.kind] || HIGHLIGHT_STYLES.normal}>
          {part.text}
        </span>
      ))}
    </div>
  );
}

function VersionHistoryPanel({ versions, darkMode, selectedId, onSelect }) {
  return (
    <div
      style={{
        borderTop: '1px solid #d4d4d4',
        background: darkMode ? '#262626' : '#f7f7f7',
        maxHeight: 280,
        overflowY: 'auto',
        padding: '12px 16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 13, color: darkMode ? '#ededed' : '#333' }}>Version History</strong>
        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: darkMode ? '#9a9a9a' : '#666', flexWrap: 'wrap' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4, verticalAlign: 'middle', ...HIGHLIGHT_STYLES.paste }} /> Large paste</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4, verticalAlign: 'middle', ...HIGHLIGHT_STYLES.insert }} /> Small paste / edits</span>
          <span style={{ fontStyle: 'italic' }}>Lecturer view only</span>
        </div>
      </div>
      {versions.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: darkMode ? '#9a9a9a' : '#666' }}>No versions yet. Edits and pastes are tracked automatically.</p>
      ) : (
        versions.map((v) => {
          const isSelected = selectedId === v.id;
          const typeLabel = v.type === 'paste'
            ? (CHANGE_TYPE_LABELS[v.changeType] || 'Paste')
            : v.type === 'edit'
              ? (CHANGE_TYPE_LABELS[v.changeType] || 'Edit')
              : CHANGE_TYPE_LABELS[v.changeType] || v.changeType;
          const typeColor =
            v.changeType === 'paste-large' || v.changeType === 'paste'
              ? '#e74c3c'
              : v.changeType === 'paste-small'
                ? '#2ecc71'
                : v.changeType === 'import'
                  ? '#9b59b6'
                  : v.changeType === 'open'
                    ? '#3498db'
                    : '#1D9E75';
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(isSelected ? null : v.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(isSelected ? null : v.id)}
              style={{
                marginBottom: 10,
                padding: 10,
                borderRadius: 8,
                cursor: 'pointer',
                border: `1px solid ${isSelected ? '#1D9E75' : darkMode ? '#2e2e2e' : '#ddd'}`,
                background: isSelected ? (darkMode ? 'rgba(29,158,117,0.15)' : 'rgba(29,158,117,0.08)') : darkMode ? '#151a2e' : '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 12, color: '#1D9E75' }}>{v.user}</span>
                  <span style={{ fontSize: 11, color: darkMode ? '#9a9a9a' : '#888', marginLeft: 8 }}>{v.displayTime}</span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: `${typeColor}22`,
                    color: typeColor,
                    textTransform: 'uppercase',
                  }}
                >
                  {typeLabel}
                </span>
              </div>
              <div style={{ fontSize: 11, color: darkMode ? '#d4d4d4' : '#555', marginBottom: isSelected ? 8 : 0 }}>{v.summary}</div>
              {isSelected && v.content && <VersionContentPreview version={v} darkMode={darkMode} />}
            </div>
          );
        })
      )}
    </div>
  );
}

export default function WorkspacePanel({
  darkMode,
  currentUser,
  groupId,
  groupMembers,
  pushToast,
  pushActivity,
  deadline,
  createdDate,
  submissions = [],
  workspaceSubmissions = [],
  lecturerIds = [],
  initialFile = null,
  // When true: editor renders inline (no fixed modal overlay) — used by the
  // 'editor' tab in the main dashboard to keep the sidebar/layout visible.
  inlineEditor = false,
  onEditorClose,
}) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [openFile, setOpenFile] = useState(initialFile);
  const [editorContent, setEditorContent] = useState('');
  const [apaEnabled, setApaEnabled] = useState(false);
  const [pasteAlert, setPasteAlert] = useState(false);
  const [versionHistory, setVersionHistory] = useState({});
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [lastEditedMeta, setLastEditedMeta] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [fileMenuId, setFileMenuId] = useState(null);
  const changeRef = useRef({ at: Date.now(), len: 0 });
  const contentBeforeEditRef = useRef('');
  const editorRef = useRef(null);
  const [editorHtml, setEditorHtml] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionReport, setSubmissionReport] = useState(null);
  const [submittedHtml, setSubmittedHtml] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);
  const [pasteEvents, setPasteEvents] = useState([]);
  const autoSubmitFiredRef = useRef(false);
  const autoSubmitDismissedRef = useRef(false); // user chose "Keep working" at the 30-min prompt
  const sessionStartRef = useRef(null);
  const remoteUpdateRef = useRef(false);
  const isTypingRef = useRef(false);
  const typingTimerRef = useRef(null);
  // Timestamp of the last keystroke — used so time only accrues during ACTIVE writing.
  const lastTypedAtRef = useRef(0);
  // Active writing time (ms) accumulated this session, only while typing was recent.
  const activeMsRef = useRef(0);
  const lastTickRef = useRef(0);
  const IDLE_MS = 30000; // pause counting after 30s with no typing
  const [presenceUsers, setPresenceUsers] = useState([]);
  const [docPage, setDocPage] = useState({ current: 1, total: 1 });
  // Auto-submit confirmation (shown only when the user is present at the 30-min mark).
  const [autoSubmitCountdown, setAutoSubmitCountdown] = useState(null); // seconds remaining, or null
  const lastInteractionRef = useRef(Date.now());
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitType, setSubmitType] = useState('file'); // 'file' | 'folder'
  const [submitLecturerEmail, setSubmitLecturerEmail] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitTargetId, setSubmitTargetId] = useState(null);
  const submitBtnRef = useRef(null);
  // Google-Docs-style "Share" (add member) from the editor.
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState('member');
  const [sharing, setSharing] = useState(false);
  const userName = currentUser?.name || 'You';
  const readOnly = currentUser?.role === 'lecturer';
  const isStudent = !readOnly;

  // Esc closes the submit modal (Enter-to-submit is handled on the email field, which
  // also enforces the required-email validation).
  useEffect(() => {
    if (!showSubmitModal) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setShowSubmitModal(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSubmitModal]);

  const EDITOR_APP = {
    document: { label: 'Document', titleBg: '#fff', titleColor: '#1a2e24', barBg: '#f5faf7', accent: '#1d9e75', canvasBg: '#e8eeeb', statusBg: '#fff', statusColor: '#5f6f66' },
    spreadsheet: { label: 'Spreadsheet', titleBg: '#217346', titleColor: '#fff', barBg: '#e8f5e9', accent: '#217346', canvasBg: '#fff', statusBg: '#217346', statusColor: '#fff' },
    presentation: { label: 'Presentation', titleBg: '#d24726', titleColor: '#fff', barBg: '#fce8e6', accent: '#d24726', canvasBg: '#3b3b3b', statusBg: '#b7472a', statusColor: '#fff' },
    code: { label: 'Code', titleBg: '#202124', titleColor: '#e8eaed', barBg: '#303134', accent: '#8ab4f8', canvasBg: '#1e1e1e', statusBg: '#202124', statusColor: '#9aa0a6' },
  };

  // Sync initialFile prop → openFile state when it changes
  useEffect(() => {
    if (initialFile && initialFile.id !== openFile?.id) {
      setOpenFile(initialFile);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile?.id]);

  useEffect(() => {
    if (!groupId) return undefined;
    return subscribeWorkspace(groupId, (next) => {
      setFolders(next);
      setSelectedFolderId((cur) => cur || next[0]?.id || null);
    });
  }, [groupId]);

  // Workspace-level lock: when ANY member submits a file, its `submitted` flag is
  // persisted to Firestore. Sync that into the open file so the editor becomes
  // read-only for EVERY member (not just the one who submitted).
  useEffect(() => {
    if (!openFile?.id) return;
    // Include ROOT-level files (desktop model: files with no folderId live outside any
    // folder), otherwise a submitted root file would never lock on the editor side.
    const all = [...folders.flatMap((f) => f.files || []), ...(folders.rootFiles || [])];
    const live = all.find((f) => f.id === openFile.id);
    if (live && live.submitted && !openFile.submitted) {
      setOpenFile((cur) => (cur && cur.id === openFile.id ? { ...cur, submitted: true } : cur));
    }
  }, [folders, openFile?.id, openFile?.submitted]);

  useEffect(() => {
    if (!groupId) return;
    ensureWorkspaceFolders(groupId).catch((err) => {
      logger.error('[ensureWorkspaceFolders]', err);
    });
  }, [groupId]);

  // NOTE: initial content is loaded in the file-open effect (getDocumentContent),
  // and live remote sync is handled by the "Real-time document content sync"
  // effect below (which guards against self-echo + active typing). A second
  // unguarded subscription here used to re-apply the doc on every change —
  // including the user's own echoed writes — which reset the cursor mid-type
  // (dropped spaces / cursor jumps) and fought the real-time sync. Removed.

  // Subscribe to paste events for the open file — for BOTH students and lecturers.
  // (Previously this only ran for the lecturer/read-only view, so at student submit
  // time pasteEvents was always [], meaning no paste flags/penalties were ever sent.)
  useEffect(() => {
    if (!groupId || !openFile?.id) {
      setPasteEvents([]);
      return undefined;
    }
    return subscribePasteEvents(groupId, openFile.id, setPasteEvents);
  }, [groupId, openFile?.id]);

  // Active-writing time tracker. Counts elapsed time ONLY when the student typed within
  // the last IDLE_MS — so opening the doc and walking away does not accrue time. Active
  // milliseconds are accumulated and flushed to Firestore as whole minutes; the leftover
  // fraction is written on unmount so short/exact sessions are preserved.
  useEffect(() => {
    if (!openFile || readOnly) return undefined;
    activeMsRef.current = 0;
    lastTickRef.current = Date.now();
    let flushedMin = 0;

    const TICK_MS = 10000;
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      // Only credit this interval if typing happened within the idle window.
      if (now - lastTypedAtRef.current <= IDLE_MS) {
        activeMsRef.current += delta;
      }
      const totalMin = activeMsRef.current / 60000;
      const wholeToFlush = Math.floor(totalMin) - flushedMin;
      if (wholeToFlush >= 1 && groupId && currentUser?.uid) {
        flushedMin += wholeToFlush;
        incrementMemberMetric(groupId, currentUser.uid, { timeSpent: wholeToFlush }).catch(() => {});
        bumpMemberActivity(groupId, currentUser.uid).catch(() => {});
      }
    }, TICK_MS);

    return () => {
      clearInterval(interval);
      if (groupId && currentUser?.uid) {
        // Flush the leftover active fraction below the last whole minute already written.
        const remainder = activeMsRef.current / 60000 - flushedMin;
        if (remainder > 0) {
          incrementMemberMetric(groupId, currentUser.uid, { timeSpent: remainder }).catch(() => {});
        }
      }
    };
  }, [openFile?.id, readOnly, groupId, currentUser?.uid]);

  useEffect(() => {
    if (!groupId || !openFile?.id) return undefined;
    return subscribeFileVersions(groupId, openFile.id, (versions) => {
      setVersionHistory((vh) => ({ ...vh, [openFile.id]: versions }));
    });
  }, [groupId, openFile?.id]);

  // Real-time document content sync between members + lecturer. Guards against
  // overwriting while the local user is typing, and ignores the user's own echoed writes.
  useEffect(() => {
    if (!openFile?.id || openFile.type !== 'document') return undefined;
    return subscribeDocumentContent(openFile.id, (docData) => {
      if (!docData) return;
      if (isTypingRef.current) return; // don't overwrite while typing
      const incomingHtml = docData.html || '';
      if (incomingHtml && docData.userId !== currentUser?.uid) {
        remoteUpdateRef.current = true;
        editorRef.current?.setContent?.(incomingHtml);
        setEditorHtml(incomingHtml);
        remoteUpdateRef.current = false;
      }
    });
  }, [openFile?.id, openFile?.type, currentUser?.uid]);

  // Presence — track who's editing the same file
  useEffect(() => {
    if (!groupId || !openFile?.id || !currentUser?.uid) return undefined;
    savePresence(groupId, currentUser.uid, {
      displayName: userName,
      fileId: openFile.id,
      fileName: openFile.name,
    }).catch(() => {});
    const unsub = subscribePresence(groupId, openFile.id, (users) => {
      setPresenceUsers(users.filter((u) => u.id !== currentUser.uid));
    });
    const heartbeat = setInterval(() => {
      savePresence(groupId, currentUser.uid, {
        displayName: userName,
        fileId: openFile.id,
        fileName: openFile.name,
      }).catch(() => {});
    }, 12000);
    return () => {
      clearInterval(heartbeat);
      removePresence(groupId, currentUser.uid).catch(() => {});
      unsub();
    };
  }, [groupId, openFile?.id, currentUser?.uid, userName]);

  // Track recent user interaction so we can tell if they're actually present at the
  // 30-min mark (vs. tab left open & walked away).
  useEffect(() => {
    if (readOnly) return undefined;
    const mark = () => { lastInteractionRef.current = Date.now(); };
    const evts = ['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'];
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => evts.forEach((e) => window.removeEventListener(e, mark));
  }, [readOnly]);

  // "Present" = tab is visible AND the user interacted within the last 2 minutes.
  const isUserPresent = useCallback(() => {
    const recent = Date.now() - lastInteractionRef.current < 2 * 60 * 1000;
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    return recent && visible;
  }, []);

  // Auto-submit around the deadline.
  // • At the 30-min mark, if the user is PRESENT → show a confirmation dialog with a
  //   countdown. They can "Submit now" or "Keep working" (dismiss). If AWAY → submit
  //   silently right away.
  // • If they dismissed, they keep editing freely; at the ACTUAL deadline (msLeft ≤ 0)
  //   it force-submits no matter what, so the work is never late.
  useEffect(() => {
    if (!deadline || !openFile || readOnly || autoSubmitFiredRef.current) return undefined;
    const warnedRef = { hour: false };
    const id = setInterval(() => {
      if (openFile.submitted || autoSubmitFiredRef.current) { clearInterval(id); return; }
      const msLeft = new Date(deadline) - Date.now();

      // Hard deadline reached → force-submit regardless of dismissal/presence.
      if (msLeft <= 0) {
        autoSubmitFiredRef.current = true;
        clearInterval(id);
        setAutoSubmitCountdown(null);
        pushToast?.('Deadline reached — submitting now.');
        handleCheckSubmit();
        return;
      }

      // 30-min heads-up (only once, unless dismissed).
      if (msLeft <= 30 * 60 * 1000 && !autoSubmitDismissedRef.current && autoSubmitCountdown == null) {
        if (isUserPresent()) {
          setAutoSubmitCountdown(60); // present → confirmation dialog
        } else {
          autoSubmitFiredRef.current = true;
          clearInterval(id);
          pushToast?.('Auto-submitting — 30 minutes until deadline.');
          handleCheckSubmit();
        }
      } else if (msLeft <= 60 * 60 * 1000 && !warnedRef.hour) {
        warnedRef.hour = true;
        pushToast?.('Deadline in under 1 hour — auto-submit will trigger at the deadline.');
      }
    }, 15000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, openFile?.id, readOnly]);

  // Drive the auto-submit confirmation countdown. When it hits 0, submit automatically.
  useEffect(() => {
    if (autoSubmitCountdown == null) return undefined;
    if (autoSubmitCountdown <= 0) {
      setAutoSubmitCountdown(null);
      pushToast?.('Auto-submitting — deadline approaching.');
      handleCheckSubmit();
      return undefined;
    }
    const t = setTimeout(() => setAutoSubmitCountdown((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmitCountdown]);

  // Keyboard for the auto-submit dialog: Enter = submit now, Esc = keep working.
  useEffect(() => {
    if (autoSubmitCountdown == null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); setAutoSubmitCountdown(null); pushToast?.('Submitting now…'); handleCheckSubmit(); }
      else if (e.key === 'Escape') { e.preventDefault(); autoSubmitDismissedRef.current = true; autoSubmitFiredRef.current = false; setAutoSubmitCountdown(null); pushToast?.('Okay — keep working. It will submit at the deadline.'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmitCountdown]);

  const persistFile = useCallback(
    async (file, contentOverride) => {
      if (!groupId || !file) return;
      try {
        await persistOpenFile(groupId, currentUser?.uid, file, {
          html: contentOverride?.html ?? file.contentHtml ?? '',
          text: contentOverride?.text ?? file.content ?? '',
        });
      } catch (err) {
        logger.error('[persistFile]', err);
        pushToast?.(err.message || 'Could not save file to cloud');
        throw err;
      }
    },
    [groupId, currentUser?.uid, pushToast]
  );

  const handleShareInvite = useCallback(async () => {
    const email = shareEmail.trim();
    if (!email) { pushToast?.('Enter an email'); return; }
    setSharing(true);
    try {
      const inviter = { invitedByName: currentUser?.name, invitedByUid: currentUser?.uid, workspaceName: openFile?.name };
      if (shareRole === 'lecturer') { await inviteLecturerByEmail(groupId, email, inviter); pushToast?.('Lecturer invited — they were notified'); }
      else { await inviteMemberByEmail(groupId, email, inviter); pushToast?.('Member added — they were notified'); }
      setShareEmail(''); setShowShareModal(false);
    } catch (err) { pushToast?.(err.message || 'Could not add member'); }
    finally { setSharing(false); }
  }, [shareEmail, shareRole, groupId, currentUser, openFile, pushToast]);

  // Esc closes the share modal; Enter on the email field submits.
  useEffect(() => {
    if (!showShareModal) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setShowShareModal(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShareModal]);

  const saveOpenFileNow = useCallback(async () => {
    if (!openFile || readOnly || !groupId) return;
    const html = openFile.type === 'document' ? (editorRef.current?.getHTML?.() ?? editorHtml) : '';
    const text = openFile.type === 'document' ? (editorRef.current?.getText?.() ?? editorContent) : editorContent;
    await persistFile(
      { ...openFile, lastEditedBy: userName, lastEditedAt: Date.now() },
      { html, text }
    );
  }, [openFile, readOnly, groupId, editorHtml, editorContent, persistFile, userName]);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) || folders[0] || null;
  const allFiles = selectedFolder?.files ?? [];
  // A lecturer (read-only) should see a file if it was student-authored OR if it has actually
  // been submitted to them — keying only on createdBy/lastEditedBy hid submitted files that
  // lacked that metadata, so the submission never appeared in the lecturer's workspace.
  const submittedFileIds = new Set(
    (workspaceSubmissions || []).flatMap((s) => [s.fileId, s.folderId].filter(Boolean))
  );
  const files = readOnly
    ? allFiles.filter((f) => isStudentWorkspaceFile(f, userName) || submittedFileIds.has(f.id) || f.submitted)
    : allFiles;

  const saveVersion = useCallback(
    (fileId, summary, opts = {}) => {
      const changeType = opts.changeType || 'edit';
      const type = changeType.startsWith('paste') ? 'paste' : changeType === 'import' ? 'edit' : 'edit';
      const entry = { ...createVersionEntry(userName, summary, opts), type };
      setVersionHistory((vh) => ({ ...vh, [fileId]: [entry, ...(vh[fileId] || [])].slice(0, 25) }));
      if (groupId) saveDocumentVersion(groupId, fileId, entry).catch(() => {});
    },
    [userName, groupId]
  );

  const triggerPaste = useCallback(
    (pasteRanges, newContent, changeType = 'paste-large', pastedText = null) => {
      const isLarge = changeType === 'paste-large';
      setPasteAlert(true);
      pushActivity?.(userName, isLarge ? PASTE_MSG : 'Small paste detected');
      // The actual pasted fragment — used for accurate highlighting + author attribution.
      // Keep the full block (capped generously) so the whole paste highlights, not just part.
      const snippet = (pastedText || '').slice(0, 20000)
        || newContent.slice(pasteRanges?.[0]?.start ?? 0);
      if (openFile?.id) {
        const summary = isLarge ? 'Large paste (red flag)' : 'Small paste (green)';
        saveVersion(openFile.id, summary, {
          changeType,
          content: newContent,
          previousContent: contentBeforeEditRef.current,
          pasteRanges,
          pastedText: snippet,
        });
        if (groupId && currentUser?.uid) {
          savePasteEvent(groupId, {
            fileId: openFile.id,
            userId: currentUser.uid,
            userName,
            changeType,
            pasteRanges,
            contentSnippet: snippet,
          }).catch(() => {});
        }
      }
      setTimeout(() => setPasteAlert(false), 6000);
    },
    [userName, pushActivity, openFile, saveVersion, groupId, currentUser?.uid]
  );

  const openFileHandler = (file) => {
    // Allow the lecturer to open student-authored OR submitted files (mirrors the `files`
    // filter above) so a submission they can see in the list is also openable.
    const isOpenable =
      isStudentWorkspaceFile(file, userName) || submittedFileIds.has(file.id) || file.submitted;
    if (readOnly && !isOpenable) {
      pushToast?.('You can only view student-submitted files');
      return;
    }
    setOpenFile(file);
    setIsMinimized(false);
    setIsMaximized(false);
    setPasteAlert(false);
    setShowVersionHistory(false);
    setSelectedVersionId(null);
    setApaEnabled(false);
    changeRef.current = { at: Date.now(), len: 0 };
    const initial = file.content ?? getDefaultFileContent(file.type);
    const initialHtml =
      file.contentHtml ||
      (file.type === 'document' && initial && !initial.startsWith('<')
        ? `<p>${initial.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
        : initial);
    setEditorContent(initial);
    setEditorHtml(initialHtml);
    contentBeforeEditRef.current = initial;
    setSubmissionReport(null);

    // Lecturers view the FROZEN submitted snapshot (always readable from the submission
    // doc) so the workspace shows the content even when the live document read is gated.
    const submittedSnap = readOnly
      ? (workspaceSubmissions || []).find((s) => s.fileId === file.id || s.folderId === file.id)?.documentContent
      : null;
    if (submittedSnap && (submittedSnap.html || submittedSnap.text)) {
      if (submittedSnap.text) { setEditorContent(submittedSnap.text); contentBeforeEditRef.current = submittedSnap.text; }
      if (submittedSnap.html) { setEditorHtml(submittedSnap.html); editorRef.current?.setContent?.(submittedSnap.html); }
    } else if (file.type === 'document') {
      getDocumentContent(file.id).then((doc) => {
        if (doc?.text) {
          setEditorContent(doc.text);
          contentBeforeEditRef.current = doc.text;
        }
        if (doc?.html) {
          setEditorHtml(doc.html);
          editorRef.current?.setContent?.(doc.html);
        }
      }).catch(() => {});
    }
    pushActivity?.(userName, readOnly ? `viewed ${file.name}` : `opened ${file.name}`);
    if (!readOnly) {
      saveVersion(file.id, 'Opened file', { changeType: 'open', content: initial, previousContent: '' });
    }
    if (file.submitted) {
      getReportByFileId(file.id).then((r) => r && setSubmissionReport(r));
    }
  };

  const autosaveTimerRef = useRef(null);

  const handleEditorChange = useCallback(({ html, text }) => {
    setEditorHtml(html);
    setEditorContent(text);
    if (openFile?.id) {
      setLastEditedMeta((m) => ({ ...m, [openFile.id]: { user: userName, timestamp: Date.now() } }));
    }
    if (readOnly || !openFile || !groupId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      persistFile(
        { ...openFile, lastEditedBy: userName, lastEditedAt: Date.now() },
        { html, text }
      ).catch(() => {});
    }, 1200);
  }, [openFile, userName, readOnly, groupId, persistFile]);

  useEffect(() => {
    const onFlush = () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      saveOpenFileNow().catch(() => {});
    };
    window.addEventListener('peerlytics:flush', onFlush);
    return () => window.removeEventListener('peerlytics:flush', onFlush);
  }, [saveOpenFileNow]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

  const runFullSubmission = useCallback(async ({ lecturerId = null, lecturerEmail = null } = {}) => {
    if (readOnly || !openFile || openFile.submitted || submitting) return null;
    const isDocument = openFile.type === 'document';
    const html = isDocument ? (editorRef.current?.getHTML?.() ?? editorHtml) : '';
    const text = isDocument ? (editorRef.current?.getText?.() ?? editorContent) : editorContent;
    if ((text || '').trim().length < 10) {
      pushToast?.('Add more content before submitting');
      return null;
    }
    const wsId = groupId || currentUser?.groupId;
    // Block submission when the workspace has no lecturer to receive it — otherwise the
    // submission would be saved but invisible to every lecturer (orphaned). A submission
    // must target a specific lecturer (email) OR the workspace must already have one.
    if (!lecturerId && !lecturerEmail) {
      const g = await getGroup(wsId).catch(() => null);
      if (!g || !(g.lecturerIds || []).length) {
        pushToast?.('No lecturer in this workspace — invite a lecturer before submitting.');
        return null;
      }
    }
    await saveOpenFileNow().catch(() => {});
    const uid = currentUser?.uid || currentUser?.email || userName;
    const difficulty = detectContentDifficulty({ text, html, type: openFile.type });
    const versions = versionHistory[openFile.id] || [];
    const filePasteEvents = pasteEvents.filter((p) => p.fileId === openFile.id);
    const analytics = await getAnalyticsSnapshot(wsId).catch(() => []);

    const { report } = await submitForCheck({
      text,
      html,
      userId: uid,
      fileId: openFile.id,
      groupId: wsId,
      fileName: openFile.name,
      studentName: userName,
      difficulty,
      versions,
      pasteEvents: filePasteEvents,
    });

    const { report: saved } = await saveFullSubmission({
      report,
      userId: uid,
      fileId: openFile.id,
      groupId: wsId,
      submittedByName: userName,
      lecturerId,
      lecturerEmail,
      type: 'file',
      fileName: openFile.name,
      documentContent: { html, text },
      versionHistory: versions,
      pasteEvents: filePasteEvents,
      analytics,
    });

    setSubmissionReport(saved);
    setSubmittedHtml(html);
    const submittedFile = {
      ...openFile,
      submitted: true,
      content: text,
      contentHtml: html,
      lastEditedBy: userName,
      lastEditedAt: Date.now(),
    };
    setOpenFile(submittedFile);
    await persistFile(submittedFile, { html, text });
    saveVersion(openFile.id, 'Submitted for review', { changeType: 'import', content: text, previousContent: '' });
    pushActivity?.(userName, `submitted ${openFile.name} for AI + plagiarism check`);

    const notify = await notifyLecturersSubmission(wsId, {
      fileName: openFile.name,
      studentName: userName,
      reportId: saved.id,
    }).catch(() => ({ emailed: 0 }));

    return { saved, notify, html, text };
  }, [
    readOnly, openFile, submitting, editorHtml, editorContent, groupId, currentUser,
    userName, versionHistory, pasteEvents, saveOpenFileNow, persistFile, saveVersion, pushActivity,
  ]);

  /**
   * Folder submission: extract & concatenate the contents of every file in the folder,
   * run the AI/plagiarism check (which never blocks — falls back to "AI unavailable"),
   * then deliver the folder + report to the lecturer.
   */
  const runFolderSubmission = useCallback(async ({ folder, lecturerId = null, lecturerEmail = null }) => {
    if (!folder) return null;
    const wsId = groupId || currentUser?.groupId;
    const uid = currentUser?.uid || currentUser?.email || userName;
    const files = folder.files || [];

    // Pull the freshest stored content for each file, falling back to the cached copy.
    const parts = await Promise.all(
      files.map(async (f) => {
        let text = f.content || '';
        let html = f.contentHtml || '';
        try {
          const doc = await getDocumentContent(f.id);
          if (doc?.text) text = doc.text;
          if (doc?.html) html = doc.html;
        } catch { /* use cached */ }
        return { name: f.name, type: f.type, text, html };
      })
    );

    const combinedText = parts
      .map((p) => `# ${p.name}\n${p.text || ''}`)
      .join('\n\n')
      .trim();
    const combinedHtml = parts
      .map((p) => `<h3>${p.name}</h3>${p.html || ''}`)
      .join('<hr/>');

    const analytics = await getAnalyticsSnapshot(wsId).catch(() => []);

    // Never blocks: returns an "AI unavailable" report on any failure.
    const { report } = await submitForCheck({
      text: combinedText,
      html: combinedHtml,
      userId: uid,
      fileId: folder.id,
      groupId: wsId,
      fileName: folder.name,
      studentName: userName,
      difficulty: detectContentDifficulty({ text: combinedText, html: combinedHtml, type: 'document' }),
      versions: [],
      pasteEvents: [],
    });

    const { report: saved } = await saveFullSubmission({
      report,
      userId: uid,
      fileId: folder.id,
      groupId: wsId,
      submittedByName: userName,
      lecturerId,
      lecturerEmail,
      type: 'folder',
      folderId: folder.id,
      folderName: folder.name,
      documentContent: { html: combinedHtml, text: combinedText },
      versionHistory: [],
      pasteEvents: [],
      analytics,
    });

    pushActivity?.(userName, `submitted folder "${folder.name}" (${files.length} file(s)) for review`);

    const notify = await notifyLecturersSubmission(wsId, {
      fileName: folder.name,
      studentName: userName,
      reportId: saved.id,
    }).catch(() => ({ emailed: 0 }));

    return { saved, notify };
  }, [groupId, currentUser, userName, pushActivity]);

  const handleCheckSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await runFullSubmission();
      if (!result) return;
      setShowReportModal(true);
      pushToast?.(
        result.notify?.emailed
          ? `Submitted — ${result.notify.emailed} lecturer(s) can now review`
          : 'Submitted — lecturers unlocked for review'
      );
    } catch (err) {
      pushToast?.(err.message || 'Submission check failed');
    } finally {
      setSubmitting(false);
    }
  };

  // The student's own grade for the post-submit report — uses the SAME behaviour grader as
  // the lecturer's Grading tab, so the number shown here matches what the lecturer sees
  // (instead of the backend's stale suggestedGrade).
  const myReportGrade = useCallback((report) => {
    if (!report) return null;
    const uid = currentUser?.uid;
    const mine = (report.analytics || []).find((a) => (a.uid || a.id) === uid) || {};
    const attribution = report.authorAttribution?.[uid] || null;
    const editCount = mine.edits || 0;
    const timeSpentSeconds = Math.round((mine.timeSpent || 0) * 60);
    const largePastes = attribution?.largePasteCount || 0;
    const pastePercentage = attribution?.pastePct
      ?? (editCount > 0 ? Math.min(100, Math.round((largePastes / editCount) * 100)) : 0);
    const aiProbability = ((report.scores?.aiUsageScore ?? 0) / 100) * ((attribution?.aiShare ?? 0) / 100);
    return gradeSubmission({
      writing: writingFromReport(report),
      timeSpentSeconds,
      editCount,
      pastePercentage,
      aiProbability,
      timeCapMinutes: 60, // default; the lecturer's configured cap is applied in their Grading view
    }).recommendedScore;
  }, [currentUser?.uid]);

  const createFile = async (type) => {
    if (readOnly) {
      pushToast?.('Lecturers cannot create files');
      return;
    }
    const folder = selectedFolder || folders[0];
    if (!folder) {
      pushToast?.('Create a folder first');
      return;
    }
    const file = newFileFromType(type, folder.id, null, userName);
    file.lastEditedBy = userName;
    file.lastEditedAt = Date.now();
    try {
      await persistFile(file, { html: file.contentHtml || '', text: file.content || '' });
      pushToast?.('File saved to workspace');
      pushActivity?.(userName, `created ${file.name}`);
    } catch {
      pushToast?.('File could not be saved — check connection and try again');
    }
  };

  const createFolder = async () => {
    if (readOnly) {
      pushToast?.('Lecturers cannot create folders');
      return;
    }
    const id = `folder-${Date.now()}`;
    const folder = { id, name: `Folder ${folders.length + 1}`, files: [], order: folders.length };
    try {
      if (groupId) await saveWorkspaceFolder(groupId, folder);
      setSelectedFolderId(id);
      pushToast?.('Folder saved');
    } catch (err) {
      pushToast?.(err.message || 'Could not save folder');
    }
  };

  const onEditorChange = (e) => {
    if (readOnly) return;
    const val = e.target.value;
    const prev = editorContent;
    const delta = val.length - prev.length;
    const elapsed = Date.now() - changeRef.current.at;
    const isPaste = delta > 80 && (elapsed < 800 || delta > 120);

    if (isPaste) {
      const delta = val.length - prev.length;
      const changeType = classifyPasteDelta(delta) || 'paste-large';
      const pasteRanges = buildPasteRanges(prev.length, val.length);
      // Best-effort pasted fragment: the text added since the previous content.
      const added = val.startsWith(prev) ? val.slice(prev.length) : val;
      setEditorContent(val);
      triggerPaste(pasteRanges, val, changeType, added);
    } else {
      setEditorContent(val);
    }

    changeRef.current = { at: Date.now(), len: val.length };
    if (openFile?.id) {
      setLastEditedMeta((m) => ({ ...m, [openFile.id]: { user: userName, timestamp: Date.now() } }));
    }
  };

  const simulatePaste = () => {
    if (readOnly) return;
    const prev = editorContent;
    const block =
      '\n\n[Pasted block: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.]\n\n';
    const next = prev + block;
    const pasteRanges = [{ start: prev.length, end: next.length }];
    setEditorContent(next);
    triggerPaste(pasteRanges, next, 'paste-large', block.trim());
  };

  const onBlurSave = () => {
    if (!openFile || readOnly) return;
    const prev = contentBeforeEditRef.current;
    if (editorContent !== prev) {
      saveVersion(openFile.id, `Saved (${editorContent.length} characters)`, {
        changeType: 'edit',
        content: editorContent,
        previousContent: prev,
      });
      contentBeforeEditRef.current = editorContent;
    }
    const htmlSnap = openFile.type === 'document' ? editorHtml : undefined;
    setFolders((prevFolders) =>
      prevFolders.map((folder) => ({
        ...folder,
        files: folder.files.map((f) =>
          f.id === openFile.id
            ? {
                ...f,
                content: editorContent,
                contentHtml: htmlSnap ?? f.contentHtml,
                lastEditedBy: userName,
                lastEditedAt: Date.now(),
                modified: 'just now',
              }
            : f
        ),
      }))
    );
    const difficulty = detectContentDifficulty({
      text: editorContent,
      html: htmlSnap,
      type: openFile.type,
    });
    const updated = {
      ...openFile,
      content: editorContent,
      contentHtml: htmlSnap ?? openFile.contentHtml,
      lastEditedBy: userName,
      lastEditedAt: Date.now(),
      modified: 'just now',
      difficulty,
    };
    setOpenFile((f) => (f?.id === openFile.id ? { ...f, content: editorContent, contentHtml: htmlSnap ?? f.contentHtml } : f));
    persistFile(updated);
    if (groupId && currentUser?.uid) {
      saveDocumentContent({
        fileId: openFile.id,
        userId: currentUser.uid,
        groupId,
        html: htmlSnap || '',
        text: editorContent,
      }).catch(() => {});
      incrementMemberMetric(groupId, currentUser.uid, { edits: 1 }).catch(() => {});
    }
  };

  const closeEditor = () => {
    if (!readOnly) {
      onBlurSave();
      saveOpenFileNow().catch(() => {});
    }
    setOpenFile(null);
    setIsMinimized(false);
    setIsMaximized(false);
    onEditorClose?.();
  };

  const confirmDeleteAction = () => {
    if (readOnly) return;
    if (!confirmDelete) return;
    if (confirmDelete.type === 'file') {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === confirmDelete.folderId ? { ...f, files: f.files.filter((x) => x.id !== confirmDelete.id) } : f
        )
      );
      if (openFile?.id === confirmDelete.id) {
        setOpenFile(null);
        setIsMinimized(false);
        setIsMaximized(false);
      }
      if (groupId) deleteWorkspaceFile(groupId, confirmDelete.id).catch(() => {});
    } else {
      if (groupId) deleteWorkspaceFolder(groupId, confirmDelete.id).catch(() => {});
      setFolders((prev) => {
        const next = prev.filter((f) => f.id !== confirmDelete.id);
        if (selectedFolderId === confirmDelete.id && next[0]) setSelectedFolderId(next[0].id);
        return next;
      });
    }
    setConfirmDelete(null);
    pushToast?.('Deleted successfully');
  };

  const btn = {
    background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
    color: '#fff',
    border: 'none',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  };

  const panel = {
    background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255,255,255,0.9)',
    border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
    borderRadius: '12px',
    padding: '16px',
  };

  const windowBtn = {
    background: 'transparent',
    border: 'none',
    fontSize: 14,
    cursor: 'pointer',
    padding: '6px 12px',
    color: '#333',
    lineHeight: 1,
  };

  const versions = openFile ? versionHistory[openFile.id] || [] : [];
  const isDoc = openFile?.type === 'document';
  const fileTypeKey =
    openFile?.type === 'spreadsheet'
      ? 'spreadsheet'
      : openFile?.type === 'presentation'
        ? 'presentation'
        : openFile?.type === 'document'
          ? 'document'
          : 'code';
  const chrome = EDITOR_APP[fileTypeKey];

  return (
    <div style={inlineEditor ? { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' } : undefined}>
      {/* Folders / files / insights — hidden in inline-editor mode */}
      {!inlineEditor && (<><div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: darkMode ? '#ededed' : '#1a1a1a' }}>Documents</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: darkMode ? '#9a9a9a' : '#666' }}>
            {readOnly
              ? 'View student submissions (read-only)'
              : 'Google Docs-style editor with folders and collaboration'}
          </p>
        </div>
        {!readOnly && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btn} onClick={() => createFile('document')}>
            + Document
          </button>
          <button type="button" style={btn} onClick={() => createFile('presentation')}>
            + PPT
          </button>
          <button type="button" style={btn} onClick={() => createFile('spreadsheet')}>
            + Excel
          </button>
          <button
            type="button"
            style={{
              ...btn,
              background: darkMode ? '#1c1c1c' : '#e8ecf1',
              color: darkMode ? '#ededed' : '#333',
              border: `1px solid ${darkMode ? '#2e2e2e' : '#ccc'}`,
            }}
            onClick={createFolder}
          >
            + Folder
          </button>
        </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr minmax(200px, 240px)', gap: 16, alignItems: 'start' }}>
        <div style={panel}>
          <h3
            style={{
              margin: '0 0 12px',
              fontSize: 11,
              fontWeight: 600,
              color: darkMode ? '#9a9a9a' : '#666',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Folders
          </h3>
          {folders.map((folder) => (
            <div key={folder.id} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => setSelectedFolderId(folder.id)}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  background:
                    selectedFolderId === folder.id
                      ? 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)'
                      : 'transparent',
                  color: selectedFolderId === folder.id ? '#fff' : darkMode ? '#9a9a9a' : '#666',
                }}
              >
                {folder.name} ({readOnly ? folder.files.filter((f) => isStudentWorkspaceFile(f, userName)).length : folder.files.length})
              </button>
              {!readOnly && folders.length > 1 && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete({ type: 'folder', id: folder.id, name: folder.name })}
                  style={{ border: 'none', background: 'transparent', color: '#e74c3c', cursor: 'pointer' }}
                >
                  Ã—
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={panel}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: darkMode ? '#ededed' : '#222' }}>
            {selectedFolder?.name}
          </h3>
          {files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 12px', color: darkMode ? '#9a9a9a' : '#999' }}>
              <p style={{ margin: 0 }}>
                {readOnly ? 'No student files in this folder yet' : 'Create a document to start writing'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {files.map((file) => {
                const meta = lastEditedMeta[file.id] || (file.lastEditedBy ? { user: file.lastEditedBy } : null);
                return (
                  <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => openFileHandler(file)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: `1px solid ${openFile?.id === file.id ? '#1D9E75' : darkMode ? '#2e2e2e' : '#e8e8e8'}`,
                        background:
                          openFile?.id === file.id
                            ? darkMode
                              ? 'rgba(29,158,117,0.2)'
                              : 'rgba(29,158,117,0.08)'
                            : darkMode
                              ? 'rgba(18, 18, 18,0.4)'
                              : '#fafafa',
                        color: darkMode ? '#ededed' : '#222',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: darkMode ? '#9a9a9a' : '#666', minWidth: 32 }}>
                        {file.type === 'document' ? 'DOC' : file.type === 'spreadsheet' ? 'XLS' : file.type === 'presentation' ? 'PPT' : 'CODE'}
                      </span>
                      <span>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{file.name}</div>
                        {(file.createdBy || meta) && (
                          <div style={{ fontSize: 10, color: '#1D9E75', marginTop: 2 }}>
                            {readOnly && file.createdBy
                              ? `Submitted by: ${file.createdBy}`
                              : meta
                                ? `Last edited: ${meta.user}`
                                : null}
                          </div>
                        )}
                      </span>
                    </button>
                    {!readOnly && (
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          onClick={() => setFileMenuId(fileMenuId === file.id ? null : file.id)}
                          style={{
                            width: 28, height: 28, borderRadius: 4,
                            border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                            background: 'transparent', color: darkMode ? '#9a9a9a' : '#666',
                            fontSize: 16, cursor: 'pointer', lineHeight: 1,
                          }}
                          aria-label="File options"
                        >
                          ⋮
                        </button>
                        {fileMenuId === file.id && (
                          <div style={{
                            position: 'absolute', right: 0, top: 30, zIndex: 50,
                            background: darkMode ? '#1c1c1c' : '#fff',
                            border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 120,
                          }}>
                            <MenuItem label="Rename" onClick={() => { pushToast?.('Rename from Drive view'); setFileMenuId(null); }} darkMode={darkMode} />
                            <MenuItem label="Duplicate" onClick={async () => {
                              const copy = { ...file, id: `file-${Date.now()}`, name: `${file.name} (copy)`, submitted: false };
                              try {
                                await saveWorkspaceFile(groupId, copy);
                                pushToast?.('File duplicated');
                              } catch { pushToast?.('Duplicate failed'); }
                              setFileMenuId(null);
                            }} darkMode={darkMode} />
                            <MenuItem label="Delete" danger onClick={() => {
                              setConfirmDelete({ type: 'file', id: file.id, folderId: selectedFolder?.id, name: file.name });
                              setFileMenuId(null);
                            }} darkMode={darkMode} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={panel}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: darkMode ? '#ededed' : '#333' }}>
            Contribution Insights
          </h3>
          {(groupMembers || []).map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: `1px solid ${darkMode ? '#2e2e2e' : '#eee'}`,
                color: darkMode ? '#d4d4d4' : '#444',
              }}
            >
              <span>{m.name?.split(' ')[0]}</span>
              <span style={{ color: darkMode ? '#9a9a9a' : '#666' }}>
                {m.edits} edits Â· {m.timeSpent}h
              </span>
            </div>
          ))}
        </div>
      </div>
      </>) } {/* end !inlineEditor sections */}

      {/* Minimized dock — hidden in inline mode (parent breadcrumb handles navigation) */}
      {openFile && isMinimized && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 250,
            background: '#2b579a',
            color: '#fff',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.2)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {openFile.name} â€” minimized (content preserved)
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              style={{ ...windowBtn, color: '#fff', background: 'rgba(255,255,255,0.15)', borderRadius: 4 }}
            >
              Restore
            </button>
            <button type="button" onClick={closeEditor} style={{ ...windowBtn, color: '#fff' }}>
              X
            </button>
          </div>
        </div>
      )}

      {/* Editor window — inline when inlineEditor=true, fixed modal otherwise */}
      {openFile && !isMinimized && (
        <div
          style={inlineEditor ? {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: '#525659',
          } : {
            position: 'fixed',
            inset: isMaximized ? 0 : undefined,
            top: isMaximized ? 0 : undefined,
            left: isMaximized ? 0 : undefined,
            right: isMaximized ? 0 : undefined,
            bottom: isMaximized ? 0 : undefined,
            background: isMaximized ? '#525659' : 'rgba(0,0,0,0.55)',
            zIndex: 200,
            display: 'flex',
            alignItems: isMaximized ? 'stretch' : 'center',
            justifyContent: 'center',
            padding: isMaximized ? 0 : 16,
          }}
        >
          <div
            style={inlineEditor ? {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              background: '#f3f3f3',
              overflow: 'hidden',
            } : {
              width: '100%',
              maxWidth: isMaximized ? 'none' : 960,
              height: isMaximized ? '100%' : 'auto',
              maxHeight: isMaximized ? 'none' : '92vh',
              display: 'flex',
              flexDirection: 'column',
              background: '#f3f3f3',
              borderRadius: isMaximized ? 0 : 4,
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}
          >
            {/* App title bar */}
            <div
              style={{
                background: chrome.titleBg,
                color: chrome.titleColor,
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                userSelect: 'none',
                borderBottom: `1px solid ${fileTypeKey === 'document' ? '#dadce0' : 'rgba(0,0,0,0.12)'}`,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {openFile.name}
                <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75, fontWeight: 400 }}>
                  {chrome.label}{readOnly ? ' · View only' : ''}
                </span>
              </span>
              <div style={{ display: 'flex' }}>
                {!inlineEditor && (
                  <button type="button" title="Minimize" onClick={() => setIsMinimized(true)}
                    style={{ ...windowBtn, color: chrome.titleColor, opacity: 0.8 }}>_</button>
                )}
                {!inlineEditor && (
                  <button type="button" title={isMaximized ? 'Restore' : 'Maximize'}
                    onClick={() => setIsMaximized((v) => !v)}
                    style={{ ...windowBtn, color: chrome.titleColor, opacity: 0.8 }}>
                    {isMaximized ? 'Restore' : 'Maximize'}
                  </button>
                )}
                <button type="button" title="Close" onClick={closeEditor}
                  style={{ ...windowBtn, color: chrome.titleColor, opacity: 0.8 }}>
                  {inlineEditor ? '← Close' : 'Close'}
                </button>
              </div>
            </div>

            {/* Action bar */}
            <div
              style={{
                background: chrome.barBg,
                borderBottom: '1px solid #dadce0',
                padding: '8px 16px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
              }}
            >
              {readOnly && (
                <span style={{ fontSize: 12, color: chrome.accent, fontWeight: 600, padding: '4px 10px', background: '#e8f0fe', borderRadius: 4 }}>
                  Lecturer view (read-only)
                </span>
              )}
              {isDoc && (
                <button
                  type="button"
                  onClick={() => setApaEnabled((v) => !v)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    border: '1px solid #ccc',
                    borderRadius: 3,
                    background: apaEnabled ? '#2b579a' : '#fff',
                    color: apaEnabled ? '#fff' : '#333',
                    cursor: 'pointer',
                  }}
                >
                  APA {apaEnabled ? 'ON' : 'OFF'}
                </button>
              )}
              {readOnly && (
              <button
                type="button"
                onClick={() => {
                  setShowVersionHistory((v) => !v);
                  setSelectedVersionId(null);
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  border: '1px solid #ccc',
                  borderRadius: 3,
                  background: showVersionHistory ? '#e8f4fc' : '#fff',
                  cursor: 'pointer',
                }}
              >
                Paste & Version Review
              </button>
              )}
              {!readOnly && (
                <button
                  type="button"
                  disabled={openFile?.submitted || submitting}
                  onClick={() => { setSubmitType('file'); setSubmitTargetId(openFile?.id); setShowSubmitModal(true); }}
                  style={{
                    padding: '4px 12px', fontSize: 12, border: 'none', borderRadius: 3,
                    background: (openFile?.submitted || submitting) ? '#9aa0a6' : 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                    color: '#fff', fontWeight: 600,
                    cursor: (openFile?.submitted || submitting) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {submitting && <span className="pl-spinner" style={{ width: 12, height: 12 }} />}
                  {openFile?.submitted ? 'Submitted' : submitting ? 'Submitting…' : 'Submit'}
                </button>
              )}
              {submissionReport && (
                <button type="button" onClick={() => setShowReportModal(true)}
                  style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #1D9E75', borderRadius: 3, background: '#e8f5f0', color: '#0F6E56', cursor: 'pointer' }}>
                  View Report
                </button>
              )}
              {/* Live collaborators (Google Docs style) */}
              {!readOnly && openFile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: '#5f6368', fontWeight: 600 }}>Editing:</span>
                  <div
                    title={`${userName} (you)`}
                    style={{
                      width: 26, height: 26, borderRadius: '50%', background: '#1D9E75',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: '#fff', border: '2px solid #fff',
                      boxShadow: '0 0 0 2px #1D9E75',
                    }}
                  >
                    {(userName || 'Y').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  {presenceUsers.map((u, i) => {
                    const colors = ['#4facfe', '#f093fb', '#ffc107', '#e74c3c', '#a29bfe'];
                    const bg = u.color || colors[i % colors.length];
                    const initials = (u.displayName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
                    return (
                      <div
                        key={u.id}
                        title={`${u.displayName} is editing this file`}
                        style={{
                          width: 26, height: 26, borderRadius: '50%', background: bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontWeight: 700, color: '#fff', border: '2px solid #fff',
                        }}
                      >
                        {initials}
                      </div>
                    );
                  })}
                  {presenceUsers.length === 0 && (
                    <span style={{ fontSize: 10, color: '#9aa0a6' }}>only you</span>
                  )}
                  {/* Google-Docs-style Share / add member */}
                  <button
                    type="button"
                    onClick={() => { setShareEmail(''); setShareRole('member'); setShowShareModal(true); }}
                    title="Add people to this workspace"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4,
                      padding: '5px 12px', borderRadius: 16, border: '1px solid #1D9E75',
                      background: 'rgba(29,158,117,0.08)', color: '#0F6E56',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" />
                    </svg>
                    Share
                  </button>
                </div>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>
                {editorContent.length} characters
              </span>
            </div>

            {readOnly && showVersionHistory && (
              <VersionHistoryPanel
                versions={versions}
                darkMode={false}
                selectedId={selectedVersionId}
                onSelect={setSelectedVersionId}
              />
            )}
            {readOnly && showVersionHistory && pasteEvents.length > 0 && (
              <div style={{ padding: '10px 16px', background: '#fff8e8', borderBottom: '1px solid #eee', fontSize: 12 }}>
                <strong>Paste events ({pasteEvents.length}):</strong>{' '}
                {pasteEvents.filter((p) => p.changeType === 'paste-large').length} large (red),{' '}
                {pasteEvents.filter((p) => p.changeType === 'paste-small').length} small (green)
              </div>
            )}

            {pasteAlert && (
              <div style={{ padding: '8px 16px', background: '#fff3cd', color: '#856404', fontSize: 12, borderBottom: '1px solid #ffc107' }}>
                {PASTE_MSG}
              </div>
            )}

            {submitting && (
              <div style={{ padding: '12px 20px', background: '#e8f4fc', color: '#2b579a', fontSize: 13, textAlign: 'center' }}>
                Running AI + plagiarism analysisâ€¦
              </div>
            )}

            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                background: chrome.canvasBg,
              }}
            >
              {isDoc ? (
                <WorkspaceEditor
                  ref={editorRef}
                  storageKey={`peerlytics-doc-${openFile.id}`}
                  initialHtml={editorHtml}
                  readOnly={readOnly || openFile.submitted}
                  placeholder={readOnly ? '' : ''}
                  onPageChange={(current, total) => setDocPage({ current, total })}
                  onChange={handleEditorChange}
                  onTypingStart={() => {
                    isTypingRef.current = true;
                    lastTypedAtRef.current = Date.now(); // mark active writing
                    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                    typingTimerRef.current = setTimeout(() => { isTypingRef.current = false; }, 2000);
                  }}
                  onTypingStop={() => {
                    isTypingRef.current = false;
                    // Count one "edit" per typing burst (a real edit unit) so the edit
                    // metric reflects actual writing — not only blur-saves, which often
                    // never fire before submit (left every student at 0 edits → same grade).
                    if (!readOnly && groupId && currentUser?.uid) {
                      incrementMemberMetric(groupId, currentUser.uid, { edits: 1 }).catch(() => {});
                    }
                    // Record a TYPED version once a MEANINGFUL chunk of new text has built up
                    // (≈40+ new chars, roughly a sentence) rather than on every micro-pause —
                    // saving per-pause produced dozens of tiny near-empty "Typed" rows that
                    // cluttered the history. The edit-count metric above still tracks every
                    // burst; this just keeps the version timeline readable and substantive.
                    if (!readOnly && openFile?.id) {
                      const prevSaved = contentBeforeEditRef.current || '';
                      const added = editorContent.length - prevSaved.length;
                      if (editorContent !== prevSaved && added >= 40) {
                        saveVersion(openFile.id, `Typed (${editorContent.length} characters)`, {
                          changeType: 'edit',
                          content: editorContent,
                          previousContent: prevSaved,
                        });
                        contentBeforeEditRef.current = editorContent;
                      }
                    }
                  }}
                  onPasteLarge={({ text, delta, pastedText }) => {
                    // Use the ACTUAL pasted text length to classify, and pass the real
                    // pasted fragment so the snippet matches the document for highlighting.
                    const size = pastedText ? pastedText.length : (delta ?? text.length - editorContent.length);
                    const changeType = classifyPasteDelta(size);
                    if (!changeType) return;
                    triggerPaste(null, text, changeType, pastedText);
                  }}
                />
              ) : openFile.type === 'spreadsheet' ? (
                <SheetsEditor
                  fileId={openFile.id}
                  readOnly={readOnly}
                  darkMode={darkMode}
                  onChange={(serialized) => {
                    onEditorChange({ target: { value: serialized } });
                  }}
                />
              ) : openFile.type === 'presentation' ? (
                <SlidesEditor
                  fileId={openFile.id}
                  readOnly={readOnly}
                  darkMode={darkMode}
                  onChange={(serialized) => {
                    onEditorChange({ target: { value: serialized } });
                  }}
                />
              ) : (
                <div
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: isMaximized ? '24px 0' : '20px 0',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 900,
                      minHeight: isMaximized ? 'calc(100vh - 200px)' : 480,
                      background: '#fff',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                      margin: '0 24px',
                      padding: 24,
                      boxSizing: 'border-box',
                    }}
                  >
                    <textarea
                      value={editorContent}
                      readOnly={readOnly}
                      onChange={onEditorChange}
                      onBlur={onBlurSave}
                      placeholder={readOnly ? '' : ''}
                      style={{
                        width: '100%',
                        minHeight: isMaximized ? 'calc(100vh - 280px)' : 400,
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        cursor: readOnly ? 'default' : 'text',
                        background: readOnly ? '#fafafa' : 'transparent',
                        color: '#24292e',
                        fontFamily: 'Consolas, monospace',
                        fontSize: 14,
                        lineHeight: 1.6,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Status bar — documents use WorkspaceEditor's Google Docs footer */}
            {!isDoc && (
            <div
              style={{
                background: chrome.statusBg,
                color: chrome.statusColor,
                fontSize: 11,
                padding: '6px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid rgba(0,0,0,0.08)',
              }}
            >
              <span>{fileTypeKey === 'spreadsheet' ? 'Sheet1' : fileTypeKey === 'presentation' ? 'Slide view' : 'Editor'}</span>
              <span>{readOnly ? 'View only' : userName}</span>
            </div>
            )}
          </div>
        </div>
      )}


      {showReportModal && submissionReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <ReportCard report={submissionReport} documentHtml={submittedHtml} suggestedGradeOverride={myReportGrade(submissionReport)} darkMode={darkMode} />
            <button type="button" onClick={() => setShowReportModal(false)} style={{ marginTop: 12, width: '100%', padding: 10, borderRadius: 8, border: 'none', background: '#1D9E75', color: '#fff', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* ── Auto-submit confirmation (shown when the user is present at the 30-min mark) ── */}
      {autoSubmitCountdown != null && (
        <div className="pl-fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="pl-modal-enter" style={{
            background: darkMode ? '#161616' : '#fff',
            color: darkMode ? '#ededed' : '#1a1a1a',
            border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
            borderRadius: 16, padding: 28, width: 400, maxWidth: '92vw', textAlign: 'center',
            boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>⏰</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Deadline in ~30 minutes</div>
            <p style={{ fontSize: 14, color: darkMode ? '#9a9a9a' : '#666', lineHeight: 1.6, margin: '0 0 18px' }}>
              Your work for <strong style={{ color: darkMode ? '#ededed' : '#1a1a1a' }}>{openFile?.name}</strong> will be
              submitted automatically. Submit now, or it will be sent in:
            </p>
            <div style={{ fontSize: 40, fontWeight: 800, color: '#1D9E75', marginBottom: 18, fontVariantNumeric: 'tabular-nums' }}>
              {Math.floor(autoSubmitCountdown / 60)}:{String(autoSubmitCountdown % 60).padStart(2, '0')}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => { autoSubmitDismissedRef.current = true; autoSubmitFiredRef.current = false; setAutoSubmitCountdown(null); pushToast?.('Okay — keep working. It will submit at the deadline.'); }}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`,
                  background: 'transparent', color: darkMode ? '#ededed' : '#1a1a1a',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Keep working
              </button>
              <button
                type="button"
                onClick={() => { setAutoSubmitCountdown(null); pushToast?.('Submitting now…'); handleCheckSubmit(); }}
                style={{
                  flex: 1.4, padding: '12px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                  color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Submit now
              </button>
            </div>
            <div style={{ fontSize: 11, color: darkMode ? '#777' : '#999', marginTop: 12 }}>
              You can keep editing — but your work <strong>will be submitted automatically at the deadline</strong>.
            </div>
          </div>
        </div>
      )}

      {/* ── Submit Modal ── */}
      {/* ── Share / Add member modal (Google-Docs style) ── */}
      {showShareModal && (
        <div className="pl-fade-in" onClick={() => setShowShareModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 550, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="pl-modal-enter" onClick={(e) => e.stopPropagation()}
            style={{ background: darkMode ? '#1c1c1c' : '#fff', border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`, borderRadius: 16, padding: 26, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: darkMode ? '#ededed' : '#222' }}>Add people</span>
              <button type="button" onClick={() => setShowShareModal(false)} style={{ background: 'none', border: 'none', color: darkMode ? '#9a9a9a' : '#888', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: darkMode ? '#9a9a9a' : '#666' }}>
              Invite someone to collaborate in this workspace. They’ll get a notification to join.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email" value={shareEmail} autoFocus
                onChange={(e) => setShareEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !sharing && shareEmail.trim()) { e.preventDefault(); handleShareInvite(); } }}
                placeholder="name@university.edu"
                style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111', fontSize: 13, boxSizing: 'border-box' }}
              />
              <select value={shareRole} onChange={(e) => setShareRole(e.target.value)}
                style={{ padding: '10px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111', fontSize: 13 }}>
                <option value="member">Member</option>
                <option value="lecturer">Lecturer</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setShowShareModal(false)}
                style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', color: darkMode ? '#ededed' : '#555', border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel <span style={{ opacity: 0.6, fontSize: 11 }}>Esc</span>
              </button>
              <button type="button" onClick={handleShareInvite} disabled={sharing || !shareEmail.trim()}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: (sharing || !shareEmail.trim()) ? '#9aa0a6' : 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (sharing || !shareEmail.trim()) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {sharing && <span className="pl-spinner" style={{ width: 12, height: 12 }} />}
                {sharing ? 'Adding…' : 'Add'} <span style={{ opacity: 0.7, fontSize: 11 }}>↵</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showSubmitModal && (
        <div className="pl-fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="pl-modal-enter" style={{ background: darkMode ? '#1c1c1c' : '#fff', border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: darkMode ? '#ededed' : '#222' }}>Submit work</span>
              <button type="button" onClick={() => setShowSubmitModal(false)} style={{ background: 'none', border: 'none', color: darkMode ? '#9a9a9a' : '#888', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>

            {/* Submission type */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Submission Type</div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[{ value: 'file', label: 'Single file', desc: 'Submit only this file' }, { value: 'folder', label: 'Folder', desc: 'Submit entire folder' }].map(t => (
                  <button key={t.value} type="button" onClick={() => setSubmitType(t.value)}
                    style={{ flex: 1, padding: '12px 8px', borderRadius: 10, border: `2px solid ${submitType === t.value ? '#1D9E75' : (darkMode ? '#2e2e2e' : '#ddd')}`, background: submitType === t.value ? 'rgba(29,158,117,0.12)' : 'transparent', color: submitType === t.value ? '#1D9E75' : (darkMode ? '#9a9a9a' : '#555'), cursor: 'pointer', fontSize: 12, fontWeight: submitType === t.value ? 700 : 400, textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Folder selector (when folder type) */}
            {submitType === 'folder' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Select Folder</div>
                <select value={submitTargetId || ''} onChange={e => setSubmitTargetId(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111', fontSize: 13 }}>
                  <option value="">Choose a folder…</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name} ({(f.files || []).length} files)</option>
                  ))}
                </select>
              </div>
            )}

            {/* Lecturer email */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Lecturer Email</div>
              <input value={submitLecturerEmail} onChange={e => setSubmitLecturerEmail(e.target.value)}
                placeholder="lecturer@university.edu"
                onKeyDown={(e) => { if (e.key === 'Enter' && !submitLoading && submitLecturerEmail.trim()) { e.preventDefault(); submitBtnRef.current?.click(); } }}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111', fontSize: 13, boxSizing: 'border-box' }} />
            </div>

            <button ref={submitBtnRef} type="button" disabled={submitLoading || !submitLecturerEmail.trim()}
              onClick={async () => {
                if (!submitLecturerEmail.trim()) { pushToast?.('Enter lecturer email'); return; }
                if (submitType === 'file' && !openFile) { pushToast?.('Open a file to submit'); return; }
                setSubmitLoading(true);
                try {
                  const { getDocs, query, collection, where } = await import('firebase/firestore');
                  const { getFirestoreDb } = await import('../firebase/config');
                  const q = query(collection(getFirestoreDb(), 'users'), where('email', '==', submitLecturerEmail.trim().toLowerCase()));
                  const snap = await getDocs(q);
                  if (snap.empty) { pushToast?.('No lecturer found with that email'); return; }
                  const lecturerDoc = snap.docs[0];
                  if (submitType === 'file') {
                    const result = await runFullSubmission({
                      lecturerId: lecturerDoc.id,
                      lecturerEmail: submitLecturerEmail.trim().toLowerCase(),
                    });
                    if (result) {
                      setShowReportModal(true);
                      pushToast?.('Full submission sent to lecturer with AI report');
                    }
                  } else {
                    const folder = folders.find(f => f.id === submitTargetId);
                    if (!folder || !(folder.files || []).length) {
                      pushToast?.('That folder has no files to submit');
                      return;
                    }
                    const result = await runFolderSubmission({
                      folder,
                      lecturerId: lecturerDoc.id,
                      lecturerEmail: submitLecturerEmail.trim().toLowerCase(),
                    });
                    if (result) {
                      const aiNote = result.saved?.aiEvaluation === 'unavailable'
                        ? ' (AI evaluation unavailable — delivered for manual review)'
                        : '';
                      pushToast?.(`Folder submitted to lecturer${aiNote}`);
                    }
                  }
                  setShowSubmitModal(false);
                  setSubmitLecturerEmail('');
                } catch (err) {
                  pushToast?.(err.message || 'Submission failed');
                } finally {
                  setSubmitLoading(false);
                }
              }}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: submitLoading || !submitLecturerEmail.trim() ? '#9aa0a6' : 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: submitLoading || !submitLecturerEmail.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {submitLoading && <span className="pl-spinner" />}
              {submitLoading ? 'Submitting & analyzing…' : 'Submit Now'}
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ ...panel, maxWidth: 360, width: '90%' }}>
            <h3 style={{ margin: '0 0 8px', color: darkMode ? '#ededed' : '#222' }}>Delete this item?</h3>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: darkMode ? '#9a9a9a' : '#666' }}>{confirmDelete.name}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                  background: 'transparent',
                  cursor: 'pointer',
                  color: darkMode ? '#ededed' : '#333',
                }}
              >
                Cancel
              </button>
              <button type="button" onClick={confirmDeleteAction} style={{ ...btn, background: '#e74c3c' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger, darkMode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
        border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12,
        color: danger ? '#e74c3c' : (darkMode ? '#ededed' : '#222'),
      }}
    >
      {label}
    </button>
  );
}

