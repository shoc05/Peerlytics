const fs = require('fs');
const p = 'src/components/peerlytics-app.jsx';
let c = fs.readFileSync(p, 'utf8');

// Remove orphaned login UI block (between if (!currentUser) and real dashboard return)
const orphanStart = c.indexOf('  if (!currentUser) return null;\r\n\r\n  return (\r\n      <motionWrap');
const orphanStart2 = c.indexOf('  if (!currentUser) return null;\r\n\r\n  return (\r\n      <div style={{\r\n        minHeight: \'100vh\',\r\n        background: darkMode ? \'linear-gradient');
if (orphanStart2 >= 0) {
  const realReturn = c.indexOf('\r\n  return (\r\n    <div style={{\r\n      background: darkMode ? \'#0a0e27\'', orphanStart2);
  if (realReturn > orphanStart2) {
    c = c.slice(0, orphanStart2) + '  if (!currentUser) return null;\r\n' + c.slice(realReturn);
    console.log('removed orphan login UI');
  }
}

const oldHead = `const PeerlyticsDashboard = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [darkMode, setDarkMode] = useState(true);
  const [gradeOverrides, setGradeOverrides] = useState({});
  const [editingGradeId, setEditingGradeId] = useState(null);
  const [overrideInput, setOverrideInput] = useState('');
  const [language, setLanguage] = useState('en');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedGroup, setSelectedGroup] = useState('CS101-Group1');
  const [showLoginForm, setShowLoginForm] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [activityLog, setActivityLog] = useState(ACTIVITY_SEED);
  const [toasts, setToasts] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [extraMembers, setExtraMembers] = useState([]);
  const [submissionReports, setSubmissionReports] = useState([]);

  const loadSubmissionReports = useCallback(() => {
    try {
      setSubmissionReports(JSON.parse(localStorage.getItem('peerlytics_reports') || '[]'));
    } catch {
      setSubmissionReports([]);
    }
  }, []);

  useEffect(() => {
    loadSubmissionReports();
    window.addEventListener('peerlytics:report-saved', loadSubmissionReports);
    return () => window.removeEventListener('peerlytics:report-saved', loadSubmissionReports);
  }, [loadSubmissionReports]);`;

const newHead = `const PeerlyticsDashboard = () => {
  const navigate = useNavigate();
  const { user: currentUser, isLecturer } = useAuth();
  const [darkMode, setDarkMode] = useState(true);
  const [gradeOverrides, setGradeOverrides] = useState({});
  const [editingGradeId, setEditingGradeId] = useState(null);
  const [overrideInput, setOverrideInput] = useState('');
  const [language, setLanguage] = useState('en');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedGroup, setSelectedGroup] = useState(DEFAULT_GROUP_ID);
  const [offlineMode, setOfflineMode] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [submissionReports, setSubmissionReports] = useState([]);
  const [groupMeta, setGroupMeta] = useState(null);
  const [rawMembers, setRawMembers] = useState([]);

  const activeGroupId = isLecturer ? selectedGroup : (currentUser?.groupId || DEFAULT_GROUP_ID);

  useEffect(() => {
    ensureDefaultGroup().catch(() => {});
  }, []);

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
    return () => {
      unsubGroup();
      unsubMembers();
      unsubActivity();
      unsubReports();
      unsubGrades();
    };
  }, [activeGroupId]);`;

if (c.includes(oldHead)) {
  c = c.replace(oldHead, newHead);
  console.log('replaced head');
} else console.warn('head not found');

c = c.replace(
  `  const pushActivity = useCallback((user, action) => {
    setActivityLog((log) => [createActivityEntry(user, action), ...log.slice(0, 11)]);
  }, []);`,
  `  const pushActivity = useCallback(
    (userName, action) => {
      if (activeGroupId) addActivity(activeGroupId, { user: userName, action }).catch(() => {});
      setActivityLog((log) => [createActivityEntry(userName, action), ...log.slice(0, 11)]);
    },
    [activeGroupId]
  );`
);

