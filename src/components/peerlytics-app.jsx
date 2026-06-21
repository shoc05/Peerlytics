import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Toast from './Toast';
import Logo from './Logo';
import UserAvatar from './UserAvatar';
// Heavy panels are code-split: TipTap (WorkspacePanel/Drive), Recharts (AnalyticsPanel),
// and the secondary panels load on demand, shrinking the initial bundle.
const WorkspacePanel = lazy(() => import('./WorkspacePanel'));
const WorkspaceDrive = lazy(() => import('./WorkspaceDrive'));
const AnalyticsPanel = lazy(() => import('./AnalyticsPanel'));
const ReportCard = lazy(() => import('./ReportCard'));
const ProfilePanel = lazy(() => import('./ProfilePanel'));
const StoragePanel = lazy(() => import('./StoragePanel'));
const CalendarPanel = lazy(() => import('./CalendarPanel'));
const ReportsPanel = lazy(() => import('./ReportsPanel'));
const AdminPanel = lazy(() => import('./AdminPanel'));
import { enrichMembers } from '../utils/scoring';
import { gradeSubmission, writingFromReport } from '../utils/behaviorGrade';
import {
  inviteLecturerByEmail,
  createProjectGroup,
  subscribeGroup,
  subscribeGroupsForUser,
  subscribeGroupMembers,
  subscribeActivity,
  subscribeReportsByGroup,
  getDocumentContent,
  subscribeGradeOverrides,
  addActivity,
  inviteMemberByEmail,
  saveGradeOverride,
  clearGradeOverride,
  subscribeNotifications,
  subscribeUserNotifications,
  markUserNotificationRead,
  markNotificationRead,
  deleteNotification,
  deleteUserNotification,
  subscribeInboxForLecturer,
  subscribeSubmissionsForUser,
  updateSubmissionStatus,
  deleteSubmission,
  createWorkspaceSubmission,
  updateWorkspace,
  deleteWorkspace,
} from '../firebase/firestoreService';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { logOut } from '../firebase/authService';
import { createActivityEntry, formatRelativeTime, formatDuration, formatDate, formatDateTime } from '../utils/workspaceHelpers';

