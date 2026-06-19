const fs = require('fs');
const p = 'src/components/WorkspacePanel.jsx';
let c = fs.readFileSync(p, 'utf8');

if (!c.includes('groupId')) {
  c = c.replace(
    "import { saveSubmissionReport, getReportByFileId } from '../firebase/firestoreService';",
    `import {
  saveSubmissionReport,
  getReportByFileId,
  subscribeWorkspace,
  saveWorkspaceFile,
  deleteWorkspaceFile,
  saveDocumentContent,
  getDocumentContent,
  saveDocumentVersion,
  subscribeFileVersions,
  incrementMemberMetric,
} from '../firebase/firestoreService';`
  );

  c = c.replace(
    'export default function WorkspacePanel({ darkMode, currentUser, groupMembers, pushToast, pushActivity }) {',
    'export default function WorkspacePanel({ darkMode, currentUser, groupId, groupMembers, pushToast, pushActivity }) {'
  );

  const hook = `
  useEffect(() => {
    if (!groupId) return undefined;
    const unsub = subscribeWorkspace(groupId, setFolders);
    return unsub;
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !openFile?.id) return undefined;
    return subscribeFileVersions(groupId, openFile.id, (versions) => {
      setVersionHistory((vh) => ({ ...vh, [openFile.id]: versions }));
    });
  }, [groupId, openFile?.id]);
`;

  c = c.replace(
    'import React, { useState, useCallback, useRef } from \'react\';',
    "import React, { useState, useCallback, useRef, useEffect } from 'react';"
  );

  c = c.replace(
    '  const [showReportModal, setShowReportModal] = useState(false);\r\n\r\n  const selectedFolder',
    `  const [showReportModal, setShowReportModal] = useState(false);
${hook}
  const selectedFolder`
  );

  const persistFile = `const persistFile = useCallback(
    async (file) => {
      if (!groupId || !file) return;
      await saveWorkspaceFile(groupId, file);
    },
    [groupId]
  );`;

  c = c.replace('  const selectedFolder = folders.find', `${persistFile}

  const selectedFolder = folders.find`);

  c = c.replace(
    `      const entry = createVersionEntry(userName, summary, opts);
      setVersionHistory((vh) => ({ ...vh, [fileId]: [entry, ...(vh[fileId] || [])].slice(0, 25) }));`,
    `      const entry = createVersionEntry(userName, summary, opts);
      setVersionHistory((vh) => ({ ...vh, [fileId]: [entry, ...(vh[fileId] || [])].slice(0, 25) }));
      if (groupId) saveDocumentVersion(groupId, fileId, entry).catch(() => {});`
  );

  c = c.replace(
    '    [userName]',
    '    [userName, groupId]'
  );

  // openFileHandler - load document from firestore
  c = c.replace(
    `    setEditorContent(initial);
    setEditorHtml(initialHtml);
    contentBeforeEditRef.current = initial;
    setSubmissionReport(null);
    pushActivity?.(userName, readOnly ? \`viewed \${file.name}\` : \`opened \${file.name}\`);`,
    `    setEditorContent(initial);
    setEditorHtml(initialHtml);
    contentBeforeEditRef.current = initial;
    setSubmissionReport(null);
    if (file.type === 'document') {
      getDocumentContent(file.id).then((doc) => {
        if (doc?.text) {
          setEditorContent(doc.text);
          contentBeforeEditRef.current = doc.text;
        }
        if (doc?.html) {
          setEditorHtml(doc.html);
        }
      });
    }
    pushActivity?.(userName, readOnly ? \`viewed \${file.name}\` : \`opened \${file.name}\`);`
  );

  c = c.replace(
    `        userId: currentUser?.email || userName,
        fileId: openFile.id,
        groupId: currentUser?.groupId || 'default-group',`,
    `        userId: currentUser?.uid || currentUser?.email || userName,
        fileId: openFile.id,
        groupId: groupId || currentUser?.groupId,`
  );

  c = c.replace(
    `        userId: currentUser?.email || userName,
        fileId: openFile.id,
        groupId: currentUser?.groupId || 'default-group',
        fileName: openFile.name,`,
    `        userId: currentUser?.uid || currentUser?.email || userName,
        fileId: openFile.id,
        groupId: groupId || currentUser?.groupId,
        fileName: openFile.name,`
  );

  c = c.replace(
    `        userId: currentUser?.email || userName,
        fileId: openFile.id,
        groupId: currentUser?.groupId || 'default-group',
      });`,
    `        userId: currentUser?.uid || currentUser?.email || userName,
        fileId: openFile.id,
        groupId: groupId || currentUser?.groupId,
      });`
  );

  // createFile - persist
  c = c.replace(
    `    setFolders((prev) =>
      prev.map((f) => (f.id === selectedFolder.id ? { ...f, files: [...f.files, file] } : f))
    );
    pushToast?.('File created successfully');`,
    `    setFolders((prev) =>
      prev.map((f) => (f.id === selectedFolder.id ? { ...f, files: [...f.files, file] } : f))
    );
    persistFile(file);
    pushToast?.('File created successfully');`
  );

  // onBlurSave - persist document
  c = c.replace(
    `    setOpenFile((f) =>
      f?.id === openFile.id ? { ...f, content: editorContent, contentHtml: htmlSnap ?? f.contentHtml } : f
    );
  };`,
    `    setOpenFile((f) =>
      f?.id === openFile.id ? { ...f, content: editorContent, contentHtml: htmlSnap ?? f.contentHtml } : f
    );
    const updated = {
      ...openFile,
      content: editorContent,
      contentHtml: htmlSnap ?? openFile.contentHtml,
      lastEditedBy: userName,
      lastEditedAt: Date.now(),
      modified: 'just now',
    };
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
  };`
  );

  // delete file
  c = c.replace(
    `      if (openFile?.id === confirmDelete.id) {
        setOpenFile(null);
        setIsMinimized(false);
        setIsMaximized(false);
      }
    } else {`,
    `      if (openFile?.id === confirmDelete.id) {
        setOpenFile(null);
        setIsMinimized(false);
        setIsMaximized(false);
      }
      if (groupId) deleteWorkspaceFile(groupId, confirmDelete.id).catch(() => {});
    } else {`
  );

  // submit - persist locked file
  c = c.replace(
    `      setOpenFile((f) => (f ? { ...f, submitted: true, content: text, contentHtml: html } : f));
      saveVersion(openFile.id, 'Submitted for review', { changeType: 'import', content: text, previousContent: '' });`,
    `      const submittedFile = { ...openFile, submitted: true, content: text, contentHtml: html, lastEditedBy: userName, lastEditedAt: Date.now() };
      setOpenFile((f) => (f ? submittedFile : f));
      persistFile(submittedFile);
      if (groupId && currentUser?.uid) {
        saveDocumentContent({ fileId: openFile.id, userId: currentUser.uid, groupId, html, text }).catch(() => {});
      }
      saveVersion(openFile.id, 'Submitted for review', { changeType: 'import', content: text, previousContent: '' });`
  );

  fs.writeFileSync(p, c);
  console.log('workspace migrated');
} else {
  console.log('workspace already has groupId');
}