c = c.replace(
  `  const currentGroup = mockGroups[selectedGroup];
  const allMembers = useMemo(() => [...currentGroup.members, ...extraMembers], [currentGroup.members, extraMembers]);`,
  `  const currentGroup = groupMeta || { name: 'Loading group…', members: [], createdDate: '—', deadline: '—' };
  const allMembers = useMemo(() => rawMembers, [rawMembers]);`
);

c = c.replace(
  `    fairnessScore: calculateFairnessScore(m, currentGroup.members),
    status: detectFreeRider(m, currentGroup.members),`,
  `    fairnessScore: calculateFairnessScore(m, allMembers.length ? allMembers : [m]),
    status: detectFreeRider(m, allMembers.length ? allMembers : [m]),`
);

c = c.replace(
  `  const saveGradeOverride = (memberId) => {
    const parsed = parseInt(overrideInput, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 10) {
      setGradeOverrides((prev) => ({ ...prev, [memberId]: parsed }));
      pushToast('Grade override saved');
    }
    setEditingGradeId(null);
    setOverrideInput('');
  };

  const clearGradeOverride = (memberId) => {
    setGradeOverrides((prev) => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
    setEditingGradeId(null);
    pushToast('Override cleared — using AI suggestion');
  };`,
  `  const saveGradeOverrideHandler = async (memberId) => {
    const parsed = parseInt(overrideInput, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 10 && activeGroupId) {
      await saveGradeOverride(activeGroupId, memberId, parsed);
      pushToast('Grade override saved');
    }
    setEditingGradeId(null);
    setOverrideInput('');
  };

  const clearGradeOverrideHandler = async (memberId) => {
    if (activeGroupId) await clearGradeOverride(activeGroupId, memberId);
    setEditingGradeId(null);
    pushToast('Override cleared — using AI suggestion');
  };`
);

c = c.replace(/onClick=\{\(\) => saveGradeOverride\(/g, 'onClick={() => saveGradeOverrideHandler(');
c = c.replace(/onClick=\{\(\) => clearGradeOverride\(/g, 'onClick={() => clearGradeOverrideHandler(');

c = c.replace(
  `onClick={() => { setCurrentUser(null); setShowLoginForm(true); }}`,
  `onClick={async () => { await logOut(); navigate('/login'); }}`
);

c = c.replace(
  `<LineChart data={groupMembers[0].contributions.map((val, idx) => ({`,
  `<LineChart data={(groupMembers[0]?.contributions || [0, 0, 0, 0, 0, 0]).map((val, idx) => ({`
);

if (!c.includes('groupId={activeGroupId}')) {
  c = c.replace(
    `            <WorkspacePanel
              darkMode={darkMode}
              currentUser={currentUser}
              groupMembers={groupMembers}`,
    `            <WorkspacePanel
              darkMode={darkMode}
              currentUser={currentUser}
              groupId={activeGroupId}
              groupMembers={groupMembers}`
  );
}

c = c.replace(
  `onClick={() => { if (!inviteEmail.trim()) return; const name = inviteEmail.split('@')[0]; setExtraMembers((p) => [...p, { id: Date.now(), name, role: 'Member', edits: 0, timeSpent: 0, taskCompletion: 0, difficulty: 1, contributions: [0,0,0,0,0,0] }]); setInviteEmail(''); pushToast('Member added'); pushActivity('System', 'invited ' + name); }}`,
  `onClick={async () => {
                      if (!inviteEmail.trim() || !activeGroupId) return;
                      try {
                        const invited = await inviteMemberByEmail(activeGroupId, inviteEmail);
                        setInviteEmail('');
                        pushToast('Member added');
                        pushActivity('System', 'invited ' + invited.name);
                      } catch (err) {
                        pushToast(err.message || 'Invite failed');
                      }
                    }}`
);

fs.writeFileSync(p, c);
console.log('fixed');