// ─── Sidebar nav icons (small inline SVGs, currentColor) ───
const Svg = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props} />
);
const NavIconProjects = (p) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);
const NavIconAnalytics = (p) => (
  <Svg {...p}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 16v-5" /><path d="M12 16V8" /><path d="M16 16v-3" /></Svg>
);
const NavIconStorage = (p) => (
  <Svg {...p}><path d="M3 4h18v6H3z" /><path d="M3 14h18v6H3z" /><path d="M7 7h.01" /><path d="M7 17h.01" /></Svg>
);
const NavIconCalendar = (p) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>
);
const NavIconFiles = (p) => (
  <Svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></Svg>
);
const NavIconEditor = (p) => (
  <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></Svg>
);
const NavIconReport = (p) => (
  <Svg {...p}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7" /></Svg>
);
const NavIconGrading = (p) => (
  <Svg {...p}><circle cx="12" cy="8" r="6" /><path d="M9 14l-2 6 5-3 5 3-2-6" /></Svg>
);
const NavIconBell = (p) => (
  <Svg {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></Svg>
);

// Deterministic, distinct gradient per workspace so each card reads differently
// instead of every tile showing the same "WS".
const WS_GRADIENTS = [
  ['#1D9E75', '#4facfe'], ['#6a5acd', '#4facfe'], ['#e67e22', '#f1c40f'],
  ['#e74c3c', '#e67e22'], ['#16a085', '#1abc9c'], ['#8e44ad', '#e84393'],
  ['#2980b9', '#6dd5fa'], ['#11998e', '#38ef7d'],
];
const wsGradient = (key) => {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return WS_GRADIENTS[h % WS_GRADIENTS.length];
};
const wsInitials = (name) =>
  String(name || 'W').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'W';

/** Rounded workspace icon: per-name gradient tile with a folder glyph + initials. */
const WorkspaceIcon = ({ name, id, size = 44 }) => {
  const [a, b] = wsGradient(id || name);
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.27,
      background: `linear-gradient(135deg, ${a}, ${b})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: size * 0.34, letterSpacing: 0.5,
      boxShadow: `0 4px 12px ${a}40`, position: 'relative', flexShrink: 0,
    }}>
      <svg width={size * 0.92} height={size * 0.92} viewBox="0 0 24 24" fill="none"
        style={{ position: 'absolute', opacity: 0.18 }}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
          fill="#fff" />
      </svg>
      <span style={{ position: 'relative' }}>{wsInitials(name)}</span>
    </div>
  );
};

const PenaltyChip = ({ label }) => (
  <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.35)', fontSize: 11, fontWeight: 600, color: '#e74c3c' }}>
    {label}
  </span>
);

// Exact duration: shows seconds when < 1 min, minutes when < 1 hour, else hours + minutes.
function formatSecondsExact(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}${remS ? ` ${remS} sec` : ''}`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${remM ? ` ${remM} min` : ''}`;
}

const PeerlyticsDashboard = () => {
  const navigate = useNavigate();
  const { user: currentUser, isLecturer, isAdmin, refreshProfile } = useAuth();
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('peerlytics-theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('peerlytics-theme', darkMode ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [darkMode]);
  const [gradeOverrides, setGradeOverrides] = useState({});
  const [editingGradeId, setEditingGradeId] = useState(null);
  const [overrideInput, setOverrideInput] = useState('');
  // Mandatory justification a lecturer must give when their grade differs from the AI suggestion.
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [timeCapInput, setTimeCapInput] = useState('');
  const [savingTimeCap, setSavingTimeCap] = useState(false);
  const [expandedGradeId, setExpandedGradeId] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [userNotifications, setUserNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = React.useRef(null);
  const [language, setLanguage] = useState('en');
  const [activeTab, setActiveTab] = useState('projects');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [groupCreateName, setGroupCreateName] = useState('');
  const [groupCreateDeadline, setGroupCreateDeadline] = useState('');
  const [groupCreateLoading, setGroupCreateLoading] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  // Real browser network status — drives the offline banner (separate from the manual toggle).
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const [activityLog, setActivityLog] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [lecturerEmail, setLecturerEmail] = useState('');
  const [submissionReports, setSubmissionReports] = useState([]);
  const [groupMeta, setGroupMeta] = useState(null);
  // Seed the time-cap input from the workspace (default 60 min) whenever it changes.
  useEffect(() => {
    setTimeCapInput(String(groupMeta?.timeCapMinutes || 60));
  }, [groupMeta?.timeCapMinutes]);
  const [rawMembers, setRawMembers] = useState([]);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [wsContextMenu, setWsContextMenu] = useState(null); // { x, y, ws }
  const [confirmDeleteWs, setConfirmDeleteWs] = useState(null); // workspace to delete
  const [hoveredWsId, setHoveredWsId] = useState(null);
  useEffect(() => {
    if (!wsContextMenu) return undefined;
    const close = () => setWsContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [wsContextMenu]);
  // Read-only viewer for a submitted file (lecturer), shown workspace-style.
  const [fileViewer, setFileViewer] = useState(null); // { name, html, text } | null
  // Workspace-centric state
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  // Defined here (after activeWorkspaceId) so it can reference it without a TDZ error.
  const performDeleteWorkspace = useCallback(async (ws) => {
    try {
      await deleteWorkspace(ws.id);
      pushToast?.(`Deleted "${ws.name}"`);
      if (activeWorkspaceId === ws.id) { setActiveWorkspaceId(null); setGroupMeta(null); setActiveTab('projects'); }
    } catch (err) { pushToast?.(err.message || 'Could not delete workspace'); }
    finally { setConfirmDeleteWs(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);
  const [openFile, setOpenFile] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  // Fallback document content fetched from documents/{fileId} when a submission/report
  // doesn't carry documentContent (keyed by fileId). Ensures the lecturer's Document
  // View is never blank even if the snapshot copy was empty.
  const [docContentFallback, setDocContentFallback] = useState({});
  const activeGroupId = activeWorkspaceId || (isLecturer ? selectedGroup : currentUser?.groupId || null);

  useEffect(() => {
    if (!activeGroupId) return undefined;
    const unsubGroup = subscribeGroup(activeGroupId, setGroupMeta);
    const unsubMembers = subscribeGroupMembers(activeGroupId, setRawMembers);
    const unsubActivity = subscribeActivity(activeGroupId, (items) => {
      setActivityLog(
        items.map((e) => ({
          ...e,
          time: e.timestamp ? formatRelativeTime(e.timestamp) : e.time || 'just now',
        }))
      );
    });
    const unsubReports = subscribeReportsByGroup(activeGroupId, setSubmissionReports);
    const unsubGrades = subscribeGradeOverrides(activeGroupId, setGradeOverrides);
    const unsubNotifications = subscribeNotifications(activeGroupId, currentUser?.uid, setNotifications);
    return () => {
      unsubGroup();
      unsubMembers();
      unsubActivity();
      unsubReports();
      unsubGrades();
      unsubNotifications();
    };
  }, [activeGroupId, currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    return subscribeUserNotifications(currentUser.uid, setUserNotifications);
  }, [currentUser?.uid]);

  const allNotifications = useMemo(() => {
    const merged = [...userNotifications, ...notifications];
    const seen = new Set();
    return merged.filter((n) => {
      const key = `${n.id}-${n.groupId || 'user'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [userNotifications, notifications]);

  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const onViewReport = (e) => {
      const { reportId, workspaceId } = e.detail || {};
      if (workspaceId) {
        setActiveWorkspaceId(workspaceId);
        setSelectedGroup(workspaceId);
      }
      const sub = submissions.find((s) => s.reportId === reportId);
      if (sub) setSelectedSubmission(sub);
      setActiveTab(isLecturer ? 'aiReport' : 'storage');
    };
    window.addEventListener('peerlytics:view-report', onViewReport);
    return () => window.removeEventListener('peerlytics:view-report', onViewReport);
  }, [submissions, isLecturer]);

  const pushToast = useCallback((message) => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, type: 'success' }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  const handleProfileSave = async ({ name, classSection }) => {
    if (!currentUser?.uid) return;
    setProfileSaving(true);
    try {
      const { updateUserProfile } = await import('../firebase/firestoreService');
      // Name is always editable; students may also update their class/section.
      await updateUserProfile(currentUser.uid, { name, classSection });
      await refreshProfile?.();
      setShowProfilePanel(false);
      pushToast('Profile updated');
    } catch (err) {
      throw new Error(err.message || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const pushActivity = useCallback(
    (userOrAction, action) => {
      const user = action ? userOrAction : (currentUser?.name || 'User');
      const act = action || userOrAction;
      const wsId = activeWorkspaceId || activeGroupId;
      if (wsId) addActivity(wsId, { user, action: act }).catch(() => {});
      setActivityLog((log) => [createActivityEntry(user, act), ...log.slice(0, 11)]);
    },
    [activeWorkspaceId, activeGroupId, currentUser?.name]
  );

  const openWorkspace = useCallback((ws) => {
    if (!ws?.id) return;
    setActiveWorkspaceId(ws.id);
    setSelectedGroup(ws.id);
    setGroupMeta(ws);
    setActiveTab('drive');
    setOpenFile(null);
  }, []);

  const createGroup = async () => {
    if (!currentUser) return;
    if (!groupCreateName.trim()) {
      pushToast('Workspace name is required');
      return;
    }
    setGroupCreateLoading(true);
    try {
      const group = await createProjectGroup({
        name: groupCreateName,
        ownerId: currentUser.uid,
        ownerName: currentUser.name,
        ownerRole: currentUser.role,
        deadline: groupCreateDeadline || null,
      });
      const workspace = { ...group, id: group.id };
      setGroupCreateName('');
      setGroupCreateDeadline('');
      setAvailableGroups((prev) => {
        const map = new Map(prev.map((g) => [g.id, g]));
        map.set(workspace.id, workspace);
        return Array.from(map.values());
      });
      openWorkspace(workspace);
      pushToast('Workspace created — opening your files');
      pushActivity(currentUser.name, `created workspace ${group.name}`);
    } catch (err) {
      pushToast(err.message || 'Could not create workspace');
    } finally {
      setGroupCreateLoading(false);
    }
  };

  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    const unsub = subscribeGroupsForUser(currentUser.uid, setAvailableGroups);
    return unsub;
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!isLecturer || selectedGroup || !availableGroups.length) return;
    setSelectedGroup(availableGroups[0].id);
  }, [isLecturer, selectedGroup, availableGroups]);

  const lecturerWorkspaceIds = useMemo(
    () =>
      availableGroups
        .filter((g) => (g.lecturerIds || []).includes(currentUser?.uid))
        .map((g) => g.id),
    [availableGroups, currentUser?.uid]
  );

  // Submissions subscription
  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    const unsub = isLecturer
      ? subscribeInboxForLecturer(currentUser.uid, lecturerWorkspaceIds, setSubmissions)
      : subscribeSubmissionsForUser(currentUser.uid, setSubmissions);
    return unsub;
  }, [currentUser?.uid, isLecturer, lecturerWorkspaceIds.join(',')]);

  const workspaceSubmissions = useMemo(
    () => (activeGroupId ? submissions.filter((s) => s.workspaceId === activeGroupId) : submissions),
    [submissions, activeGroupId]
  );

  const sortedSubmissions = useMemo(() => {
    return [...submissions].sort((a, b) => {
      const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return tb - ta;
    });
  }, [submissions]);

  const workspaceReports = useMemo(
    () =>
      activeGroupId
        ? submissionReports.filter((r) => r.groupId === activeGroupId || r.workspaceId === activeGroupId)
        : submissionReports,
    [submissionReports, activeGroupId]
  );

  const effectiveLecturerSubmission = useMemo(() => {
    if (!isLecturer) return selectedSubmission;
    if (selectedSubmission && selectedSubmission.workspaceId === activeGroupId) return selectedSubmission;
    const wsSub = workspaceSubmissions[0];
    if (wsSub) return wsSub;
    if (workspaceReports[0]) {
      return {
        id: `auto-${workspaceReports[0].id}`,
        fileId: workspaceReports[0].fileId,
        reportId: workspaceReports[0].id,
        workspaceId: activeGroupId,
        status: 'submitted',
        fileName: workspaceReports[0].meta?.fileName || workspaceReports[0].fileName,
        submittedAt: workspaceReports[0].submittedAt || workspaceReports[0].updatedAt,
      };
    }
    return null;
  }, [isLecturer, selectedSubmission, workspaceSubmissions, workspaceReports, activeGroupId]);

  const lecturerToolsUnlocked = isLecturer && Boolean(
    effectiveLecturerSubmission ||
    workspaceReports.length > 0 ||
    workspaceSubmissions.length > 0 ||
    (groupMeta?.submittedToLecturers && currentUser?.uid && groupMeta.submittedToLecturers.includes(currentUser.uid))
  );

  const displayReports = useMemo(() => {
    if (!isLecturer) return submissionReports;
    const sub = effectiveLecturerSubmission;
    if (!sub) return workspaceReports.length ? [workspaceReports[0]] : [];
    // Scope to THIS submission's file so marking/analysis are per-file, never mixed.
    if (sub.reportId) {
      const byId = workspaceReports.filter((r) => r.id === sub.reportId);
      if (byId.length) return byId;
    }
    const fid = sub.fileId || sub.folderId;
    if (fid) {
      const byFile = workspaceReports.filter((r) => (r.fileId || r.meta?.fileId) === fid);
      if (byFile.length) return byFile;
    }
    // Last resort: the single newest report (not the whole list).
    return workspaceReports.length ? [workspaceReports[0]] : [];
  }, [isLecturer, effectiveLecturerSubmission, submissionReports, workspaceReports]);

  // Fallback: if the selected submission/report carries no documentContent, fetch the
  // live document text from documents/{fileId} so the lecturer's Document View isn't blank.
  useEffect(() => {
    if (!isLecturer || !lecturerToolsUnlocked) return;
    const sub = effectiveLecturerSubmission;
    const r0 = displayReports[0] || workspaceReports[0];
    const fileId = sub?.fileId || r0?.fileId || r0?.documentId;
    if (!fileId || docContentFallback[fileId] !== undefined) return;
    const hasContent =
      sub?.documentContent?.html || sub?.documentContent?.text ||
      r0?.documentContent?.html || r0?.documentContent?.text;
    if (hasContent) return;
    getDocumentContent(fileId)
      .then((d) => setDocContentFallback((m) => ({ ...m, [fileId]: d || null })))
      .catch(() => setDocContentFallback((m) => ({ ...m, [fileId]: null })));
  }, [isLecturer, lecturerToolsUnlocked, effectiveLecturerSubmission, displayReports, workspaceReports, docContentFallback]);

  // Resolved document content for the lecturer view (snapshot first, live fallback second).
  const lecturerDocContent = useMemo(() => {
    const sub = effectiveLecturerSubmission;
    const r0 = displayReports[0] || workspaceReports[0];
    // The REAL stored submission (from the inbox) carries documentContent — including the
    // combined contents of a FOLDER submission. effectiveLecturerSubmission can be a
    // synthetic object built from a report, so resolve the stored one by reportId/file/folder.
    const stored = workspaceSubmissions.find(
      (s) =>
        (sub?.reportId && s.reportId === sub.reportId) ||
        (sub?.id && s.id === sub.id) ||
        (sub?.fileId && (s.fileId === sub.fileId || s.folderId === sub.fileId)) ||
        (sub?.folderId && s.folderId === sub.folderId)
    ) || null;
    const fileId = sub?.fileId || r0?.fileId || r0?.documentId;
    const fb = fileId ? docContentFallback[fileId] : null;
    return {
      html: stored?.documentContent?.html || sub?.documentContent?.html || r0?.documentContent?.html || fb?.html || '',
      text: stored?.documentContent?.text || sub?.documentContent?.text || r0?.documentContent?.text || fb?.text || '',
    };
  }, [effectiveLecturerSubmission, displayReports, workspaceReports, docContentFallback, workspaceSubmissions]);

  useEffect(() => {
    if (!isLecturer || !activeGroupId) return;
    if (selectedSubmission?.workspaceId === activeGroupId) return;
    if (workspaceSubmissions.length > 0) {
      setSelectedSubmission(workspaceSubmissions[0]);
      return;
    }
    if (workspaceReports.length > 0) {
      const r = workspaceReports[0];
      setSelectedSubmission({
        id: `auto-${r.id}`,
        fileId: r.fileId,
        reportId: r.id,
        workspaceId: activeGroupId,
        status: 'submitted',
        fileName: r.meta?.fileName,
        submittedAt: r.submittedAt || r.updatedAt,
      });
    }
  }, [isLecturer, activeGroupId, workspaceSubmissions.length, workspaceReports.length]);

  const profileWorkspaces = useMemo(
    () => availableGroups.map((g) => ({ id: g.id, name: g.name, deadline: g.deadline })),
    [availableGroups]
  );

  // Bug 4 — backfill submittedToLecturers on legacy group docs so analytics unlock
  // correctly for submissions that pre-date the arrayUnion logic in createWorkspaceSubmission.
  useEffect(() => {
    if (!isLecturer || !currentUser?.uid || submissions.length === 0) return;
    (async () => {
      const { doc, updateDoc, arrayUnion } = await import('firebase/firestore');
      const { getFirestoreDb } = await import('../firebase/config');
      const db = getFirestoreDb();
      if (!db) return;
      for (const sub of submissions) {
        if (sub.workspaceId && sub.lecturerId === currentUser.uid) {
          try {
            // Add self to BOTH lecturerIds (become a group member so reads pass) and
            // submittedToLecturers (unlock). Needed for submissions that pre-date the
            // student-side lecturerIds fix.
            await updateDoc(doc(db, 'groups', sub.workspaceId), {
              lecturerIds: arrayUnion(currentUser.uid),
              submittedToLecturers: arrayUnion(currentUser.uid),
            });
          } catch (_) {}
        }
      }
    })();
  // Re-run only when the number of submissions changes (not on every render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions.length, isLecturer, currentUser?.uid]);

  const translations = {
    en: {
      signIn: 'Sign In',
      email: 'Email',
      password: 'Password',
      login: 'Login',
      logout: 'Logout',
      dashboard: 'Dashboard',
      workspace: 'My Workspace',
      groups: 'Groups',
      settings: 'Settings',
      toggleDark: 'Dark Mode',
      language: 'Language',
      student: 'Student',
      lecturer: 'Lecturer',
      switchRole: 'Switch Role',
      contribution: 'Contribution',
      aiReport: 'AI Report',
      grading: 'Grading',
      reports: 'Reports',
      offline: 'Offline Mode',
      sync: 'Sync Changes',
      projects: 'Projects',
      analytics: 'Analytics',
      analysis: 'Analysis',
      storage: 'Submitted Work',
      calendar: 'Calendar',
      files: 'Files',
      analyticsTools: 'Analytics Tools',
      online: 'Online',
    },
    dz: {
      signIn: 'ནང་བསྐྱོད།',
      email: 'ཐུགས་རིས་',
      password: 'གསང་ཆ',
      login: 'དོན་ལྡན།',
      logout: 'ཕྱིར་འབུད།',
      dashboard: 'ཙེམ་ཕང་།',
      workspace: 'ངེ་ཚུ་ས་མཐུན།',
      groups: 'ཚོ་གྲུབ།',
      settings: 'སྲིད་དེབ།',
      toggleDark: 'སྲིད་ཞིབ།',
      language: 'སྐད་རིགས།',
      student: 'སྦེད་ཆེན།',
      lecturer: 'སློབ་དཔོན།',
      switchRole: 'རོལ་རིས།',
      contribution: 'རྒྱབ་སྐུལ།',
      aiReport: 'AI སྙན་ཞུ།',
      grading: 'སྐུགས་འགྲེལ།',
      reports: 'སྙན་ཞུ་ཚུ།',
      offline: 'འབྲེལ་མེད།',
      sync: 'མཐུན་སྒྲིགས།',
      projects: 'ལས་འགུལ།',
      analytics: 'དབྱེ་ཞིབ།',
      analysis: 'དབྱེ་ཞིབ།',
      storage: 'བཙུགས་པའི་ལཱ།',
      calendar: 'ཟླ་ཐོ།',
      files: 'ཡིག་ཆ།',
      analyticsTools: 'དབྱེ་ཞིབ་ལག་ཆས།',
      online: 'འབྲེལ་ཐོག',
    }
  };

  const t = (key) => translations[language][key] || key;

  // Grading lives in ../utils/behaviorGrade (writing quality − conservative behavioural
  // penalties). Contribution roster/ranking/free-rider logic lives in ../utils/scoring
  // and is applied via enrichMembers.

  const currentGroup = groupMeta || { name: 'Loading group…', members: [], createdDate: '—', deadline: '—' };
  const allMembers = useMemo(() => rawMembers, [rawMembers]);

  useEffect(() => {
    const tick = setInterval(() => {
      setActivityLog((log) =>
        log.map((e) => (e.timestamp ? { ...e, time: formatRelativeTime(e.timestamp) } : e))
      );
    }, 30000);
    return () => clearInterval(tick);
  }, []);

  // Only fall back to a synthetic self-member for STUDENTS (so a lecturer is never
  // charted as a member of their own workspace). Lecturers start from the real roster.
  const membersForEnrich = allMembers.length
    ? allMembers
    : (isLecturer ? [] : [{ id: 'self', name: currentUser?.name, edits: 0, timeSpent: 0, taskCompletion: 0, difficulty: 1 }]);
  const groupMembers = enrichMembers(membersForEnrich);

  // Lecturers are read-only viewers — exclude them from all analytics, charts, and grading.
  // A member is treated as a lecturer if: uid in lecturerIds, role says lecturer, not in
  // memberIds (students live in memberIds), or it's the current user while they're a lecturer.
  const lecturerIdSet = useMemo(() => new Set(groupMeta?.lecturerIds || []), [groupMeta?.lecturerIds]);
  const studentMembers = useMemo(
    () =>
      groupMembers.filter((m) => {
        const id = m.uid || m.id;
        const role = String(m.role || '').toLowerCase();
        // Exclude only on POSITIVE lecturer signals. Do NOT exclude merely because an
        // id is absent from memberIds — that was too aggressive and emptied the roster
        // when analytics-member doc ids didn't line up with the group's memberIds.
        if (role.includes('lecturer')) return false;
        if (lecturerIdSet.has(id)) return false;
        // The viewing lecturer must never appear as a student in their own charts.
        if (isLecturer && (id === currentUser?.uid || (m.name && m.name === currentUser?.name))) return false;
        return true;
      }),
    [groupMembers, lecturerIdSet, isLecturer, currentUser?.uid, currentUser?.name]
  );

  // Behavioural + writing-quality grade for one member (spec model). Uses the submission
  // report's writing sub-scores (document-level) plus this member's own behaviour signals.
  // For a locked submission these inputs come from the frozen snapshot, so the output is
  // itself a static snapshot (no live recomputation).
  const behaviorGradeFor = useCallback((member) => {
    const report =
      displayReports.find((r) => r.userId === (member.id || member.uid)) ||
      displayReports[0] || workspaceReports[0] || null;

    // Look up attribution by uid, then by name (version-history attribution may key by
    // display name when no uid is available).
    const attrMap = report?.authorAttribution || {};
    const nameKey = `name:${String(member.name || member.fullName || '').trim().toLowerCase()}`;
    const attribution = attrMap[member.id || member.uid] || attrMap[nameKey] || null;

    // time_spent in SECONDS (member.timeSpent is tracked in minutes).
    const timeSpentSeconds = Math.round((member.timeSpent || 0) * 60);
    const editCount = member.edits || 0;

    // paste_percentage (0–100): share of this member's edits that were large pastes.
    // Falls back to 0 when we have no paste signal for them.
    const largePastes = attribution?.largePasteCount || 0;
    const pastePercentage = editCount > 0 ? Math.min(100, Math.round((largePastes / editCount) * 100)) : 0;

    // ai_probability (0–1): document AI likelihood scaled by this member's attributed share.
    const docAi = (report?.scores?.aiUsageScore ?? 0) / 100;
    const aiShare = (attribution?.aiShare ?? 0) / 100;
    const aiProbability = docAi * aiShare;

    return gradeSubmission({
      writing: writingFromReport(report),
      timeSpentSeconds,
      editCount,
      pastePercentage,
      aiProbability,
      timeCapMinutes: groupMeta?.timeCapMinutes || 60,
    });
  }, [displayReports, workspaceReports, groupMeta?.timeCapMinutes]);

  const getSuggestedGrade = (member) => behaviorGradeFor(member).recommendedScore;

  // Grade shown on the AI Report — uses the SAME behaviour grader as the Grading tab so
  // the two views never disagree. Resolves the report's author to a member (for their
  // time/edits) and falls back to a report-only member when no roster entry exists.
  const gradeForReport = useCallback((report) => {
    if (!report) return null;
    const uid = report.userId || report.meta?.userId;
    const member =
      groupMembers.find((m) => (m.id || m.uid) === uid) ||
      { id: uid, uid, timeSpent: 0, edits: report.audit?.versionCount || 0 };
    return behaviorGradeFor(member).recommendedScore;
  }, [groupMembers, behaviorGradeFor]);

  const getDisplayGrade = (member) => {
    if (gradeOverrides[member.id] !== undefined) return gradeOverrides[member.id];
    return getSuggestedGrade(member);
  };

  const startGradeOverride = (member) => {
    setEditingGradeId(member.id);
    setOverrideInput(String(getDisplayGrade(member)));
    // Pre-fill any existing reason so editing an override doesn't wipe its justification.
    const existing = gradeOverrides.__records?.[member.id];
    setOverrideReasonInput(existing?.overrideReason || '');
  };

  const saveGradeOverrideHandler = async (memberId) => {
    const parsed = parseInt(overrideInput, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 10 || !activeGroupId) {
      pushToast('Enter a grade between 0 and 10');
      return;
    }
    const member = groupMembers.find((m) => m.id === memberId) || { id: memberId };
    const suggested = getSuggestedGrade(member);
    const isOverride = Number(parsed) !== Number(suggested);
    // Fairness rule: any grade that differs from the AI suggestion REQUIRES a written reason.
    // This is the accountability trail that addresses unfair/unexplained grading.
    if (isOverride && !overrideReasonInput.trim()) {
      pushToast('A reason is required when changing the suggested grade');
      return;
    }
    await saveGradeOverride(activeGroupId, memberId, parsed, {
      suggestedGrade: suggested,
      reason: overrideReasonInput.trim(),
      lecturerId: currentUser?.uid || null,
      lecturerName: currentUser?.name || currentUser?.displayName || '',
    });
    pushToast(isOverride ? 'Grade override saved with reason' : 'Grade confirmed');
    setEditingGradeId(null);
    setOverrideInput('');
    setOverrideReasonInput('');
  };

  const clearGradeOverrideHandler = async (memberId) => {
    if (activeGroupId) await clearGradeOverride(activeGroupId, memberId);
    setEditingGradeId(null);
    pushToast('Override cleared — using AI suggestion');
  };

  // Keyboard support for the logout confirmation: Enter = log out, Esc = cancel.
  useEffect(() => {
    if (!showLogoutConfirm) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setShowLogoutConfirm(false); }
      else if (e.key === 'Enter') { e.preventDefault(); performLogout(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLogoutConfirm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard on the logout confirm: Enter = log out, Esc = cancel.
  useEffect(() => {
    if (!showLogoutConfirm) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setShowLogoutConfirm(false); }
      else if (e.key === 'Enter') { e.preventDefault(); performLogout(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLogoutConfirm]);

  const performLogout = async () => {
    setShowLogoutConfirm(false);
    window.dispatchEvent(new Event('peerlytics:flush'));
    await new Promise((r) => setTimeout(r, 400));
    // Reset workspace state before logout so it doesn't bleed into next session
    setActiveWorkspaceId(null);
    setSelectedGroup(null);
    setAvailableGroups([]);
    setOpenFile(null);
    setSelectedSubmission(null);
    await logOut();
    navigate('/login');
  };

  if (!currentUser) return null;

  // Admins get a dedicated oversight page (not the student/lecturer workspace layout).
  if (isAdmin) {
    return (
      <div style={{
        background: darkMode ? '#0d0d0d' : '#f0f7f4', color: darkMode ? '#ededed' : '#1a2e24',
        minHeight: '100vh', fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
      }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 28px', borderBottom: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontWeight: 800, fontSize: 18 }}>
            <span style={{ background: 'linear-gradient(135deg,#1D9E75,#0F6E56)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Peerlytics</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#6c5ce7', borderRadius: 4, padding: '2px 8px' }}>ADMIN</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: darkMode ? '#9a9a9a' : '#666' }}>{currentUser.name || currentUser.email}</span>
            <button type="button" onClick={() => setDarkMode((v) => !v)} style={{ background: 'transparent', border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, color: darkMode ? '#ededed' : '#333', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
              {darkMode ? 'Light' : 'Dark'}
            </button>
            <button type="button" onClick={performLogout} style={{ background: 'transparent', border: '1px solid #e74c3c', color: '#e74c3c', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
              Logout
            </button>
          </div>
        </header>
        <div style={{ padding: '30px', maxWidth: 1100, margin: '0 auto' }}>
          <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: darkMode ? '#9a9a9a' : '#666' }}>Loading admin…</div>}>
            <AdminPanel darkMode={darkMode} />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
   <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: darkMode ? '#9a9a9a' : '#666' }}>Loading…</div>}>
    <div style={{
      background: darkMode ? '#0d0d0d' : '#f0f7f4',
      color: darkMode ? '#ededed' : '#1a2e24',
      minHeight: '100vh',
      fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
      transition: 'background 0.3s',
    }}>
      {/* Network status banner — only when the browser reports offline */}
      {!isOnline && (
        <div className="pl-fade-in" style={{
          position: 'sticky', top: 0, zIndex: 300, textAlign: 'center',
          background: '#e67e22', color: '#fff', fontSize: 13, fontWeight: 600,
          padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <span className="pl-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
          You're offline — changes are saved locally and will sync when the connection returns.
        </div>
      )}
      {/* NAVBAR */}
      <div style={{
        background: darkMode ? 'rgba(13, 13, 13, 0.92)' : 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${darkMode ? '#2e2e2e' : '#dce5e0'}`,
        boxShadow: darkMode ? 'none' : '0 1px 0 rgba(45, 74, 62, 0.06)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <Logo variant="banner" darkMode={darkMode} height={44} width="auto" />

        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button onClick={() => setLanguage(language === 'en' ? 'dz' : 'en')} style={{
            background: darkMode ? '#1c1c1c' : '#e8ecf1',
            border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`,
            color: darkMode ? '#ededed' : '#0d0d0d',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            {language === 'en' ? 'རྫོང་ཁ' : 'EN'}
          </button>

          <button onClick={() => setDarkMode(!darkMode)} style={{
            background: darkMode ? '#1c1c1c' : '#e8ecf1',
            border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`,
            color: darkMode ? '#ededed' : '#0d0d0d',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            {darkMode ? 'Light' : 'Dark'}
          </button>

          {/* Notification bell */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowNotifications(v => !v)}
              style={{
                background: darkMode ? '#1c1c1c' : '#e8ecf1',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`,
                color: darkMode ? '#ededed' : '#0d0d0d',
                padding: '8px',
                borderRadius: '8px',
                cursor: 'pointer',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
              }}
              title="Notifications"
            >
              <NavIconBell width={18} height={18} />
              {allNotifications.filter(n => !n.read).length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  background: '#e74c3c',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 16,
                  height: 16,
                  fontSize: 9,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {Math.min(9, allNotifications.filter(n => !n.read).length)}
                </span>
              )}
            </button>

            {showNotifications && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 8px)',
                  width: 320,
                  background: darkMode ? '#1a1a1a' : '#fff',
                  border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                  borderRadius: 10,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                  zIndex: 200,
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${darkMode ? '#2e2e2e' : '#eee'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: darkMode ? '#ededed' : '#222' }}>Notifications</span>
                  <button type="button" onClick={() => setShowNotifications(false)} style={{ background: 'none', border: 'none', color: darkMode ? '#9a9a9a' : '#999', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </div>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {allNotifications.length === 0 ? (
                    <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 13, color: darkMode ? '#9a9a9a' : '#999' }}>No notifications yet</div>
                  ) : (
                    allNotifications.map(n => (
                      <div
                        key={`${n.id}-${n.groupId || 'u'}`}
                        onClick={async () => {
                          if (!n.read) {
                            if (n.groupId && activeGroupId === n.groupId) {
                              await markNotificationRead(n.groupId, n.id).catch(() => {});
                            } else if (currentUser?.uid) {
                              await markUserNotificationRead(currentUser.uid, n.id).catch(() => {});
                            }
                          }
                          if (n.type === 'invite' && n.groupId) {
                            setActiveWorkspaceId(n.groupId);
                            setSelectedGroup(n.groupId);
                            setShowNotifications(false);
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                          padding: '12px 16px',
                          borderBottom: `1px solid ${darkMode ? '#262626' : '#f0f0f0'}`,
                          background: n.read ? 'transparent' : (darkMode ? 'rgba(29,158,117,0.08)' : 'rgba(29,158,117,0.04)'),
                          cursor: n.read ? 'default' : 'pointer',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: darkMode ? '#d4d4d4' : '#333', lineHeight: 1.5 }}>{n.message}</div>
                          {n.invitedByName && (
                            <div style={{ fontSize: 10, color: darkMode ? '#9a9a9a' : '#888', marginTop: 4 }}>
                              Invited by {n.invitedByName}
                            </div>
                          )}
                          {!n.read && (
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', marginTop: 4 }} />
                          )}
                        </div>
                        <button
                          type="button"
                          title="Delete notification"
                          onClick={async (e) => {
                            e.stopPropagation(); // don't trigger the item's mark-read/open handler
                            if (n.groupId) {
                              await deleteNotification(n.groupId, n.id).catch(() => {});
                            } else if (currentUser?.uid) {
                              await deleteUserNotification(currentUser.uid, n.id).catch(() => {});
                            }
                          }}
                          style={{
                            flexShrink: 0,
                            background: 'none',
                            border: 'none',
                            color: darkMode ? '#777' : '#aaa',
                            cursor: 'pointer',
                            fontSize: 14,
                            lineHeight: 1,
                            padding: '2px 4px',
                            borderRadius: 4,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#e5484d'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = darkMode ? '#777' : '#aaa'; }}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <UserAvatar
            user={currentUser}
            onProfileClick={() => setShowProfilePanel(true)}
            darkMode={darkMode}
          />

          <button onClick={() => setShowLogoutConfirm(true)} style={{
            background: darkMode ? '#1c1c1c' : '#e8ecf1',
            border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`,
            color: darkMode ? '#ededed' : '#0d0d0d',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            {t('logout')}
          </button>
        </div>
      </div>

      {/* LOGOUT CONFIRMATION */}
      {showLogoutConfirm && (
        <div
          onClick={() => setShowLogoutConfirm(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: darkMode ? '#1a1a1a' : '#fff',
              color: darkMode ? '#ededed' : '#1a1a1a',
              border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
              borderRadius: 12, padding: 24, width: 340, maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Log out?</div>
            <div style={{ fontSize: 13, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 20 }}>
              You'll be signed out and returned to the login screen. Any unsaved changes are saved first.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`, background: 'transparent', color: darkMode ? '#ededed' : '#1a1a1a', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performLogout}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#e74c3c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORKSPACE RIGHT-CLICK MENU */}
      {wsContextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: wsContextMenu.y, left: wsContextMenu.x, zIndex: 1100,
            background: darkMode ? '#1c1c1c' : '#fff', border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', padding: 6, minWidth: 160,
          }}
        >
          <button type="button"
            onClick={() => { openWorkspace(wsContextMenu.ws); setWsContextMenu(null); }}
            style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, textAlign: 'left', color: darkMode ? '#ededed' : '#1a1a1a' }}>
            Open
          </button>
          <button type="button"
            onClick={() => { const ws = wsContextMenu.ws; setWsContextMenu(null); setConfirmDeleteWs(ws); }}
            style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, textAlign: 'left', color: '#e74c3c' }}>
            Delete workspace
          </button>
        </div>
      )}

      {/* WORKSPACE DELETE CONFIRM (Enter = delete, Esc = cancel) */}
      {confirmDeleteWs && (
        <div onClick={() => setConfirmDeleteWs(null)} className="pl-fade-in"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div onClick={(e) => e.stopPropagation()} className="pl-modal-enter"
            tabIndex={-1}
            ref={(el) => el && el.focus()}
            onKeyDown={(e) => { if (e.key === 'Enter') performDeleteWorkspace(confirmDeleteWs); else if (e.key === 'Escape') setConfirmDeleteWs(null); }}
            style={{ background: darkMode ? '#1a1a1a' : '#fff', color: darkMode ? '#ededed' : '#1a1a1a', border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`, borderRadius: 12, padding: 24, width: 360, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.45)', outline: 'none' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete workspace?</div>
            <div style={{ fontSize: 13, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 20 }}>
              <strong>“{confirmDeleteWs.name}”</strong> and all its files will be permanently deleted. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirmDeleteWs(null)}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#d0d0d0'}`, background: 'transparent', color: darkMode ? '#ededed' : '#1a1a1a', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel <span style={{ opacity: 0.6, fontSize: 11 }}>Esc</span>
              </button>
              <button type="button" onClick={() => performDeleteWorkspace(confirmDeleteWs)}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#e74c3c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Delete <span style={{ opacity: 0.7, fontSize: 11 }}>↵</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* READ-ONLY FILE VIEWER (workspace-style) */}
      {fileViewer && (
        <div
          onClick={() => setFileViewer(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: darkMode ? '#1a1a1a' : '#fff', borderRadius: 12,
              border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
              width: 'min(900px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.45)', overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: darkMode ? '#ededed' : '#1a1a1a' }}>
                {fileViewer.name} <span style={{ fontSize: 12, fontWeight: 500, color: darkMode ? '#9a9a9a' : '#888' }}>· View only</span>
              </div>
              <button type="button" onClick={() => setFileViewer(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: darkMode ? '#9a9a9a' : '#666' }}>✕</button>
            </div>
            {/* Google-Docs-style page, matching the workspace editor look */}
            <div style={{ background: darkMode ? '#0d0d0d' : '#f3f4f7', padding: '24px', overflowY: 'auto', flex: 1 }}>
              <div style={{
                background: '#fff', color: '#1a1a1a', margin: '0 auto', maxWidth: 720,
                minHeight: 400, padding: '64px 72px', borderRadius: 2,
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                fontFamily: '"Times New Roman", Times, serif', fontSize: 15, lineHeight: 1.8,
              }}>
                {fileViewer.html
                  ? <div dangerouslySetInnerHTML={{ __html: fileViewer.html }} />
                  : fileViewer.text
                    ? <div style={{ whiteSpace: 'pre-wrap' }}>{fileViewer.text}</div>
                    : <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>No file content was captured with this submission.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div style={{ display: 'flex', height: 'calc(100vh - 65px)' }}>
        {/* SIDEBAR */}
        <aside className={`w-[220px] overflow-y-auto p-3 flex flex-col gap-1 backdrop-blur-md border-r ${
          darkMode ? 'bg-[#202020] border-[#333333]' : 'bg-white border-slate-200 shadow-[2px_0_12px_rgba(45,74,62,0.04)]'
        }`}>
          {/* Main nav — spec: Projects · Analytics · Storage · Calendar */}
          {[
            { id: 'projects', label: t('projects'), icon: NavIconProjects },
            // Analytics is not in the main nav: students don't get it at all, and for
            // lecturers it lives in "Analytics Tools" as "Analysis".
            { id: 'storage', label: t('storage'), icon: NavIconStorage },
            // Students can view their own AI report; lecturers use the review screen instead.
            ...(isLecturer ? [] : [{ id: 'aiReport', label: t('aiReport'), icon: NavIconReport }]),
            { id: 'calendar', label: t('calendar'), icon: NavIconCalendar },
          ].map(item => {
            const unread = item.id === 'storage' ? submissions.filter(s => !s.reviewedAt).length : 0;
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === 'projects') { setActiveWorkspaceId(null); setOpenFile(null); }
                }}
                className={`group w-full px-3 py-2.5 rounded-lg text-[13px] text-left flex items-center gap-2.5 transition active:scale-[0.98] ${
                  isActive
                    ? 'bg-brand-gradient text-white font-bold shadow-soft'
                    : darkMode
                      ? 'text-ink-400 hover:text-ink-100 hover:bg-white/5 font-medium'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-medium'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0 transition-transform group-hover:scale-110" />
                <span>{item.label}</span>
                {unread > 0 && (
                  <span className="ml-auto bg-rose-500 text-white rounded-full text-[10px] px-2 py-0.5 font-bold ring-2 ring-rose-500/30 animate-pulse">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}

          {/* Active workspace section */}
          {activeWorkspaceId && groupMeta && (
            <div className="mt-3">
              <div className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1 mb-1.5 ${darkMode ? 'text-ink-400' : 'text-slate-400'}`}>
                {t('workspace')}
              </div>
              <div className={`px-3 py-2.5 rounded-lg border-l-[3px] border-brand-500 mb-1.5 ${
                darkMode ? 'bg-brand-500/10' : 'bg-brand-50'
              }`}>
                <div className={`text-xs font-bold truncate ${darkMode ? 'text-ink-100' : 'text-slate-900'}`}>{groupMeta.name}</div>
              </div>
              {[
                { id: 'drive', label: t('files'), icon: NavIconFiles },
                { id: 'editor', label: openFile ? openFile.name : t('files'), icon: NavIconEditor, disabled: !openFile },
              ].map(item => {
                const isActive = activeTab === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => !item.disabled && setActiveTab(item.id)}
                    className={`w-full px-2.5 py-2 rounded-lg text-xs text-left flex items-center gap-2 overflow-hidden transition ${
                      item.disabled
                        ? darkMode ? 'text-ink-700 cursor-default' : 'text-slate-300 cursor-default'
                        : isActive
                          ? 'bg-sky-400/15 text-sky-400 font-bold'
                          : darkMode
                            ? 'text-ink-400 hover:bg-white/5 hover:text-ink-100'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    } active:scale-[0.98]`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Lecturer analytics tools */}
          {isLecturer && (
            <div className="mt-3">
              <div className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1 mb-1.5 ${darkMode ? 'text-ink-400' : 'text-slate-400'}`}>
                {t('analyticsTools')}
              </div>
              {[
                { id: 'analytics', label: t('analysis'), icon: NavIconAnalytics },
                { id: 'aiReport', label: t('aiReport'), icon: NavIconReport },
                { id: 'grading', label: t('grading'), icon: NavIconGrading },
                { id: 'reports', label: t('reports'), icon: NavIconReport, alwaysOpen: true },
              ].map(item => {
                // The class-grouped Reports overview doesn't need a selected submission.
                const locked = !lecturerToolsUnlocked && !item.alwaysOpen;
                const isActive = activeTab === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => !locked && setActiveTab(item.id)}
                    title={locked ? 'Open Submitted Work and select a submission' : item.label}
                    className={`w-full px-2.5 py-2 rounded-lg text-xs text-left flex items-center gap-2 transition ${
                      locked
                        ? darkMode ? 'text-ink-700 cursor-not-allowed' : 'text-slate-300 cursor-not-allowed'
                        : isActive
                          ? 'bg-brand-gradient text-white font-bold shadow-soft'
                          : darkMode
                            ? 'text-ink-400 hover:bg-white/5 hover:text-ink-100 font-semibold'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-semibold'
                    } active:scale-[0.98]`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{item.label}</span>
                    {locked && <span className="ml-auto text-[10px] font-bold opacity-70">Locked</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div className={`mt-auto pt-3 border-t ${darkMode ? 'border-ink-700' : 'border-slate-200'}`}>
            <button
              type="button"
              onClick={() => setOfflineMode(!offlineMode)}
              className={`w-full px-2.5 py-2 rounded-lg text-xs text-left flex items-center gap-2 border transition active:scale-[0.98] ${
                offlineMode
                  ? 'bg-amber-400/15 text-amber-400 border-amber-400/40'
                  : darkMode
                    ? 'bg-transparent text-ink-400 border-ink-700 hover:bg-white/5'
                    : 'bg-transparent text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${offlineMode ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}`} />
              {offlineMode ? t('offline') : t('online')}
            </button>
          </div>
        </aside>

        {/* CONTENT AREA */}
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflowY: (activeTab === 'drive' || activeTab === 'editor') ? 'hidden' : 'auto',
          padding: (activeTab === 'drive' || activeTab === 'editor') ? 0 : '30px',
        }}>
          {/* DASHBOARD VIEW — superseded by the AnalyticsPanel-based Analysis block below */}
          {false && (
            <div>
              <div style={{ marginBottom: '30px' }}>
                <h1 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700' }}>
                  Welcome back, {currentUser.name}!
                </h1>
                <p style={{ margin: '0', color: darkMode ? '#9a9a9a' : '#666', fontSize: '14px' }}>
                  {isLecturer ? 'Monitor group progress and fairness metrics.' : 'Track your contributions and collaborate with peers.'}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '30px' }}>
                <div style={{
                  background: darkMode ? 'rgba(29, 158, 117, 0.1)' : 'rgba(29, 158, 117, 0.05)',
                  border: `1px solid ${darkMode ? 'rgba(29, 158, 117, 0.3)' : 'rgba(29, 158, 117, 0.2)'}`,
                  borderRadius: '12px',
                  padding: '20px',
                  borderLeft: '4px solid #1D9E75',
                }}>
                  <div style={{ fontSize: '12px', color: darkMode ? '#9a9a9a' : '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
                    Total Edits
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#1D9E75' }}>
                    {studentMembers.reduce((a, b) => a + b.edits, 0)}
                  </div>
                </div>

                <div style={{
                  background: darkMode ? 'rgba(79, 172, 254, 0.1)' : 'rgba(79, 172, 254, 0.05)',
                  border: `1px solid ${darkMode ? 'rgba(79, 172, 254, 0.3)' : 'rgba(79, 172, 254, 0.2)'}`,
                  borderRadius: '12px',
                  padding: '20px',
                  borderLeft: '4px solid #4facfe',
                }}>
                  <div style={{ fontSize: '12px', color: darkMode ? '#9a9a9a' : '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
                    Avg Effort Score
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#4facfe' }}>
                    {Math.round(studentMembers.reduce((a, b) => a + b.effortScore, 0) / (studentMembers.length || 1))}
                  </div>
                </div>

                <div style={{
                  background: darkMode ? 'rgba(255, 193, 7, 0.1)' : 'rgba(255, 193, 7, 0.05)',
                  border: `1px solid ${darkMode ? 'rgba(255, 193, 7, 0.3)' : 'rgba(255, 193, 7, 0.2)'}`,
                  borderRadius: '12px',
                  padding: '20px',
                  borderLeft: '4px solid #ffc107',
                }}>
                  <div style={{ fontSize: '12px', color: darkMode ? '#9a9a9a' : '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
                    Fairness Balance
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#ffc107' }}>
                    {Math.round(studentMembers.reduce((a, b) => a + b.fairnessScore, 0) / (studentMembers.length || 1))}%
                  </div>
                </div>
              </div>

              <div style={{
                background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '600' }}>Live Activity</h2>
                {activityLog.slice(0, 8).map((a) => (
                  <div key={a.id || a.action} style={{ fontSize: '13px', marginBottom: '10px', color: darkMode ? '#9a9a9a' : '#666' }}>
                    <strong style={{ color: '#1D9E75' }}>{a.user}</strong> — {a.action}
                    <span style={{ marginLeft: 8, opacity: 0.75, fontSize: 11 }}>{a.time}</span>
                  </div>
                ))}
              </div>

              {/* Leaderboard */}
              <div style={{
                background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Group Leaderboard</h2>
                <div style={{ display: 'grid', gap: '12px' }}>
                  {studentMembers.map((member, idx) => (
                    <div key={member.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '16px',
                      background: darkMode ? 'rgba(29, 158, 117, 0.08)' : 'rgba(29, 158, 117, 0.03)',
                      borderRadius: '8px',
                      border: `1px solid ${darkMode ? 'rgba(29, 158, 117, 0.2)' : 'rgba(29, 158, 117, 0.1)'}`,
                      transition: 'all 0.3s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = darkMode ? 'rgba(29, 158, 117, 0.15)' : 'rgba(29, 158, 117, 0.08)';
                      e.currentTarget.style.transform = 'translateX(4px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = darkMode ? 'rgba(29, 158, 117, 0.08)' : 'rgba(29, 158, 117, 0.03)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                    >
                      <div style={{
                        width: '36px',
                        height: '36px',
                        background: idx === 0 ? '#ffc107' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#666',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        color: 'white',
                        fontSize: '14px',
                      }}>
                        {idx + 1}
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>{member.name}</div>
                        <div style={{ fontSize: '12px', color: darkMode ? '#9a9a9a' : '#666', display: 'flex', gap: '12px' }}>
                          <span>{member.edits} edits</span>
                          <span>{formatDuration(member.timeSpent)}</span>
                          <span>{member.taskCompletion}% tasks</span>
                        </div>
                      </div>

                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '8px',
                      }}>
                        <div style={{
                          background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontWeight: '600',
                          fontSize: '13px',
                        }}>
                          {member.effortScore} pts
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 160 }}>
                          {(member.badges || []).slice(0, 2).map((b) => (
                            <span
                              key={b.label}
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: `${b.color || '#1D9E75'}22`,
                                color: b.color || '#1D9E75',
                                fontWeight: 600,
                              }}
                            >
                              {b.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CONTRIBUTION TRACKER */}
          {(activeTab === 'contribution' || activeTab === 'analytics') && isLecturer && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>Contribution & Fairness</h1>
              {isLecturer && !lecturerToolsUnlocked ? (
                <div style={{ textAlign: 'center', padding: '80px 24px', color: darkMode ? '#9a9a9a' : '#888' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: darkMode ? '#9a9a9a' : '#888', marginBottom: 16, letterSpacing: '0.05em' }}>LOCKED</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: darkMode ? '#ededed' : '#333' }}>No submissions yet</div>
                  <div style={{ fontSize: 14 }}>Select a submission from the Inbox tab to unlock contribution data.</div>
                </div>
              ) : (
              <>
              <AnalyticsPanel
                reports={displayReports.length ? displayReports : workspaceReports}
                groupMembers={studentMembers}
                lecturerIds={groupMeta?.lecturerIds || []}
                memberIds={groupMeta?.memberIds || []}
                activityLog={activityLog}
                darkMode={darkMode}
                currentSubmissionReport={displayReports[0] || workspaceReports[0] || null}
                workspaceCreatedAt={groupMeta?.createdDate || (groupMeta?.createdAt?.seconds ? groupMeta.createdAt.seconds * 1000 : null)}
                deadline={groupMeta?.deadline || null}
              />
              {false && (<>
              <div style={{
                background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Member Contributions</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={studentMembers}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#2e2e2e' : '#e0e0e0'} />
                    <XAxis dataKey="name" stroke={darkMode ? '#9a9a9a' : '#666'} angle={-45} textAnchor="end" height={80} />
                    <YAxis stroke={darkMode ? '#9a9a9a' : '#666'} />
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1c1c1c' : 'white',
                      border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#ededed' : '#0d0d0d',
                    }} />
                    <Legend wrapperStyle={{ color: darkMode ? '#9a9a9a' : '#666' }} />
                    <Bar dataKey="edits" fill="#1D9E75" />
                    <Bar dataKey="timeSpent" fill="#4facfe" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                {studentMembers.map(member => (
                  <div key={member.id} style={{
                    background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                    border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                    borderRadius: '12px',
                    padding: '16px',
                    backdropFilter: 'blur(10px)',
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>{member.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                      {(member.badges || []).map((b) => (
                        <span key={b.label} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${b.color}22`, color: b.color, fontWeight: 600 }}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 8 }}>Activity heatmap (7 days)</div>
                    <div style={{ display: 'flex', gap: 3, marginBottom: 12, alignItems: 'flex-end', height: 36 }}>
                      {(member.heatmap || [0, 0, 0, 0, 0, 0, 0]).map((v, i) => (
                        <div
                          key={i}
                          title={`Day ${i}: ${v}`}
                          style={{
                            flex: 1,
                            height: `${Math.max(8, (v / Math.max(1, ...(member.heatmap || [1]))) * 32)}px`,
                            background: `rgba(29, 158, 117, ${0.25 + (v / Math.max(1, ...(member.heatmap || [1]))) * 0.75})`,
                            borderRadius: 2,
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ display: 'grid', gap: '8px', fontSize: '13px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: darkMode ? '#9a9a9a' : '#666' }}>Edits</span>
                        <span style={{ fontWeight: '600', color: '#1D9E75' }}>{member.edits}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: darkMode ? '#9a9a9a' : '#666' }}>Time Spent</span>
                        <span style={{ fontWeight: '600', color: '#4facfe' }}>{formatDuration(member.timeSpent)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: darkMode ? '#9a9a9a' : '#666' }}>Task Completion</span>
                        <span style={{ fontWeight: '600', color: '#ffc107' }}>{member.taskCompletion}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
                marginTop: '24px',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Contribution Distribution</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={studentMembers}
                      dataKey="edits"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {studentMembers.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#1D9E75', '#4facfe', '#ffc107', '#e74c3c'][index % 4]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1c1c1c' : 'white',
                      border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#ededed' : '#0d0d0d',
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div style={{
                background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Activity Timeline</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={(studentMembers[0]?.contributions || [0,0,0,0,0,0]).map((val, idx) => ({
                    day: `Day ${idx + 1}`,
                    ...Object.fromEntries(studentMembers.map(m => [m.name, m.contributions[idx]]))
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#2e2e2e' : '#e0e0e0'} />
                    <XAxis dataKey="day" stroke={darkMode ? '#9a9a9a' : '#666'} />
                    <YAxis stroke={darkMode ? '#9a9a9a' : '#666'} />
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1c1c1c' : 'white',
                      border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#ededed' : '#0d0d0d',
                    }} />
                    <Legend wrapperStyle={{ color: darkMode ? '#9a9a9a' : '#666' }} />
                    {studentMembers.map((member, idx) => (
                      <Line key={member.id} type="monotone" dataKey={member.name} stroke={['#1D9E75', '#4facfe', '#ffc107', '#e74c3c'][idx % 4]} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{
                background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Fairness Scores</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={studentMembers}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#2e2e2e' : '#e0e0e0'} />
                    <XAxis dataKey="name" stroke={darkMode ? '#9a9a9a' : '#666'} angle={-45} textAnchor="end" height={80} />
                    <YAxis stroke={darkMode ? '#9a9a9a' : '#666'} domain={[0, 100]} />
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1c1c1c' : 'white',
                      border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#ededed' : '#0d0d0d',
                    }} />
                    <Bar dataKey="fairnessScore" fill="#1D9E75" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                {studentMembers.map(member => (
                  <div key={member.id} style={{
                    background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                    border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                    borderRadius: '12px',
                    padding: '20px',
                    backdropFilter: 'blur(10px)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <div style={{ fontWeight: '600' }}>{member.name}</div>
                      <div style={{
                        background: member.fairnessScore > 75 ? 'rgba(29, 158, 117, 0.2)' : member.fairnessScore > 50 ? 'rgba(255, 193, 7, 0.2)' : 'rgba(231, 76, 60, 0.2)',
                        color: member.fairnessScore > 75 ? '#1D9E75' : member.fairnessScore > 50 ? '#ffc107' : '#e74c3c',
                        padding: '4px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                      }}>
                        {member.fairnessScore}%
                      </div>
                    </div>

                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '12px', color: darkMode ? '#9a9a9a' : '#666', marginBottom: '4px' }}>Score Distribution</div>
                      <div style={{
                        width: '100%',
                        height: '8px',
                        background: darkMode ? '#121212' : '#f0f0f0',
                        borderRadius: '4px',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${member.fairnessScore}%`,
                          background: 'linear-gradient(90deg, #1D9E75 0%, #0F6E56 100%)',
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                    </div>

                    <div style={{
                      fontSize: '12px',
                      padding: '12px',
                      background: member.status === 'top-contributor' ? 'rgba(29, 158, 117, 0.1)' : member.status === 'low-contributor' ? 'rgba(231, 76, 60, 0.1)' : 'rgba(79, 172, 254, 0.1)',
                      borderRadius: '6px',
                      color: member.status === 'top-contributor' ? '#1D9E75' : member.status === 'low-contributor' ? '#e74c3c' : '#4facfe',
                      fontWeight: '500',
                    }}>
                      {member.status === 'top-contributor' && 'Excellent contributor - above average'}
                      {member.status === 'low-contributor' && 'Low contributor - needs engagement'}
                      {member.status === 'balanced' && 'Balanced contributor - good participation'}
                    </div>
                  </div>
                ))}
              </div>
              </>)}
              </>
              )}
            </div>
          )}

          {/* LECTURER — AI REPORT for the selected submission */}
          {activeTab === 'aiReport' && isLecturer && (
            <div>
              <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700' }}>AI Report</h1>
              {!lecturerToolsUnlocked || !effectiveLecturerSubmission ? (
                <div style={{ textAlign: 'center', padding: '80px 24px', color: darkMode ? '#9a9a9a' : '#888' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: darkMode ? '#9a9a9a' : '#888', marginBottom: 16, letterSpacing: '0.05em' }}>NO SUBMISSION SELECTED</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: darkMode ? '#ededed' : '#333' }}>Open a submission to review</div>
                  <div style={{ fontSize: 14 }}>Go to <strong>Submitted Work</strong> and select a student submission, then use AI Report, Analysis, and Grading.</div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
                    <p style={{ margin: 0, fontSize: 13, color: darkMode ? '#9a9a9a' : '#666' }}>
                      <strong style={{ color: darkMode ? '#ededed' : '#333' }}>{effectiveLecturerSubmission.fileName || effectiveLecturerSubmission.folderName || 'Submission'}</strong>
                      {' · '}Submitted by {effectiveLecturerSubmission.submittedByName || 'Student'}
                      {effectiveLecturerSubmission.submittedAt ? ` · ${formatDateTime(effectiveLecturerSubmission.submittedAt)}` : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setFileViewer({
                          name: effectiveLecturerSubmission.fileName || effectiveLecturerSubmission.folderName || 'Submission',
                          html: lecturerDocContent.html,
                          text: lecturerDocContent.text,
                        });
                      }}
                      style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid #1D9E75',
                        background: 'transparent', color: '#1D9E75', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      View submitted file
                    </button>
                  </div>
                  {(displayReports[0] || workspaceReports[0])
                    ? <ReportCard
                        report={displayReports[0] || workspaceReports[0]}
                        documentHtml={lecturerDocContent.html}
                        documentText={lecturerDocContent.text}
                        suggestedGradeOverride={gradeForReport(displayReports[0] || workspaceReports[0])}
                        darkMode={darkMode}
                      />
                    : <div style={{ textAlign: 'center', padding: 40, color: darkMode ? '#9a9a9a' : '#888' }}>No AI report available for this submission.</div>}
                </>
              )}
            </div>
          )}

          {/* STUDENT — MY REPORT (own submission only) */}
          {activeTab === 'aiReport' && !isLecturer && (
            <div>
              <h1 style={{ margin: '0 0 24px 0', fontSize: '28px', fontWeight: '700' }}>My Report</h1>
              {(() => {
                const myReport =
                  (selectedSubmission && submissionReports.find((r) => r.id === selectedSubmission.reportId)) ||
                  submissionReports.find((r) => r.userId === currentUser?.uid) ||
                  submissionReports[0] ||
                  null;
                if (!myReport) return null; // handled below
                // The student's FINAL grade (what the lecturer assigned) + any override reason,
                // so they see their actual mark and the justification — not just the AI suggestion.
                const myGradeRecord = gradeOverrides.__records?.[currentUser?.uid];
                const myFinal = gradeOverrides[currentUser?.uid];
                return (
                  <>
                    {myFinal !== undefined && (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
                        background: darkMode ? 'rgba(29,158,117,0.12)' : 'rgba(29,158,117,0.08)',
                        border: `1px solid ${darkMode ? 'rgba(29,158,117,0.4)' : 'rgba(29,158,117,0.3)'}`,
                        borderRadius: 12, padding: '16px 20px', marginBottom: 20,
                      }}>
                        <div>
                          <div style={{ fontSize: 12, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 4 }}>Your Grade (final, set by lecturer)</div>
                          {myGradeRecord?.overrideReason && (
                            <div style={{ fontSize: 12, fontStyle: 'italic', color: darkMode ? '#bdbdbd' : '#555' }}>
                              Lecturer’s note: “{myGradeRecord.overrideReason}”
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 32, fontWeight: 800, color: myFinal > 8 ? '#1D9E75' : myFinal > 6 ? '#e0a800' : '#e74c3c' }}>
                          {myFinal}/10
                        </div>
                      </div>
                    )}
                    <ReportCard report={myReport} documentHtml={myReport.documentContent?.html || ''} suggestedGradeOverride={gradeForReport(myReport)} darkMode={darkMode} />
                  </>
                );
              })()}
              {(() => {
                const myReport =
                  (selectedSubmission && submissionReports.find((r) => r.id === selectedSubmission.reportId)) ||
                  submissionReports.find((r) => r.userId === currentUser?.uid) ||
                  submissionReports[0] ||
                  null;
                return myReport ? null : (
                  <div style={{ textAlign: 'center', padding: '80px 24px', color: darkMode ? '#9a9a9a' : '#888' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: darkMode ? '#ededed' : '#333' }}>No report yet</div>
                    <div style={{ fontSize: 14 }}>Submit a file from your workspace to generate your AI report.</div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* GRADING PANEL — lecturer only */}
          {activeTab === 'grading' && isLecturer && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>Automated Grading Suggestions</h1>
              {isLecturer && !lecturerToolsUnlocked ? (
                <div style={{ textAlign: 'center', padding: '80px 24px', color: darkMode ? '#9a9a9a' : '#888' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: darkMode ? '#9a9a9a' : '#888', marginBottom: 16, letterSpacing: '0.05em' }}>LOCKED</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: darkMode ? '#ededed' : '#333' }}>No submissions yet</div>
                  <div style={{ fontSize: 14 }}>Grade suggestions will appear here once students submit their work.</div>
                </div>
              ) : (
              <>
              <div style={{
                background: 'rgba(255, 193, 7, 0.1)',
                border: '1px solid rgba(255, 193, 7, 0.3)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px',
              }}>
                <div style={{ fontSize: '13px', color: darkMode ? '#ffc107' : '#d4a80a' }}>
                  <strong>Fair, neutral grading:</strong> writing quality (grammar · clarity · structure · content)
                  adjusted by conservative behavioural penalties. AI detection is a signal only — no cheating
                  accusations. Locked submissions are frozen snapshots; your override is final.
                </div>
              </div>

              {/* Lecturer-configurable expected active-writing time. Drives the low-effort
                  time threshold; persisted to the workspace and applied to all grades live. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                background: darkMode ? 'rgba(28,28,28,0.6)' : 'rgba(255,255,255,0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: 12, padding: '14px 18px', marginBottom: 20,
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? '#ededed' : '#222' }}>
                  Expected active-writing time
                </span>
                <input
                  type="number" min="1" max="600" value={timeCapInput}
                  onChange={(e) => setTimeCapInput(e.target.value)}
                  style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fff', color: darkMode ? '#ededed' : '#111', fontSize: 13 }}
                />
                <span style={{ fontSize: 12, color: darkMode ? '#9a9a9a' : '#666' }}>minutes (students reaching this get full time marks)</span>
                <button
                  type="button"
                  disabled={savingTimeCap}
                  onClick={async () => {
                    const v = Math.max(1, Math.min(600, parseInt(timeCapInput, 10) || 60));
                    setSavingTimeCap(true);
                    try {
                      await updateWorkspace(activeGroupId, { timeCapMinutes: v });
                      pushToast?.(`Expected time set to ${v} min`);
                    } catch { pushToast?.('Could not save time setting'); }
                    finally { setSavingTimeCap(false); }
                  }}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: savingTimeCap ? '#9aa0a6' : 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: savingTimeCap ? 'not-allowed' : 'pointer' }}
                >
                  {savingTimeCap ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div style={{ display: 'grid', gap: '16px' }}>
                {studentMembers.map(member => {
                  const grade = behaviorGradeFor(member);
                  const suggestedGradeVal = grade.recommendedScore;
                  const displayGrade = getDisplayGrade(member);
                  const hasOverride = gradeOverrides[member.id] !== undefined;
                  const isEditing = editingGradeId === member.id;
                  const isExpanded = expandedGradeId === member.id;

                  return (
                    <div key={member.id} style={{
                      background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                      border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                      borderRadius: '12px',
                      padding: '20px',
                      backdropFilter: 'blur(10px)',
                      transition: 'border-color 0.2s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: '600', marginBottom: '12px', fontSize: '15px' }}>{member.name}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', fontSize: '13px' }}>
                            <div>
                              <span style={{ color: darkMode ? '#9a9a9a' : '#666', display: 'block', marginBottom: '4px' }}>Writing base</span>
                              <span style={{ fontWeight: '600', color: '#1D9E75', fontSize: '14px' }}>{grade.baseScore}/10</span>
                            </div>
                            <div>
                              <span style={{ color: darkMode ? '#9a9a9a' : '#666', display: 'block', marginBottom: '4px' }}>Penalties</span>
                              <span style={{ fontWeight: '600', color: '#e74c3c', fontSize: '14px' }}>
                                −{grade.penalties.time + grade.penalties.edits + grade.penalties.paste + grade.penalties.ai}
                              </span>
                            </div>
                            <div>
                              <span style={{ color: darkMode ? '#9a9a9a' : '#666', display: 'block', marginBottom: '4px' }}>Flags</span>
                              <span style={{ fontWeight: '600', color: grade.flags.length ? '#ffc107' : '#1D9E75', fontSize: '14px' }}>
                                {grade.flags.length ? grade.flags.length : 'None'}
                              </span>
                            </div>
                          </div>
                          {grade.flags.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                              {grade.flags.map((fl) => (
                                <span key={fl} style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: fl === 'High Paste Usage' ? '#daa520' : fl === 'Possible AI Assistance' ? '#dc143c' : '#e67e22', borderRadius: 4, padding: '2px 6px' }}>
                                  {fl}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', color: darkMode ? '#9a9a9a' : '#666', marginBottom: '4px' }}>
                              {hasOverride ? 'Final Grade (overridden)' : 'AI Suggested Grade'}
                            </div>
                            {!hasOverride && (
                              <div style={{ fontSize: 10, color: darkMode ? '#9a9a9a' : '#999', marginBottom: 6 }}>
                                AI suggests {suggestedGradeVal}/10
                              </div>
                            )}
                            {isEditing ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <input
                                    type="number"
                                    min={0}
                                    max={10}
                                    value={overrideInput}
                                    onChange={(e) => setOverrideInput(e.target.value)}
                                    style={{
                                      width: 56,
                                      padding: '8px',
                                      borderRadius: 6,
                                      border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                                      background: darkMode ? '#121212' : '#fff',
                                      color: darkMode ? '#ededed' : '#0d0d0d',
                                      fontSize: 16,
                                      fontWeight: 700,
                                    }}
                                  />
                                  <span style={{ fontSize: 14 }}>/10</span>
                                </div>
                                {/* Reason required only when the entered grade differs from the AI suggestion. */}
                                {Number(overrideInput) !== Number(suggestedGradeVal) && (
                                  <textarea
                                    value={overrideReasonInput}
                                    onChange={(e) => setOverrideReasonInput(e.target.value)}
                                    placeholder={`Reason for changing from AI's ${suggestedGradeVal}/10 (required)`}
                                    rows={2}
                                    style={{
                                      width: 240,
                                      padding: '8px',
                                      borderRadius: 6,
                                      border: `1px solid ${overrideReasonInput.trim() ? (darkMode ? '#2e2e2e' : '#ddd') : '#e74c3c'}`,
                                      background: darkMode ? '#121212' : '#fff',
                                      color: darkMode ? '#ededed' : '#0d0d0d',
                                      fontSize: 12,
                                      resize: 'vertical',
                                    }}
                                  />
                                )}
                              </div>
                            ) : (
                              <div style={{
                                fontSize: '28px',
                                fontWeight: '700',
                                color: displayGrade > 8 ? '#1D9E75' : displayGrade > 6 ? '#ffc107' : '#e74c3c',
                                background: hasOverride
                                  ? darkMode ? 'rgba(79, 172, 254, 0.2)' : 'rgba(79, 172, 254, 0.12)'
                                  : darkMode ? 'rgba(29, 158, 117, 0.2)' : 'rgba(29, 158, 117, 0.1)',
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: hasOverride ? '1px solid #4facfe' : 'none',
                              }}>
                                {displayGrade}/10
                              </div>
                            )}
                          </div>
                          {/* Show the lecturer's justification for any override (accountability trail). */}
                          {!isEditing && hasOverride && gradeOverrides.__records?.[member.id]?.overrideReason && (
                            <div style={{
                              maxWidth: 260,
                              textAlign: 'right',
                              fontSize: 11,
                              fontStyle: 'italic',
                              color: darkMode ? '#9a9a9a' : '#666',
                              borderRight: '2px solid #4facfe',
                              paddingRight: 8,
                            }}>
                              “{gradeOverrides.__records[member.id].overrideReason}”
                              <div style={{ fontStyle: 'normal', fontSize: 10, marginTop: 2 }}>
                                — AI suggested {gradeOverrides.__records[member.id].suggestedGrade}/10
                              </div>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => setExpandedGradeId(isExpanded ? null : member.id)}
                              style={{ background: 'transparent', color: darkMode ? '#4facfe' : '#1a6fb5', border: `1px solid ${darkMode ? '#4facfe' : '#1a6fb5'}`, padding: '8px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                            >
                              {isExpanded ? 'Hide explanation' : 'Why this grade?'}
                            </button>
                            {isEditing ? (
                              <>
                                <button type="button" onClick={() => saveGradeOverrideHandler(member.id)} style={{ background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Save</button>
                                <button type="button" onClick={() => { setEditingGradeId(null); setOverrideInput(''); setOverrideReasonInput(''); }} style={{ background: 'transparent', color: darkMode ? '#9a9a9a' : '#666', border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={() => startGradeOverride(member)} style={{ background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>{hasOverride ? 'Edit Override' : 'Override Grade'}</button>
                                {hasOverride && (
                                  <button type="button" onClick={() => clearGradeOverrideHandler(member.id)} style={{ background: 'transparent', color: '#e74c3c', border: '1px solid #e74c3c', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Reset</button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Behavioural grade breakdown */}
                      {isExpanded && (
                        <div style={{
                          marginTop: 16,
                          paddingTop: 16,
                          borderTop: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: darkMode ? '#ededed' : '#222' }}>
                            Writing quality (base {grade.baseScore}/10)
                          </div>
                          <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                            {[
                              { label: 'Grammar', value: grade.scores.grammar },
                              { label: 'Clarity', value: grade.scores.clarity },
                              { label: 'Structure', value: grade.scores.structure },
                              { label: 'Content', value: grade.scores.content },
                            ].map(f => (
                              <div key={f.label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 56px', gap: 8, alignItems: 'center', fontSize: 12 }}>
                                <span style={{ color: darkMode ? '#d4d4d4' : '#444' }}>{f.label}</span>
                                <div style={{ background: darkMode ? '#222' : '#eef', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.min(100, f.value * 10)}%`, height: '100%', background: f.value >= 7 ? '#1D9E75' : f.value >= 4 ? '#ffc107' : '#e74c3c', borderRadius: 4, transition: 'width 0.4s' }} />
                                </div>
                                <span style={{ color: '#1D9E75', fontWeight: 600 }}>{f.value}/10</span>
                              </div>
                            ))}
                          </div>

                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: darkMode ? '#ededed' : '#222' }}>
                            Behaviour signals
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14, fontSize: 12, color: darkMode ? '#9a9a9a' : '#666' }}>
                            <span>Time spent: <strong style={{ color: darkMode ? '#ededed' : '#222' }}>{formatSecondsExact(grade.behaviorSummary.timeSpentSeconds)}</strong> ({grade.behaviorSummary.effort} effort)</span>
                            <span>Edits: <strong style={{ color: darkMode ? '#ededed' : '#222' }}>{grade.behaviorSummary.editCount}</strong></span>
                            <span>Paste usage: <strong style={{ color: darkMode ? '#ededed' : '#222' }}>{grade.behaviorSummary.pastePercentage}%</strong></span>
                            <span>AI likelihood: <strong style={{ color: darkMode ? '#ededed' : '#222' }}>{Math.round(grade.behaviorSummary.aiProbability * 100)}%</strong> ({grade.behaviorSummary.aiLevel})</span>
                          </div>

                          {(grade.penalties.time || grade.penalties.edits || grade.penalties.paste || grade.penalties.ai) ? (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                              {grade.penalties.time > 0 && <PenaltyChip label={`−${grade.penalties.time} low time`} />}
                              {grade.penalties.edits > 0 && <PenaltyChip label={`−${grade.penalties.edits} few edits`} />}
                              {grade.penalties.paste > 0 && <PenaltyChip label={`−${grade.penalties.paste} high paste`} />}
                              {grade.penalties.ai > 0 && <PenaltyChip label={`−${grade.penalties.ai} possible AI`} />}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: darkMode ? '#9a9a9a' : '#666', marginBottom: 12 }}>No behavioural penalties applied.</div>
                          )}

                          <div style={{
                            padding: '10px 14px', borderRadius: 8,
                            background: darkMode ? 'rgba(29, 158, 117, 0.1)' : 'rgba(29, 158, 117, 0.06)',
                            border: `1px solid ${darkMode ? 'rgba(29,158,117,0.3)' : 'rgba(29,158,117,0.2)'}`,
                            fontSize: 12, marginBottom: 10,
                          }}>
                            <span style={{ color: darkMode ? '#9a9a9a' : '#666' }}>Final: base {grade.baseScore} − {grade.penalties.time + grade.penalties.edits + grade.penalties.paste + grade.penalties.ai} = </span>
                            <span style={{ fontWeight: 700, color: '#1D9E75' }}>{grade.recommendedScore}/10</span>
                          </div>

                          <p style={{ margin: 0, fontSize: 12, color: darkMode ? '#9a9a9a' : '#666', lineHeight: 1.6 }}>
                            {grade.lecturerNote}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              </>
              )}
            </div>
          )}

          {/* EDITOR — open file */}
          {activeTab === 'editor' && openFile && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '8px 16px', background: darkMode ? 'rgba(18, 18, 18,0.8)' : '#fff', borderBottom: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" onClick={() => setActiveTab('drive')}
                  style={{ background: 'none', border: 'none', color: '#1D9E75', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 8px', borderRadius: 6 }}>
                  ← Back to Files
                </button>
                <span style={{ color: darkMode ? '#9a9a9a' : '#999', fontSize: 12 }}>›</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? '#ededed' : '#222' }}>{openFile.name}</span>
              </div>
              <WorkspacePanel
                darkMode={darkMode}
                currentUser={currentUser}
                groupId={activeGroupId}
                groupMembers={groupMembers}
                pushToast={pushToast}
                pushActivity={pushActivity}
                deadline={groupMeta?.deadline || null}
                createdDate={groupMeta?.createdDate || null}
                submissions={submissionReports}
                workspaceSubmissions={workspaceSubmissions}
                lecturerIds={groupMeta?.lecturerIds || []}
                initialFile={openFile}
                inlineEditor={true}
                onEditorClose={() => { setOpenFile(null); setActiveTab('drive'); }}
              />
            </div>
          )}

          {/* DRIVE — always mounted while a workspace is active; hidden via CSS when on another tab
               so subscriptions stay live and files don't disappear after editor close */}
          {activeWorkspaceId && (
            <div style={{ flex: 1, minHeight: 0, flexDirection: 'column',
              display: activeTab === 'drive' ? 'flex' : 'none' }}>
              <WorkspaceDrive
                workspaceId={activeWorkspaceId}
                workspace={groupMeta}
                darkMode={darkMode}
                currentUser={currentUser}
                pushToast={pushToast}
                pushActivity={pushActivity}
                onOpenFile={(file) => { setOpenFile(file); setActiveTab('editor'); }}
                onDelete={() => { setActiveWorkspaceId(null); setGroupMeta(null); setActiveTab('projects'); }}
              />
            </div>
          )}

          {/* WORKSPACES — drive-style list */}
          {activeTab === 'projects' && (
            <div style={{ padding: 32, overflow: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 700 }}>My Workspaces</h1>
                  <p style={{ margin: 0, fontSize: 13, color: darkMode ? '#9a9a9a' : '#666' }}>
                    {isLecturer ? 'Manage your workspaces, invite students, and review submissions.' : 'Your collaborative workspaces. Click a workspace to open its files.'}
                  </p>
                </div>
                <button type="button" onClick={createGroup} disabled={groupCreateLoading}
                  style={{ background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: groupCreateLoading ? 'wait' : 'pointer' }}>
                  {groupCreateLoading ? 'Creating…' : '+ New Workspace'}
                </button>
              </div>

              {/* Create workspace form */}
              <div style={{ background: darkMode ? 'rgba(28, 28, 28,0.6)' : '#fff', border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`, borderRadius: 14, padding: 20, marginBottom: 28, backdropFilter: 'blur(10px)' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: darkMode ? '#ededed' : '#222' }}>Create a new Workspace</h3>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <input value={groupCreateName} onChange={e => setGroupCreateName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createGroup()}
                    placeholder="Workspace name"
                    style={{ flex: 2, minWidth: 180, padding: '10px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111', fontSize: 13 }} />
                  <input type="datetime-local" value={groupCreateDeadline} onChange={e => setGroupCreateDeadline(e.target.value)}
                    style={{ flex: 1, minWidth: 160, padding: '10px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111', fontSize: 13 }} />
                  <button type="button" onClick={createGroup} disabled={groupCreateLoading}
                    style={{ background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: groupCreateLoading ? 'not-allowed' : 'pointer' }}>
                    Create
                  </button>
                </div>
              </div>

              {/* Workspace grid */}
              {availableGroups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 24px', color: darkMode ? '#9a9a9a' : '#888' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: darkMode ? '#9a9a9a' : '#888', marginBottom: 16 }}>No workspaces</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: darkMode ? '#ededed' : '#333', marginBottom: 8 }}>No workspaces yet</div>
                  <div style={{ fontSize: 14 }}>{isLecturer ? 'Create your first workspace above.' : 'Create a workspace above, or wait until a teammate invites you by email.'}</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                  {availableGroups.map(ws => {
                    const isActive = activeWorkspaceId === ws.id;
                    return (
                      <div key={ws.id}
                        onClick={() => openWorkspace(ws)}
                        onContextMenu={(e) => { e.preventDefault(); setWsContextMenu({ x: e.clientX, y: e.clientY, ws }); }}
                        onMouseEnter={() => setHoveredWsId(ws.id)}
                        onMouseLeave={() => setHoveredWsId((id) => (id === ws.id ? null : id))}
                        style={{
                          position: 'relative',
                          background: darkMode ? 'rgba(28, 28, 28,0.7)' : '#fff',
                          border: `2px solid ${isActive ? '#1D9E75' : (darkMode ? '#2e2e2e' : '#e0e0e0')}`,
                          borderRadius: 14, padding: 20, cursor: 'pointer',
                          transition: 'all 0.15s',
                          boxShadow: isActive ? '0 0 0 3px rgba(29,158,117,0.15)' : 'none',
                        }}>
                        {/* Hover trash — delete this workspace (with confirm) */}
                        {hoveredWsId === ws.id && (
                          <button
                            type="button"
                            title="Delete workspace"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteWs(ws); }}
                            className="pl-fade-in"
                            style={{
                              position: 'absolute', top: 10, right: 10, width: 28, height: 28,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              borderRadius: 7, border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                              background: darkMode ? '#161616' : '#fff', color: '#e74c3c', cursor: 'pointer', fontSize: 14,
                            }}
                          >
                            🗑
                          </button>
                        )}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                          <WorkspaceIcon name={ws.name} id={ws.id} />
                          {isActive && <span style={{ fontSize: 10, fontWeight: 700, color: '#1D9E75', background: 'rgba(29,158,117,0.12)', padding: '3px 8px', borderRadius: 6 }}>Active</span>}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: darkMode ? '#ededed' : '#1a1a1a', marginBottom: 4 }}>{ws.name}</div>
                        <div style={{ fontSize: 12, color: darkMode ? '#9a9a9a' : '#777', lineHeight: 1.5 }}>
                          {ws.memberIds?.length || 0} members · {ws.deadline ? `Due ${formatDate(ws.deadline)}` : 'No deadline'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STUDENT REPORTS — lecturer overview grouped by class/section */}
          {activeTab === 'reports' && isLecturer && (
            <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: darkMode ? '#9a9a9a' : '#666' }}>Loading reports…</div>}>
              <ReportsPanel
                submissions={sortedSubmissions}
                groups={availableGroups.filter((g) => (g.lecturerIds || []).includes(currentUser?.uid))}
                darkMode={darkMode}
              />
            </Suspense>
          )}

          {/* SUBMISSIONS */}
          {activeTab === 'storage' && (
            <StoragePanel
              submissions={sortedSubmissions}
              workspaces={availableGroups}
              isLecturer={isLecturer}
              darkMode={darkMode}
              selectedSubmission={selectedSubmission}
              onSelectSubmission={(sub, isSelected) => {
                setSelectedSubmission(isSelected ? null : sub);
                if (!isSelected) {
                  setActiveWorkspaceId(sub.workspaceId);
                  setSelectedGroup(sub.workspaceId);
                  // Lecturer: open the AI Report review screen for this submission.
                  if (isLecturer) {
                    setActiveTab('aiReport');
                  }
                }
              }}
              onOpenReport={(sub) => {
                setSelectedSubmission(sub);
                setActiveWorkspaceId(sub.workspaceId);
                setSelectedGroup(sub.workspaceId);
                setActiveTab('aiReport');
              }}
              onMarkReviewed={async (sub) => {
                await updateSubmissionStatus(sub.id, 'reviewed');
                setSelectedSubmission(sub);
                pushToast('Marked as reviewed');
              }}
              onDelete={async (sub) => {
                try {
                  await deleteSubmission(sub.id);
                  if (selectedSubmission?.id === sub.id) setSelectedSubmission(null);
                  pushToast('Submission deleted');
                } catch (err) {
                  pushToast(err.message || 'Could not delete submission');
                }
              }}
              pushToast={pushToast}
            />
          )}

          {/* CALENDAR */}
          {activeTab === 'calendar' && (
            <CalendarPanel
              workspaces={availableGroups}
              darkMode={darkMode}
              isLecturer={isLecturer}
              onOpenWorkspace={(w) => {
                setActiveWorkspaceId(w.id);
                setSelectedGroup(w.id);
                setActiveTab('drive');
              }}
            />
          )}

          {/* ← LEGACY GROUPS view (unreachable — no sidebar item) */}
          {activeTab === 'groups' && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>My Workspaces</h1>
              <div style={{
                background: darkMode ? 'rgba(28, 28, 28, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
              }}>
                <div style={{ display: 'grid', gap: 24 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                      <div>
                        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>Project Workspaces</h2>
                        <p style={{ margin: '8px 0 0', color: darkMode ? '#9a9a9a' : '#666', fontSize: '13px', maxWidth: 620 }}>
                          {isLecturer
                            ? 'Manage your invited groups, inspect student submissions, and approve grades after submission.'
                            : 'Create your project workspace or wait for a lecturer invite. Students begin with an empty workspace until a group is created.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={createGroup}
                        style={{
                          background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                          color: 'white',
                          border: 'none',
                          padding: '10px 18px',
                          borderRadius: '8px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          minWidth: 150,
                        }}
                      >
                        {groupCreateLoading ? 'Creating…' : '+ Create project'}
                      </button>
                    </div>

                    {!availableGroups.length ? (
                      <div style={{
                        padding: 24,
                        borderRadius: 12,
                        border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
                        background: darkMode ? '#1a1a1a' : '#fafafa',
                        color: darkMode ? '#d4d4d4' : '#333',
                      }}>
                        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
                          {isLecturer
                            ? 'No groups yet. Create the first project and invite students to join.'
                            : 'You are not currently assigned to a project. Once a lecturer invites you, your workspace will appear here.'}
                        </p>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: 12 }}>
                        {availableGroups.map((group) => (
                          <div key={group.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '18px',
                            borderRadius: '12px',
                            background: darkMode ? 'rgba(29, 158, 117, 0.08)' : 'rgba(29, 158, 117, 0.04)',
                            border: `1px solid ${darkMode ? 'rgba(29, 158, 117, 0.2)' : 'rgba(29, 158, 117, 0.12)'}`,
                          }}>
                            <div>
                              <div style={{ fontWeight: '700', fontSize: 15, color: darkMode ? '#ededed' : '#1a1a1a' }}>{group.name}</div>
                              <div style={{ fontSize: 12, color: darkMode ? '#9a9a9a' : '#666', marginTop: 6 }}>
                                {group.memberIds?.length || 0} members • Due {group.deadline ? formatDate(group.deadline) : 'Not set'}
                              </div>
                            </div>
                            {isLecturer && (
                              <button
                                type="button"
                                onClick={() => setSelectedGroup(group.id)}
                                style={{
                                  background: selectedGroup === group.id ? '#4facfe' : '#1D9E75',
                                  color: '#fff',
                                  border: 'none',
                                  padding: '8px 14px',
                                  borderRadius: 8,
                                  cursor: 'pointer',
                                }}
                              >
                                {selectedGroup === group.id ? 'Selected' : 'Select'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{
                    padding: 20,
                    borderRadius: 12,
                    border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                    background: darkMode ? 'rgba(18, 18, 18, 0.6)' : '#fff',
                  }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: darkMode ? '#ededed' : '#222' }}>Create a new project</h3>
                    <p style={{ margin: '10px 0 18px', color: darkMode ? '#9a9a9a' : '#666', fontSize: 13 }}>
                      Projects must be created before students can submit. Add an optional due date to enable deadline analytics.
                    </p>
                    <div style={{ display: 'grid', gap: 14 }}>
                      <label style={{ fontSize: 13, color: darkMode ? '#d4d4d4' : '#444' }}>
                        Project name
                        <input
                          value={groupCreateName}
                          onChange={(e) => setGroupCreateName(e.target.value)}
                          placeholder="Project collaboration workspace"
                          style={{ width: '100%', marginTop: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111' }}
                        />
                      </label>
                      <label style={{ fontSize: 13, color: darkMode ? '#d4d4d4' : '#444' }}>
                        Deadline (optional)
                        <input
                          type="date"
                          value={groupCreateDeadline}
                          onChange={(e) => setGroupCreateDeadline(e.target.value)}
                          style={{ width: '100%', marginTop: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#fafafa', color: darkMode ? '#ededed' : '#111' }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={createGroup}
                        disabled={groupCreateLoading}
                        style={{
                          background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                          color: '#fff',
                          border: 'none',
                          padding: '12px 16px',
                          borderRadius: 10,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: groupCreateLoading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {groupCreateLoading ? 'Creating project…' : 'Create project'}
                      </button>
                    </div>
                  </div>

                  {activeGroupId && (
                    <div style={{
                      padding: 20,
                      borderRadius: 12,
                      border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
                      background: darkMode ? 'rgba(18, 18, 18, 0.6)' : '#fff',
                    }}>
                      <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: darkMode ? '#ededed' : '#222' }}>Member Management</h3>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="member@university.edu"
                          style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#f9f9f9', color: darkMode ? '#ededed' : '#0d0d0d' }}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!inviteEmail.trim() || !activeGroupId) return;
                            try {
                              const invited = await inviteMemberByEmail(activeGroupId, inviteEmail, {
                                invitedByName: currentUser.name,
                                invitedByUid: currentUser.uid,
                                workspaceName: groupMeta?.name,
                              });
                              setInviteEmail('');
                              pushToast(`${currentUser.name} invited ${invited.name} — they were notified`);
                              pushActivity(currentUser.name, `invited ${invited.name} to the workspace`);
                            } catch (err) {
                              pushToast(err.message || 'Invite failed');
                            }
                          }}
                          style={{ background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer' }}
                        >
                          Invite Member
                        </button>
                      </div>
                      <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: darkMode ? '#ededed' : '#222' }}>Add Lecturer (by email)</h3>
                      <p style={{ margin: '0 0 12px', fontSize: 12, color: darkMode ? '#9a9a9a' : '#666' }}>
                        Lecturer must already have a Lecturer account from signup.
                      </p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          type="email"
                          value={lecturerEmail}
                          onChange={(e) => setLecturerEmail(e.target.value)}
                          placeholder="lecturer@university.edu"
                          style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`, background: darkMode ? '#121212' : '#f9f9f9', color: darkMode ? '#ededed' : '#0d0d0d' }}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!lecturerEmail.trim() || !activeGroupId) return;
                            try {
                              const invited = await inviteLecturerByEmail(activeGroupId, lecturerEmail, {
                                invitedByName: currentUser.name,
                                invitedByUid: currentUser.uid,
                                workspaceName: groupMeta?.name,
                              });
                              setLecturerEmail('');
                              pushToast(`${currentUser.name} invited lecturer ${invited.name}`);
                              pushActivity(currentUser.name, `invited lecturer ${invited.name}`);
                            } catch (err) {
                              pushToast(err.message || 'Lecturer invite failed');
                            }
                          }}
                          style={{ background: '#4facfe', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer' }}
                        >
                          Invite Lecturer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {showProfilePanel && (
        <ProfilePanel
          user={currentUser}
          onSave={handleProfileSave}
          onClose={() => setShowProfilePanel(false)}
          saving={profileSaving}
          darkMode={darkMode}
        />
      )}
      
      <Toast toasts={toasts} darkMode={darkMode} />
    </div>
   </Suspense>
  );
};

export default PeerlyticsDashboard;
