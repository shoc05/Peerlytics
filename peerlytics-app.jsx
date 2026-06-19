import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const PeerlyticsDashboard = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState('student');
  const [darkMode, setDarkMode] = useState(true);
  const [language, setLanguage] = useState('en');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedGroup, setSelectedGroup] = useState('CS101-Group1');
  const [showLoginForm, setShowLoginForm] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Groups CRUD state
  const [groups, setGroups] = useState({
    'CS101-Group1': {
      id: 'CS101-Group1',
      name: 'Advanced Data Structures - Group 1',
      members: [
        { id: 1, name: 'Pema Choden', role: 'Lead', edits: 245, timeSpent: 18.5, taskCompletion: 95, difficulty: 2.8, contributions: [12, 14, 16, 18, 20, 22] },
        { id: 2, name: 'Kelzang Tshomo', role: 'Member', edits: 162, timeSpent: 12.3, taskCompletion: 78, difficulty: 2.1, contributions: [8, 9, 10, 11, 12, 13] },
        { id: 3, name: 'Sonam Dechen', role: 'Member', edits: 89, timeSpent: 5.2, taskCompletion: 45, difficulty: 1.2, contributions: [3, 3, 4, 4, 5, 5] },
        { id: 4, name: 'Ngawang Palden', role: 'Member', edits: 198, timeSpent: 15.8, taskCompletion: 88, difficulty: 2.5, contributions: [10, 12, 14, 15, 17, 19] },
      ],
      createdDate: '2026-01-15',
      deadline: '2026-05-20',
    }
  });
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDeadline, setNewGroupDeadline] = useState('');
  
  // Files/Documents CRUD state
  const [files, setFiles] = useState([
    { id: 1, groupId: 'CS101-Group1', type: 'document', name: 'Project Report', content: 'Initial project report content...', size: '2.4 MB', modified: '2 hours ago', versions: [] },
    { id: 2, groupId: 'CS101-Group1', type: 'spreadsheet', name: 'Data Analysis', content: 'Spreadsheet data...', size: '1.2 MB', modified: '5 hours ago', versions: [] },
    { id: 3, groupId: 'CS101-Group1', type: 'presentation', name: 'Final Slides', content: 'Presentation content...', size: '3.8 MB', modified: '1 day ago', versions: [] },
    { id: 4, groupId: 'CS101-Group1', type: 'code', name: 'Algorithm.py', content: '# Algorithm implementation...', size: '45 KB', modified: '30 mins ago', versions: [] },
  ]);
  const [showCreateFileModal, setShowCreateFileModal] = useState(false);
  const [showEditFileModal, setShowEditFileModal] = useState(false);
  const [editingFileId, setEditingFileId] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState('document');
  const [newFileContent, setNewFileContent] = useState('');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [selectedFileForVersions, setSelectedFileForVersions] = useState(null);
  
  // Copy-Paste Detection state
  const [copyPasteEvents, setCopyPasteEvents] = useState([]);
  const [lecturerNotifications, setLecturerNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

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
      fairness: 'Fairness',
      analytics: 'Analytics',
      grading: 'Grading',
      offline: 'Offline Mode',
      sync: 'Sync Changes',
    },
    dz: {
      signIn: ' ནང་བསྐྱོད ',
      email: 'ཐུགས་རིས་',
      password: 'གསང་ཨིག',
      login: 'ནང་བསྐྱོད་འབད ',
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
      fairness: 'གཏེར་སྤེལ།',
      analytics: 'ཚད་རིས།',
      grading: 'གྲེ་ཡིན།',
      offline: 'འབྲེལ་མེད།',
      sync: 'མཐུན་སྒྲིགས།',
    }
  };

  const t = (key) => translations[language][key] || key;


  const calculateEffortScore = (member) => {
    const weights = { time: 0.25, edits: 0.35, tasks: 0.20, difficulty: 0.20 };
    const timeScore = (member.timeSpent / 20) * 100;
    const editScore = (member.edits / 250) * 100;
    const taskScore = member.taskCompletion;
    const diffScore = (member.difficulty / 3) * 100;
    
    return Math.round(
      timeScore * weights.time +
      editScore * weights.edits +
      taskScore * weights.tasks +
      diffScore * weights.difficulty
    );
  };

  const calculateFairnessScore = (member, allMembers) => {
    const avgEdits = allMembers.reduce((a, b) => a + b.edits, 0) / allMembers.length;
    const avgTime = allMembers.reduce((a, b) => a + b.timeSpent, 0) / allMembers.length;
    const consistency = 1 - Math.abs(member.edits - avgEdits) / avgEdits * 0.5;
    const distribution = 1 - Math.abs(member.timeSpent - avgTime) / avgTime * 0.5;
    return Math.round((consistency + distribution) / 2 * 100);
  };

  const detectFreeRider = (member, allMembers) => {
    const avgEdits = allMembers.reduce((a, b) => a + b.edits, 0) / allMembers.length;
    const avgTime = allMembers.reduce((a, b) => a + b.timeSpent, 0) / allMembers.length;
    
    if (member.edits < avgEdits * 0.6 && member.timeSpent < avgTime * 0.6) {
      return 'low-contributor';
    }
    if (member.edits > avgEdits * 1.5) {
      return 'top-contributor';
    }
    return 'balanced';
  };

  const currentGroup = groups[selectedGroup];
  const groupMembers = currentGroup ? currentGroup.members.map(m => ({
    ...m,
    effortScore: calculateEffortScore(m),
    fairnessScore: calculateFairnessScore(m, currentGroup.members),
    status: detectFreeRider(m, currentGroup.members),
  })).sort((a, b) => b.effortScore - a.effortScore) : [];

  const handleLogin = (e) => {
    e.preventDefault();
    if (loginEmail && loginPassword) {
      setCurrentUser({ name: loginEmail.split('@')[0], email: loginEmail, role: userRole });
      setShowLoginForm(false);
      setLoginEmail('');
      setLoginPassword('');
    }
  };

  // Groups CRUD functions
  const handleCreateGroup = () => {
    if (newGroupName && newGroupDeadline) {
      const newId = `Group-${Date.now()}`;
      setGroups({
        ...groups,
        [newId]: {
          id: newId,
          name: newGroupName,
          members: [{ id: 1, name: currentUser.name, role: 'Lead', edits: 0, timeSpent: 0, taskCompletion: 0, difficulty: 1, contributions: [] }],
          createdDate: new Date().toISOString().split('T')[0],
          deadline: newGroupDeadline,
        }
      });
      setNewGroupName('');
      setNewGroupDeadline('');
      setShowCreateGroupModal(false);
      setSelectedGroup(newId);
    }
  };

  const handleEditGroup = () => {
    if (editingGroupId && newGroupName) {
      setGroups({
        ...groups,
        [editingGroupId]: {
          ...groups[editingGroupId],
          name: newGroupName,
          deadline: newGroupDeadline || groups[editingGroupId].deadline,
        }
      });
      setNewGroupName('');
      setNewGroupDeadline('');
      setShowEditGroupModal(false);
      setEditingGroupId(null);
    }
  };

  const handleDeleteGroup = (groupId) => {
    const newGroups = { ...groups };
    delete newGroups[groupId];
    setGroups(newGroups);
    if (selectedGroup === groupId) {
      const remainingIds = Object.keys(newGroups);
      setSelectedGroup(remainingIds.length > 0 ? remainingIds[0] : null);
    }
  };

  const openEditGroupModal = (groupId) => {
    setEditingGroupId(groupId);
    setNewGroupName(groups[groupId].name);
    setNewGroupDeadline(groups[groupId].deadline);
    setShowEditGroupModal(true);
  };

  // Files CRUD functions
  const handleCreateFile = () => {
    if (newFileName && newFileType) {
      const newFile = {
        id: Date.now(),
        groupId: selectedGroup,
        type: newFileType,
        name: newFileName,
        content: newFileContent || '',
        size: '0 KB',
        modified: 'Just now',
        versions: [{
          id: 1,
          content: newFileContent || '',
          timestamp: new Date().toISOString(),
          user: currentUser.name,
        }],
      };
      setFiles([...files, newFile]);
      setNewFileName('');
      setNewFileContent('');
      setNewFileType('document');
      setShowCreateFileModal(false);
    }
  };

  const handleEditFile = () => {
    if (editingFileId && newFileName) {
      const fileIndex = files.findIndex(f => f.id === editingFileId);
      if (fileIndex !== -1) {
        const oldFile = files[fileIndex];
        const newVersion = {
          id: oldFile.versions.length + 1,
          content: newFileContent || oldFile.content,
          timestamp: new Date().toISOString(),
          user: currentUser.name,
        };
        const updatedFiles = [...files];
        updatedFiles[fileIndex] = {
          ...oldFile,
          name: newFileName,
          content: newFileContent || oldFile.content,
          modified: 'Just now',
          versions: [...oldFile.versions, newVersion],
        };
        setFiles(updatedFiles);
        setNewFileName('');
        setNewFileContent('');
        setShowEditFileModal(false);
        setEditingFileId(null);
      }
    }
  };

  const handleDeleteFile = (fileId) => {
    setFiles(files.filter(f => f.id !== fileId));
  };

  const openEditFileModal = (file) => {
    setEditingFileId(file.id);
    setNewFileName(file.name);
    setNewFileContent(file.content);
    setShowEditFileModal(true);
  };

  // Copy-Paste Detection
  const handlePaste = (e, fileId) => {
    const pastedContent = e.clipboardData.getData('text');
    if (pastedContent.length > 100) {
      const event = {
        id: Date.now(),
        userName: currentUser.name,
        groupName: groups[selectedGroup]?.name || 'Unknown',
        fileName: files.find(f => f.id === fileId)?.name || 'Unknown',
        timestamp: new Date().toISOString(),
        content: pastedContent.substring(0, 200) + '...',
        type: 'copy-paste detected',
        fileId: fileId,
      };
      setCopyPasteEvents([...copyPasteEvents, event]);
      
      // Notify lecturer
      if (userRole === 'lecturer') {
        setLecturerNotifications([...lecturerNotifications, event]);
      }
    }
  };

  if (showLoginForm && !currentUser) {
    return (
      <div style={{
        minHeight: '100vh',
        background: darkMode ? 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%)' : 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
        padding: '20px',
      }}>
        <div style={{
          background: darkMode ? '#1a1f3a' : 'white',
          padding: '40px',
          borderRadius: '16px',
          border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
          width: '100%',
          maxWidth: '420px',
          boxShadow: darkMode ? '0 20px 60px rgba(0,0,0,0.3)' : '0 20px 60px rgba(0,0,0,0.1)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <img 
              src="/logo.png" 
              alt="Peerlytics Logo" 
              style={{
                width: '80px',
                height: '80px',
                margin: '0 auto 20px',
                borderRadius: '16px',
                objectFit: 'contain',
              }}
            />
            <h1 style={{ color: darkMode ? '#e0e7ff' : '#0a0e27', margin: '0 0 10px 0', fontSize: '28px' }}>Peerlytics</h1>
            <p style={{ color: darkMode ? '#8b92b0' : '#666', margin: '0', fontSize: '14px' }}>Smart Collaborative Learning</p>
          </div>

          <form onSubmit={handleLogin} style={{ marginBottom: '20px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                {t('email')}
              </label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="your@email.com"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                  borderRadius: '8px',
                  background: darkMode ? '#0f1425' : '#f9f9f9',
                  color: darkMode ? '#e0e7ff' : '#0a0e27',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                {t('password')}
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                  borderRadius: '8px',
                  background: darkMode ? '#0f1425' : '#f9f9f9',
                  color: darkMode ? '#e0e7ff' : '#0a0e27',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px' }}>
                <input
                  type="radio"
                  checked={userRole === 'student'}
                  onChange={() => setUserRole('student')}
                  style={{ marginRight: '8px' }}
                />
                {t('student')}
              </label>
              <label style={{ marginLeft: '20px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px' }}>
                <input
                  type="radio"
                  checked={userRole === 'lecturer'}
                  onChange={() => setUserRole('lecturer')}
                  style={{ marginRight: '8px' }}
                />
                {t('lecturer')}
              </label>
            </div>

            <button type="submit" style={{
              width: '100%',
              padding: '12px',
              background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 10px 20px rgba(29, 158, 117, 0.3)'; }}
            onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
            >
              {t('login')}
            </button>
          </form>

          <p style={{ textAlign: 'center', color: darkMode ? '#8b92b0' : '#999', fontSize: '12px', margin: '0' }}>
            Demo: Use any email/password
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: darkMode ? '#0a0e27' : '#f5f7fa',
      color: darkMode ? '#e0e7ff' : '#0a0e27',
      minHeight: '100vh',
      fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
      transition: 'background 0.3s',
    }}>
      {/* NAVBAR */}
      <div style={{
        background: darkMode ? 'rgba(15, 20, 40, 0.8)' : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img 
            src="/logo.png" 
            alt="Peerlytics Logo" 
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              objectFit: 'contain',
            }}
          />
          <div>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>Peerlytics</div>
            <div style={{ fontSize: '11px', color: darkMode ? '#8b92b0' : '#666' }}>Smart Learning</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button onClick={() => setLanguage(language === 'en' ? 'dz' : 'en')} style={{
            background: darkMode ? '#1a1f3a' : '#e8ecf1',
            border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
            color: darkMode ? '#e0e7ff' : '#0a0e27',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: language === 'dz' ? '16px' : '12px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            {language === 'en' ? 'དz' : 'EN'}
          </button>

          <button onClick={() => setDarkMode(!darkMode)} style={{
            background: darkMode ? '#1a1f3a' : '#e8ecf1',
            border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
            color: darkMode ? '#e0e7ff' : '#0a0e27',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            {darkMode ? '☀️' : '🌙'}
          </button>

          {userRole === 'lecturer' && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowNotifications(!showNotifications)} style={{
                background: lecturerNotifications.length > 0 ? 'rgba(231, 76, 60, 0.2)' : darkMode ? '#1a1f3a' : '#e8ecf1',
                border: lecturerNotifications.length > 0 ? '1px solid rgba(231, 76, 60, 0.5)' : `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                color: lecturerNotifications.length > 0 ? '#e74c3c' : darkMode ? '#e0e7ff' : '#0a0e27',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}>
                Notifications {lecturerNotifications.length > 0 && `(${lecturerNotifications.length})`}
              </button>
              
              {showNotifications && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '8px',
                  width: '350px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  background: darkMode ? '#1a1f3a' : 'white',
                  border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
                  zIndex: 200,
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>Copy-Paste Alerts</h3>
                  {lecturerNotifications.length === 0 ? (
                    <p style={{ color: darkMode ? '#8b92b0' : '#666', fontSize: '12px', margin: 0 }}>No alerts yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '8px' }}>
                      {lecturerNotifications.map((notification) => (
                        <div key={notification.id} style={{
                          padding: '12px',
                          background: 'rgba(231, 76, 60, 0.1)',
                          border: '1px solid rgba(231, 76, 60, 0.3)',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}>
                          <div style={{ fontWeight: '600', marginBottom: '4px', color: '#e74c3c' }}>
                            ⚠️ Suspicious Activity
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Student:</strong> {notification.userName}
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Group:</strong> {notification.groupName}
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>File:</strong> {notification.fileName}
                          </div>
                          <div style={{ marginBottom: '4px', fontSize: '11px', color: darkMode ? '#8b92b0' : '#666' }}>
                            {new Date(notification.timestamp).toLocaleString()}
                          </div>
                          <div style={{
                            padding: '8px',
                            background: darkMode ? '#0f1425' : '#f5f5f5',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            maxHeight: '60px',
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {notification.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button onClick={() => { setCurrentUser(null); setShowLoginForm(true); }} style={{
            background: darkMode ? '#1a1f3a' : '#e8ecf1',
            border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
            color: darkMode ? '#e0e7ff' : '#0a0e27',
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

      {/* MAIN LAYOUT */}
      <div style={{ display: 'flex', height: 'calc(100vh - 65px)' }}>
        {/* SIDEBAR */}
        <div style={{
          width: '220px',
          background: darkMode ? 'rgba(15, 20, 40, 0.6)' : 'rgba(255, 255, 255, 0.8)',
          borderRight: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
          padding: '20px',
          overflowY: 'auto',
          backdropFilter: 'blur(10px)',
        }}>
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: darkMode ? '#8b92b0' : '#999', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px' }}>
              Menu
            </div>
            {['dashboard', 'workspace', 'groups', 'grading'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                width: '100%',
                padding: '10px 12px',
                background: activeTab === tab ? 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)' : 'transparent',
                color: activeTab === tab ? 'white' : darkMode ? '#8b92b0' : '#666',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                marginBottom: '8px',
                textAlign: 'left',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => !activeTab === tab && (e.target.style.background = darkMode ? '#1a1f3a' : '#f0f0f0')}
              onMouseLeave={(e) => !activeTab === tab && (e.target.style.background = 'transparent')}
              >
                {t(tab)}
              </button>
            ))}
          </div>

          {userRole === 'lecturer' && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: darkMode ? '#8b92b0' : '#999', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px' }}>
                Lecturer Tools
              </div>
              {['contribution', 'fairness', 'analytics', 'grading'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: activeTab === tab ? 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)' : 'transparent',
                  color: activeTab === tab ? 'white' : darkMode ? '#8b92b0' : '#666',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  marginBottom: '8px',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => !activeTab === tab && (e.target.style.background = darkMode ? '#1a1f3a' : '#f0f0f0')}
                onMouseLeave={(e) => !activeTab === tab && (e.target.style.background = 'transparent')}
                >
                  {t(tab)}
                </button>
              ))}
            </div>
          )}

          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: darkMode ? '#8b92b0' : '#999', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px' }}>
              Active Group
            </div>
            <div style={{
              padding: '12px',
              background: darkMode ? '#1a1f3a' : '#f0f0f0',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '500',
              color: darkMode ? '#e0e7ff' : '#0a0e27',
              borderLeft: '3px solid #1D9E75',
            }}>
              {currentGroup.name}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: darkMode ? '#8b92b0' : '#999', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
              System
            </div>
            <button onClick={() => setOfflineMode(!offlineMode)} style={{
              width: '100%',
              padding: '10px 12px',
              background: offlineMode ? 'rgba(255, 193, 7, 0.2)' : 'transparent',
              color: offlineMode ? '#ffc107' : darkMode ? '#8b92b0' : '#666',
              border: offlineMode ? '1px solid #ffc107' : `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              marginBottom: '8px',
              textAlign: 'left',
              transition: 'all 0.2s',
            }}>
              {offlineMode ? 'Offline Mode' : 'Online Mode'}
            </button>
          </div>
        </div>

        {/* CONTENT AREA */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '30px',
        }}>
          {/* DASHBOARD VIEW */}
          {activeTab === 'dashboard' && (
            <div>
              <div style={{ marginBottom: '30px' }}>
                <h1 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700' }}>
                  Welcome back, {currentUser.name}!
                </h1>
                <p style={{ margin: '0', color: darkMode ? '#8b92b0' : '#666', fontSize: '14px' }}>
                  {userRole === 'student' ? 'Track your contributions and collaborate with peers.' : 'Monitor group progress and fairness metrics.'}
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
                  <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
                    Total Edits
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#1D9E75' }}>
                    {groupMembers.reduce((a, b) => a + b.edits, 0)}
                  </div>
                </div>

                <div style={{
                  background: darkMode ? 'rgba(79, 172, 254, 0.1)' : 'rgba(79, 172, 254, 0.05)',
                  border: `1px solid ${darkMode ? 'rgba(79, 172, 254, 0.3)' : 'rgba(79, 172, 254, 0.2)'}`,
                  borderRadius: '12px',
                  padding: '20px',
                  borderLeft: '4px solid #4facfe',
                }}>
                  <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
                    Avg Effort Score
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#4facfe' }}>
                    {Math.round(groupMembers.reduce((a, b) => a + b.effortScore, 0) / groupMembers.length)}
                  </div>
                </div>

                <div style={{
                  background: darkMode ? 'rgba(255, 193, 7, 0.1)' : 'rgba(255, 193, 7, 0.05)',
                  border: `1px solid ${darkMode ? 'rgba(255, 193, 7, 0.3)' : 'rgba(255, 193, 7, 0.2)'}`,
                  borderRadius: '12px',
                  padding: '20px',
                  borderLeft: '4px solid #ffc107',
                }}>
                  <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
                    Fairness Balance
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#ffc107' }}>
                    {Math.round(groupMembers.reduce((a, b) => a + b.fairnessScore, 0) / groupMembers.length)}%
                  </div>
                </div>
              </div>

              {/* Leaderboard */}
              <div style={{
                background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Group Leaderboard</h2>
                <div style={{ display: 'grid', gap: '12px' }}>
                  {groupMembers.map((member, idx) => (
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
                        <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', display: 'flex', gap: '12px' }}>
                          <span>{member.edits} edits</span>
                          <span>{member.timeSpent}h</span>
                          <span>{member.taskCompletion}%</span>
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
                        <div style={{
                          fontSize: '11px',
                          color: member.status === 'top-contributor' ? '#1D9E75' : member.status === 'low-contributor' ? '#e74c3c' : darkMode ? '#8b92b0' : '#999',
                          fontWeight: '500',
                        }}>
                          {member.status === 'top-contributor' && 'Top Contributor'}
                          {member.status === 'low-contributor' && 'Low Contributor'}
                          {member.status === 'balanced' && 'Balanced'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CONTRIBUTION TRACKER */}
          {activeTab === 'contribution' && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>Contribution Tracker</h1>
              
              <div style={{
                background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Member Contributions</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={groupMembers}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#2a3555' : '#e0e0e0'} />
                    <XAxis dataKey="name" stroke={darkMode ? '#8b92b0' : '#666'} angle={-45} textAnchor="end" height={80} />
                    <YAxis stroke={darkMode ? '#8b92b0' : '#666'} />
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1a1f3a' : 'white',
                      border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#e0e7ff' : '#0a0e27',
                    }} />
                    <Legend wrapperStyle={{ color: darkMode ? '#8b92b0' : '#666' }} />
                    <Bar dataKey="edits" fill="#1D9E75" />
                    <Bar dataKey="timeSpent" fill="#4facfe" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                {groupMembers.map(member => (
                  <div key={member.id} style={{
                    background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                    borderRadius: '12px',
                    padding: '16px',
                    backdropFilter: 'blur(10px)',
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: '12px', fontSize: '14px' }}>{member.name}</div>
                    <div style={{ display: 'grid', gap: '8px', fontSize: '13px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Edits</span>
                        <span style={{ fontWeight: '600', color: '#1D9E75' }}>{member.edits}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Time Spent</span>
                        <span style={{ fontWeight: '600', color: '#4facfe' }}>{member.timeSpent}h</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Task Completion</span>
                        <span style={{ fontWeight: '600', color: '#ffc107' }}>{member.taskCompletion}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FAIRNESS DETECTION */}
          {activeTab === 'fairness' && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>Fairness Detection</h1>
              
              <div style={{
                background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Fairness Scores</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={groupMembers}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#2a3555' : '#e0e0e0'} />
                    <XAxis dataKey="name" stroke={darkMode ? '#8b92b0' : '#666'} angle={-45} textAnchor="end" height={80} />
                    <YAxis stroke={darkMode ? '#8b92b0' : '#666'} domain={[0, 100]} />
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1a1f3a' : 'white',
                      border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#e0e7ff' : '#0a0e27',
                    }} />
                    <Bar dataKey="fairnessScore" fill="#1D9E75" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                {groupMembers.map(member => (
                  <div key={member.id} style={{
                    background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
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
                      <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Score Distribution</div>
                      <div style={{
                        width: '100%',
                        height: '8px',
                        background: darkMode ? '#0f1425' : '#f0f0f0',
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
                      {member.status === 'top-contributor' && '⭐ Excellent contributor - above average'}
                      {member.status === 'low-contributor' && '⚠️ Low contributor - needs engagement'}
                      {member.status === 'balanced' && '✓ Balanced contributor - good participation'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ANALYTICS */}
          {activeTab === 'analytics' && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>Analytics Dashboard</h1>

              <div style={{
                background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
                marginBottom: '24px',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Contribution Distribution</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={groupMembers}
                      dataKey="edits"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {groupMembers.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#1D9E75', '#4facfe', '#ffc107', '#e74c3c'][index % 4]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1a1f3a' : 'white',
                      border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#e0e7ff' : '#0a0e27',
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div style={{
                background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
              }}>
                <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Activity Timeline</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={groupMembers[0].contributions.map((val, idx) => ({
                    day: `Day ${idx + 1}`,
                    ...Object.fromEntries(groupMembers.map(m => [m.name, m.contributions[idx]]))
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#2a3555' : '#e0e0e0'} />
                    <XAxis dataKey="day" stroke={darkMode ? '#8b92b0' : '#666'} />
                    <YAxis stroke={darkMode ? '#8b92b0' : '#666'} />
                    <Tooltip contentStyle={{
                      background: darkMode ? '#1a1f3a' : 'white',
                      border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#e0e7ff' : '#0a0e27',
                    }} />
                    <Legend wrapperStyle={{ color: darkMode ? '#8b92b0' : '#666' }} />
                    {groupMembers.map((member, idx) => (
                      <Line key={member.id} type="monotone" dataKey={member.name} stroke={['#1D9E75', '#4facfe', '#ffc107', '#e74c3c'][idx % 4]} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* GRADING PANEL */}
          {activeTab === 'grading' && userRole === 'lecturer' && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>Student Performance Analysis</h1>

              <div style={{
                background: 'rgba(29, 158, 117, 0.1)',
                border: '1px solid rgba(29, 158, 117, 0.3)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px',
              }}>
                <div style={{ fontSize: '13px', color: darkMode ? '#1D9E75' : '#0d6e4d' }}>
                  <strong>Performance Analysis:</strong> Based on effort score, contribution, fairness metrics, and copy-paste detection. Final grades are at your discretion.
                </div>
              </div>

              <div style={{ display: 'grid', gap: '16px' }}>
                {groupMembers.map(member => {
                  let suggestedGrade = 5;
                  if (member.effortScore > 85) suggestedGrade = 9;
                  else if (member.effortScore > 75) suggestedGrade = 8;
                  else if (member.effortScore > 65) suggestedGrade = 7;
                  else if (member.effortScore > 50) suggestedGrade = 6;

                  const memberCopyPasteEvents = copyPasteEvents.filter(e => e.userName === member.name);
                  const hasSuspiciousActivity = memberCopyPasteEvents.length > 0;

                  return (
                    <div key={member.id} style={{
                      background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                      border: hasSuspiciousActivity ? '2px solid #e74c3c' : `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                      borderRadius: '12px',
                      padding: '20px',
                      backdropFilter: 'blur(10px)',
                      transition: 'all 0.3s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = darkMode ? 'rgba(26, 31, 58, 0.8)' : 'rgba(255, 255, 255, 0.95)';
                      e.currentTarget.style.borderColor = darkMode ? '#1D9E75' : '#1D9E75';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)';
                      e.currentTarget.style.borderColor = hasSuspiciousActivity ? '#e74c3c' : darkMode ? '#2a3555' : '#e0e0e0';
                    }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div>
                          <div style={{ fontWeight: '600', marginBottom: '4px', fontSize: '16px' }}>{member.name}</div>
                          <div style={{ fontSize: '12px', color: hasSuspiciousActivity ? '#e74c3c' : darkMode ? '#8b92b0' : '#666' }}>
                            {hasSuspiciousActivity ? `Warning: ${memberCopyPasteEvents.length} suspicious paste events detected` : 'No suspicious activity detected'}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '32px',
                          fontWeight: '700',
                          color: suggestedGrade > 8 ? '#1D9E75' : suggestedGrade > 6 ? '#ffc107' : '#e74c3c',
                          background: darkMode ? 'rgba(29, 158, 117, 0.2)' : 'rgba(29, 158, 117, 0.1)',
                          padding: '12px 20px',
                          borderRadius: '8px',
                        }}>
                          {suggestedGrade}/10
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
                        <div style={{
                          padding: '12px',
                          background: darkMode ? 'rgba(29, 158, 117, 0.1)' : 'rgba(29, 158, 117, 0.05)',
                          borderRadius: '8px',
                          border: '1px solid rgba(29, 158, 117, 0.2)',
                        }}>
                          <div style={{ fontSize: '11px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Effort Score</div>
                          <div style={{ fontWeight: '700', color: '#1D9E75', fontSize: '18px' }}>{member.effortScore}</div>
                        </div>
                        <div style={{
                          padding: '12px',
                          background: darkMode ? 'rgba(79, 172, 254, 0.1)' : 'rgba(79, 172, 254, 0.05)',
                          borderRadius: '8px',
                          border: '1px solid rgba(79, 172, 254, 0.2)',
                        }}>
                          <div style={{ fontSize: '11px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Fairness Score</div>
                          <div style={{ fontWeight: '700', color: '#4facfe', fontSize: '18px' }}>{member.fairnessScore}%</div>
                        </div>
                        <div style={{
                          padding: '12px',
                          background: darkMode ? 'rgba(255, 193, 7, 0.1)' : 'rgba(255, 193, 7, 0.05)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 193, 7, 0.2)',
                        }}>
                          <div style={{ fontSize: '11px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Status</div>
                          <div style={{ fontWeight: '700', color: '#ffc107', fontSize: '14px' }}>
                            {member.status === 'top-contributor' ? 'Top Contributor' : member.status === 'low-contributor' ? 'Low Contributor' : 'Balanced'}
                          </div>
                        </div>
                        <div style={{
                          padding: '12px',
                          background: darkMode ? 'rgba(231, 76, 60, 0.1)' : 'rgba(231, 76, 60, 0.05)',
                          borderRadius: '8px',
                          border: '1px solid rgba(231, 76, 60, 0.2)',
                        }}>
                          <div style={{ fontSize: '11px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Paste Events</div>
                          <div style={{ fontWeight: '700', color: '#e74c3c', fontSize: '18px' }}>{memberCopyPasteEvents.length}</div>
                        </div>
                      </div>

                      <div style={{
                        padding: '16px',
                        background: darkMode ? '#0f1425' : '#f5f5f5',
                        borderRadius: '8px',
                        marginBottom: '16px',
                      }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600' }}>Grade Breakdown</h4>
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
                              <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Time Spent</span>
                              <span style={{ fontWeight: '600' }}>{Math.round((member.timeSpent / 20) * 100)}%</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '3px' }}>
                              <div style={{ width: `${Math.round((member.timeSpent / 20) * 100)}%`, height: '100%', background: '#1D9E75', borderRadius: '3px' }} />
                            </div>
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
                              <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Edit Contributions</span>
                              <span style={{ fontWeight: '600' }}>{Math.round((member.edits / 250) * 100)}%</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '3px' }}>
                              <div style={{ width: `${Math.round((member.edits / 250) * 100)}%`, height: '100%', background: '#4facfe', borderRadius: '3px' }} />
                            </div>
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
                              <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Task Completion</span>
                              <span style={{ fontWeight: '600' }}>{member.taskCompletion}%</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '3px' }}>
                              <div style={{ width: `${member.taskCompletion}%`, height: '100%', background: '#ffc107', borderRadius: '3px' }} />
                            </div>
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
                              <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Difficulty Level</span>
                              <span style={{ fontWeight: '600' }}>{Math.round((member.difficulty / 3) * 100)}%</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '3px' }}>
                              <div style={{ width: `${Math.round((member.difficulty / 3) * 100)}%`, height: '100%', background: '#e74c3c', borderRadius: '3px' }} />
                            </div>
                          </div>
                        </div>
                      </div>

                      <button style={{
                        width: '100%',
                        padding: '12px',
                        background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 5px 15px rgba(29, 158, 117, 0.3)'; }}
                      onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
                      >
                        View Detailed Activity Log
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STUDENT PERFORMANCE VIEW */}
          {activeTab === 'grading' && userRole === 'student' && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>My Performance Analysis</h1>

              <div style={{
                background: 'rgba(29, 158, 117, 0.1)',
                border: '1px solid rgba(29, 158, 117, 0.3)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px',
              }}>
                <div style={{ fontSize: '13px', color: darkMode ? '#1D9E75' : '#0d6e4d' }}>
                  <strong>Your Performance:</strong> Based on your effort score, contribution, fairness metrics, and copy-paste detection.
                </div>
              </div>

              {groupMembers.filter(m => m.name === currentUser?.name).map(member => {
                let suggestedGrade = 5;
                if (member.effortScore > 85) suggestedGrade = 9;
                else if (member.effortScore > 75) suggestedGrade = 8;
                else if (member.effortScore > 65) suggestedGrade = 7;
                else if (member.effortScore > 50) suggestedGrade = 6;

                const memberCopyPasteEvents = copyPasteEvents.filter(e => e.userName === member.name);
                const hasSuspiciousActivity = memberCopyPasteEvents.length > 0;

                return (
                  <div key={member.id} style={{
                    background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                    border: hasSuspiciousActivity ? '2px solid #e74c3c' : `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                    borderRadius: '12px',
                    padding: '30px',
                    backdropFilter: 'blur(10px)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '20px' }}>{member.name}</div>
                        <div style={{ fontSize: '14px', color: hasSuspiciousActivity ? '#e74c3c' : darkMode ? '#8b92b0' : '#666' }}>
                          {hasSuspiciousActivity ? `Warning: ${memberCopyPasteEvents.length} suspicious paste events detected` : 'No suspicious activity detected'}
                        </div>
                      </div>
                      <div style={{
                        fontSize: '48px',
                        fontWeight: '700',
                        color: suggestedGrade > 8 ? '#1D9E75' : suggestedGrade > 6 ? '#ffc107' : '#e74c3c',
                        background: darkMode ? 'rgba(29, 158, 117, 0.2)' : 'rgba(29, 158, 117, 0.1)',
                        padding: '16px 24px',
                        borderRadius: '12px',
                      }}>
                        {suggestedGrade}/10
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                      <div style={{
                        padding: '16px',
                        background: darkMode ? 'rgba(29, 158, 117, 0.1)' : 'rgba(29, 158, 117, 0.05)',
                        borderRadius: '8px',
                        border: '1px solid rgba(29, 158, 117, 0.2)',
                      }}>
                        <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px' }}>Effort Score</div>
                        <div style={{ fontWeight: '700', color: '#1D9E75', fontSize: '24px' }}>{member.effortScore}</div>
                      </div>
                      <div style={{
                        padding: '16px',
                        background: darkMode ? 'rgba(79, 172, 254, 0.1)' : 'rgba(79, 172, 254, 0.05)',
                        borderRadius: '8px',
                        border: '1px solid rgba(79, 172, 254, 0.2)',
                      }}>
                        <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px' }}>Fairness Score</div>
                        <div style={{ fontWeight: '700', color: '#4facfe', fontSize: '24px' }}>{member.fairnessScore}%</div>
                      </div>
                      <div style={{
                        padding: '16px',
                        background: darkMode ? 'rgba(255, 193, 7, 0.1)' : 'rgba(255, 193, 7, 0.05)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 193, 7, 0.2)',
                      }}>
                        <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px' }}>Status</div>
                        <div style={{ fontWeight: '700', color: '#ffc107', fontSize: '18px' }}>
                          {member.status === 'top-contributor' ? 'Top Contributor' : member.status === 'low-contributor' ? 'Low Contributor' : 'Balanced'}
                        </div>
                      </div>
                      <div style={{
                        padding: '16px',
                        background: darkMode ? 'rgba(231, 76, 60, 0.1)' : 'rgba(231, 76, 60, 0.05)',
                        borderRadius: '8px',
                        border: '1px solid rgba(231, 76, 60, 0.2)',
                      }}>
                        <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px' }}>Paste Events</div>
                        <div style={{ fontWeight: '700', color: '#e74c3c', fontSize: '24px' }}>{memberCopyPasteEvents.length}</div>
                      </div>
                    </div>

                    <div style={{
                      padding: '20px',
                      background: darkMode ? '#0f1425' : '#f5f5f5',
                      borderRadius: '8px',
                      marginBottom: '24px',
                    }}>
                      <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' }}>Grade Breakdown</h4>
                      <div style={{ display: 'grid', gap: '12px' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                            <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Time Spent</span>
                            <span style={{ fontWeight: '600' }}>{Math.round((member.timeSpent / 20) * 100)}%</span>
                          </div>
                          <div style={{ width: '100%', height: '8px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '4px' }}>
                            <div style={{ width: `${Math.round((member.timeSpent / 20) * 100)}%`, height: '100%', background: '#1D9E75', borderRadius: '4px' }} />
                          </div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                            <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Edit Contributions</span>
                            <span style={{ fontWeight: '600' }}>{Math.round((member.edits / 250) * 100)}%</span>
                          </div>
                          <div style={{ width: '100%', height: '8px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '4px' }}>
                            <div style={{ width: `${Math.round((member.edits / 250) * 100)}%`, height: '100%', background: '#4facfe', borderRadius: '4px' }} />
                          </div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                            <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Task Completion</span>
                            <span style={{ fontWeight: '600' }}>{member.taskCompletion}%</span>
                          </div>
                          <div style={{ width: '100%', height: '8px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '4px' }}>
                            <div style={{ width: `${member.taskCompletion}%`, height: '100%', background: '#ffc107', borderRadius: '4px' }} />
                          </div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                            <span style={{ color: darkMode ? '#8b92b0' : '#666' }}>Difficulty Level</span>
                            <span style={{ fontWeight: '600' }}>{Math.round((member.difficulty / 3) * 100)}%</span>
                          </div>
                          <div style={{ width: '100%', height: '8px', background: darkMode ? '#1a1f3a' : '#e0e0e0', borderRadius: '4px' }}>
                            <div style={{ width: `${Math.round((member.difficulty / 3) * 100)}%`, height: '100%', background: '#e74c3c', borderRadius: '4px' }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{
                      padding: '20px',
                      background: darkMode ? '#0f1425' : '#f5f5f5',
                      borderRadius: '8px',
                    }}>
                      <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' }}>Your Activity Summary</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                        <div>
                          <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Total Edits</div>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: '#1D9E75' }}>{member.edits}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Time Spent</div>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: '#4facfe' }}>{member.timeSpent}h</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Task Completion</div>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: '#ffc107' }}>{member.taskCompletion}%</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>Role</div>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: '#e74c3c' }}>{member.role}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* WORKSPACE */}
          {activeTab === 'workspace' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '30px' }}>
                <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700' }}>My Workspace</h1>
                <button onClick={() => setShowCreateFileModal(true)} style={{
                  background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}>
                  + Create File
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                {files.filter(f => f.groupId === selectedGroup).map((file) => (
                  <div key={file.id} style={{
                    background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                    borderRadius: '12px',
                    padding: '16px',
                    backdropFilter: 'blur(10px)',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = darkMode ? 'rgba(29, 158, 117, 0.2)' : 'rgba(29, 158, 117, 0.08)';
                    e.currentTarget.style.borderColor = '#1D9E75';
                    e.currentTarget.style.transform = 'translateY(-4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)';
                    e.currentTarget.style.borderColor = darkMode ? '#2a3555' : '#e0e0e0';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  >
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>
                      {file.type === 'document' && <span style={{ color: '#1D9E75' }}>DOC</span>}
                      {file.type === 'spreadsheet' && <span style={{ color: '#4facfe' }}>XLS</span>}
                      {file.type === 'presentation' && <span style={{ color: '#ffc107' }}>PPT</span>}
                      {file.type === 'code' && <span style={{ color: '#e74c3c' }}>CODE</span>}
                    </div>
                    <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>{file.name}</div>
                    <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '4px' }}>{file.size}</div>
                    <div style={{ fontSize: '11px', color: darkMode ? '#5a6280' : '#999', marginBottom: '12px' }}>{file.modified}</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={(e) => { e.stopPropagation(); openEditFileModal(file); }} style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: darkMode ? '#1a1f3a' : '#e8ecf1',
                        border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                        color: darkMode ? '#e0e7ff' : '#0a0e27',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Edit
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedFileForVersions(file); setShowVersionHistory(true); }} style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: darkMode ? '#1a1f3a' : '#e8ecf1',
                        border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                        color: darkMode ? '#e0e7ff' : '#0a0e27',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        History
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.id); }} style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid rgba(231, 76, 60, 0.3)',
                        color: '#e74c3c',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GROUPS */}
          {activeTab === 'groups' && (
            <div>
              <h1 style={{ margin: '0 0 30px 0', fontSize: '28px', fontWeight: '700' }}>My Groups</h1>
              <div style={{
                background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                borderRadius: '12px',
                padding: '24px',
                backdropFilter: 'blur(10px)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>Active Groups</h2>
                  <button onClick={() => setShowCreateGroupModal(true)} style={{
                    background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}>
                    + Create Group
                  </button>
                </div>

                <div style={{ display: 'grid', gap: '12px' }}>
                  {Object.values(groups).map(group => (
                    <div key={group.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '16px',
                      background: selectedGroup === group.id ? darkMode ? 'rgba(29, 158, 117, 0.2)' : 'rgba(29, 158, 117, 0.1)' : darkMode ? 'rgba(29, 158, 117, 0.1)' : 'rgba(29, 158, 117, 0.05)',
                      borderRadius: '8px',
                      border: selectedGroup === group.id ? '2px solid #1D9E75' : `1px solid ${darkMode ? 'rgba(29, 158, 117, 0.3)' : 'rgba(29, 158, 117, 0.2)'}`,
                    }}>
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>{group.name}</div>
                        <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666' }}>
                          {group.members.length} members • Due {group.deadline}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setSelectedGroup(group.id)} style={{
                          background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                          color: 'white',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}>
                          Open
                        </button>
                        <button onClick={() => openEditGroupModal(group.id)} style={{
                          background: darkMode ? '#1a1f3a' : '#e8ecf1',
                          border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}>
                          Edit
                        </button>
                        <button onClick={() => handleDeleteGroup(group.id)} style={{
                          background: 'rgba(231, 76, 60, 0.1)',
                          border: '1px solid rgba(231, 76, 60, 0.3)',
                          color: '#e74c3c',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Create Group Modal */}
              {showCreateGroupModal && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}>
                  <div style={{
                    background: darkMode ? '#1a1f3a' : 'white',
                    padding: '30px',
                    borderRadius: '16px',
                    width: '90%',
                    maxWidth: '400px',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                  }}>
                    <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Create New Group</h2>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        Group Name
                      </label>
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Enter group name"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        Deadline
                      </label>
                      <input
                        type="date"
                        value={newGroupDeadline}
                        onChange={(e) => setNewGroupDeadline(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button onClick={() => setShowCreateGroupModal(false)} style={{
                        flex: 1,
                        padding: '12px',
                        background: darkMode ? '#1a1f3a' : '#e8ecf1',
                        border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                        color: darkMode ? '#e0e7ff' : '#0a0e27',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Cancel
                      </button>
                      <button onClick={handleCreateGroup} style={{
                        flex: 1,
                        padding: '12px',
                        background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Create
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Edit Group Modal */}
              {showEditGroupModal && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}>
                  <div style={{
                    background: darkMode ? '#1a1f3a' : 'white',
                    padding: '30px',
                    borderRadius: '16px',
                    width: '90%',
                    maxWidth: '400px',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                  }}>
                    <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Edit Group</h2>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        Group Name
                      </label>
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Enter group name"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        Deadline
                      </label>
                      <input
                        type="date"
                        value={newGroupDeadline}
                        onChange={(e) => setNewGroupDeadline(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button onClick={() => setShowEditGroupModal(false)} style={{
                        flex: 1,
                        padding: '12px',
                        background: darkMode ? '#1a1f3a' : '#e8ecf1',
                        border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                        color: darkMode ? '#e0e7ff' : '#0a0e27',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Cancel
                      </button>
                      <button onClick={handleEditGroup} style={{
                        flex: 1,
                        padding: '12px',
                        background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Create File Modal */}
              {showCreateFileModal && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}>
                  <div style={{
                    background: darkMode ? '#1a1f3a' : 'white',
                    padding: '30px',
                    borderRadius: '16px',
                    width: '90%',
                    maxWidth: '500px',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                  }}>
                    <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Create New File</h2>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        File Name
                      </label>
                      <input
                        type="text"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        placeholder="Enter file name"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        File Type
                      </label>
                      <select
                        value={newFileType}
                        onChange={(e) => setNewFileType(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="document">Document</option>
                        <option value="spreadsheet">Spreadsheet</option>
                        <option value="presentation">Presentation</option>
                        <option value="code">Code</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        Initial Content
                      </label>
                      <textarea
                        value={newFileContent}
                        onChange={(e) => setNewFileContent(e.target.value)}
                        onPaste={(e) => handlePaste(e, null)}
                        placeholder="Enter initial content..."
                        rows={4}
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                          resize: 'vertical',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button onClick={() => setShowCreateFileModal(false)} style={{
                        flex: 1,
                        padding: '12px',
                        background: darkMode ? '#1a1f3a' : '#e8ecf1',
                        border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                        color: darkMode ? '#e0e7ff' : '#0a0e27',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Cancel
                      </button>
                      <button onClick={handleCreateFile} style={{
                        flex: 1,
                        padding: '12px',
                        background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Create
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Edit File Modal */}
              {showEditFileModal && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}>
                  <div style={{
                    background: darkMode ? '#1a1f3a' : 'white',
                    padding: '30px',
                    borderRadius: '16px',
                    width: '90%',
                    maxWidth: '600px',
                    maxHeight: '80vh',
                    overflowY: 'auto',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                  }}>
                    <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Edit File</h2>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        File Name
                      </label>
                      <input
                        type="text"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        placeholder="Enter file name"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', color: darkMode ? '#e0e7ff' : '#0a0e27', fontSize: '14px', fontWeight: '500' }}>
                        Content
                      </label>
                      <textarea
                        value={newFileContent}
                        onChange={(e) => setNewFileContent(e.target.value)}
                        onPaste={(e) => handlePaste(e, editingFileId)}
                        placeholder="Enter content..."
                        rows={10}
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: `1px solid ${darkMode ? '#2a3555' : '#ddd'}`,
                          borderRadius: '8px',
                          background: darkMode ? '#0f1425' : '#f9f9f9',
                          color: darkMode ? '#e0e7ff' : '#0a0e27',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                          resize: 'vertical',
                          fontFamily: 'monospace',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button onClick={() => setShowEditFileModal(false)} style={{
                        flex: 1,
                        padding: '12px',
                        background: darkMode ? '#1a1f3a' : '#e8ecf1',
                        border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                        color: darkMode ? '#e0e7ff' : '#0a0e27',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Cancel
                      </button>
                      <button onClick={handleEditFile} style={{
                        flex: 1,
                        padding: '12px',
                        background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}>
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Version History Modal */}
              {showVersionHistory && selectedFileForVersions && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}>
                  <div style={{
                    background: darkMode ? '#1a1f3a' : 'white',
                    padding: '30px',
                    borderRadius: '16px',
                    width: '90%',
                    maxWidth: '700px',
                    maxHeight: '80vh',
                    overflowY: 'auto',
                    border: `1px solid ${darkMode ? '#2a3555' : '#e0e0e0'}`,
                  }}>
                    <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Activity History: {selectedFileForVersions.name}</h2>
                    
                    {/* File Versions */}
                    <div style={{ marginBottom: '24px' }}>
                      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#1D9E75' }}>Edit Versions</h3>
                      {selectedFileForVersions.versions.length === 0 ? (
                        <p style={{ color: darkMode ? '#8b92b0' : '#666', fontSize: '14px' }}>No edit versions available yet.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: '12px' }}>
                          {selectedFileForVersions.versions.map((version) => (
                            <div key={version.id} style={{
                              padding: '16px',
                              background: darkMode ? 'rgba(29, 158, 117, 0.1)' : 'rgba(29, 158, 117, 0.05)',
                              borderRadius: '8px',
                              border: `1px solid ${darkMode ? 'rgba(29, 158, 117, 0.3)' : 'rgba(29, 158, 117, 0.2)'}`,
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <div style={{ fontWeight: '600', fontSize: '14px' }}>Version {version.id}</div>
                                <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666' }}>
                                  {new Date(version.timestamp).toLocaleString()}
                                </div>
                              </div>
                              <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px' }}>
                                Edited by: {version.user}
                              </div>
                              <div style={{
                                padding: '8px',
                                background: darkMode ? '#0f1425' : '#f5f5f5',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                maxHeight: '100px',
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}>
                                {version.content.substring(0, 200)}{version.content.length > 200 ? '...' : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Copy-Paste Events for this file */}
                    <div style={{ marginBottom: '24px' }}>
                      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#e74c3c' }}>Copy-Paste Events</h3>
                      {copyPasteEvents.filter(e => e.fileName === selectedFileForVersions.name).length === 0 ? (
                        <p style={{ color: darkMode ? '#8b92b0' : '#666', fontSize: '14px' }}>No copy-paste events detected for this file.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: '12px' }}>
                          {copyPasteEvents.filter(e => e.fileName === selectedFileForVersions.name).map((event) => (
                            <div key={event.id} style={{
                              padding: '16px',
                              background: 'rgba(231, 76, 60, 0.1)',
                              borderRadius: '8px',
                              border: '1px solid rgba(231, 76, 60, 0.3)',
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <div style={{ fontWeight: '600', fontSize: '14px', color: '#e74c3c' }}>Suspicious Paste</div>
                                <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666' }}>
                                  {new Date(event.timestamp).toLocaleString()}
                                </div>
                              </div>
                              <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', marginBottom: '8px' }}>
                                User: {event.userName} • Group: {event.groupName}
                              </div>
                              <div style={{
                                padding: '8px',
                                background: darkMode ? '#0f1425' : '#f5f5f5',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                maxHeight: '100px',
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                color: '#e74c3c',
                              }}>
                                {event.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* All Member Activity */}
                    <div style={{ marginBottom: '24px' }}>
                      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#4facfe' }}>All Member Activity</h3>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {groups[selectedGroup]?.members.map(member => {
                          const memberVersions = selectedFileForVersions.versions.filter(v => v.user === member.name);
                          const memberPasteEvents = copyPasteEvents.filter(e => e.userName === member.name && e.fileName === selectedFileForVersions.name);
                          
                          return (
                            <div key={member.id} style={{
                              padding: '12px',
                              background: darkMode ? 'rgba(79, 172, 254, 0.1)' : 'rgba(79, 172, 254, 0.05)',
                              borderRadius: '8px',
                              border: '1px solid rgba(79, 172, 254, 0.2)',
                            }}>
                              <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '8px' }}>{member.name}</div>
                              <div style={{ fontSize: '12px', color: darkMode ? '#8b92b0' : '#666', display: 'flex', gap: '16px' }}>
                                <span>Edits: {memberVersions.length}</span>
                                <span>Paste Events: {memberPasteEvents.length}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <button onClick={() => { setShowVersionHistory(false); setSelectedFileForVersions(null); }} style={{
                      width: '100%',
                      marginTop: '20px',
                      padding: '12px',
                      background: darkMode ? '#1a1f3a' : '#e8ecf1',
                      border: `1px solid ${darkMode ? '#2a3555' : '#d0d0d0'}`,
                      color: darkMode ? '#e0e7ff' : '#0a0e27',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PeerlyticsDashboard;