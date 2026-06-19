import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  subscribeWorkspace,
  saveWorkspaceFile,
  saveWorkspaceFolder,
  deleteWorkspaceFile,
  deleteWorkspaceFolder,
  deleteWorkspace,
  updateWorkspace,
  subscribeGroupMembers,
  inviteLecturerByEmail,
  inviteMemberByEmail,
} from '../firebase/firestoreService';
import FileTypeBadge from './FileTypeBadge';
import { logger } from '../utils/logger';

const FILE_TYPE_COLORS = { document: '#4285f4', spreadsheet: '#217346', presentation: '#d24726' };
const FILE_TYPES = [
  { type: 'document', label: 'Document' },
  { type: 'spreadsheet', label: 'Spreadsheet' },
  { type: 'presentation', label: 'Presentation' },
];

// Convert a stored deadline into the value a datetime-local input expects.
const toLocalInput = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};

export default function WorkspaceDrive({
  workspaceId,
  workspace,
  darkMode = false,
  currentUser,
  pushToast,
  pushActivity,
  onOpenFile,
  onDelete,
}) {
  const [tree, setTree] = useState([]); // array of folders, with .folders and .rootFiles props
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('files'); // 'files' | 'members' | 'settings'
  const [currentFolderId, setCurrentFolderId] = useState(null); // null = root (desktop)

  const [createFile, setCreateFile] = useState(null); // { type } when the New-file modal is open
  const [newFileName, setNewFileName] = useState('');
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState(null); // { type, id }
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // { type, id, name }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, kind, item }
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [deadlineInput, setDeadlineInput] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);

  const isReadOnly = currentUser?.role === 'lecturer';

  useEffect(() => {
    if (!workspaceId) return undefined;
    return subscribeWorkspace(workspaceId, (next) => setTree(next));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    return subscribeGroupMembers(workspaceId, setMembers);
  }, [workspaceId]);

  useEffect(() => { setDeadlineInput(toLocalInput(workspace?.deadline)); }, [workspace?.deadline]);

  // Close context menu on any outside click / scroll.
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [contextMenu]);

  const folders = tree.folders || tree || [];
  const rootFiles = tree.rootFiles || [];
  const currentFolder = currentFolderId ? folders.find((f) => f.id === currentFolderId) : null;

  // Desktop items in view: at root → folders + root files; inside a folder → that folder's files.
  const items = useMemo(() => {
    if (currentFolder) {
      return (currentFolder.files || []).map((f) => ({ kind: 'file', ...f }));
    }
    return [
      ...folders.map((f) => ({ kind: 'folder', ...f })),
      ...rootFiles.map((f) => ({ kind: 'file', ...f })),
    ];
  }, [currentFolder, folders, rootFiles]);

  const bg = darkMode ? '#0d0d0d' : '#ffffff';
  const panel = darkMode ? 'rgba(28, 28, 28, 0.6)' : '#f7f8fc';
  const txt = darkMode ? '#ededed' : '#1a1a1a';
  const sub = darkMode ? '#9a9a9a' : '#666';
  const border = darkMode ? '#2e2e2e' : '#e0e0e0';

  const doCreateFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) { pushToast?.('File needs a name'); return; }
    const file = {
      id: `file-${Date.now()}`,
      name,
      type: createFile?.type || 'document',
      folderId: currentFolderId || null, // null → lives at root (desktop)
      ownerId: currentUser?.uid || null,
      ownerName: currentUser?.name || null,
      content: '', contentHtml: '', submitted: false,
      createdAt: Date.now(), lastEditedAt: Date.now(),
    };
    try {
      await saveWorkspaceFile(workspaceId, file);
      pushToast?.('File created');
      await pushActivity?.(`${currentUser?.name || 'User'} created "${file.name}"`);
      setCreateFile(null); setNewFileName('');
      onOpenFile?.(file);
    } catch (err) { pushToast?.(err.message || 'Could not create file'); }
  }, [newFileName, createFile, currentFolderId, workspaceId, currentUser, pushToast, pushActivity, onOpenFile]);

  const doCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { pushToast?.('Folder needs a name'); return; }
    try {
      await saveWorkspaceFolder(workspaceId, { id: `folder-${Date.now()}`, name, order: folders.length });
      pushToast?.('Folder created');
      setShowCreateFolder(false); setNewFolderName('');
    } catch (err) { pushToast?.(err.message || 'Could not create folder'); }
  }, [newFolderName, folders.length, workspaceId, pushToast]);

  const doRename = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      if (renameTarget.type === 'file') {
        const file = items.find((i) => i.kind === 'file' && i.id === renameTarget.id)
          || folders.flatMap((f) => f.files || []).find((f) => f.id === renameTarget.id)
          || rootFiles.find((f) => f.id === renameTarget.id);
        if (file) { const { kind, ...data } = file; await saveWorkspaceFile(workspaceId, { ...data, name }); }
      } else {
        const folder = folders.find((f) => f.id === renameTarget.id);
        if (folder) await saveWorkspaceFolder(workspaceId, { ...folder, name });
      }
      setRenameTarget(null); setRenameValue('');
    } catch (err) { pushToast?.(err.message || 'Rename failed'); }
  }, [renameTarget, renameValue, items, folders, rootFiles, workspaceId, pushToast]);

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === 'file') {
        await deleteWorkspaceFile(workspaceId, confirmDelete.id);
        await pushActivity?.(`${currentUser?.name || 'User'} deleted "${confirmDelete.name}"`);
      } else if (confirmDelete.type === 'folder') {
        await deleteWorkspaceFolder(workspaceId, confirmDelete.id);
        if (currentFolderId === confirmDelete.id) setCurrentFolderId(null);
      } else if (confirmDelete.type === 'workspace') {
        await deleteWorkspace(workspaceId);
        setConfirmDelete(null); onDelete?.(); return;
      }
      setConfirmDelete(null);
    } catch (err) { pushToast?.(err.message || 'Delete failed — check permissions'); }
  }, [confirmDelete, workspaceId, currentFolderId, currentUser, pushActivity, pushToast, onDelete]);

  const doDuplicate = useCallback(async (file) => {
    if (!file?.id || isReadOnly) return;
    const { kind, files: _f, ...data } = file;
    try {
      await saveWorkspaceFile(workspaceId, { ...data, id: `file-${Date.now()}`, name: `${file.name} (copy)`, submitted: false, lastEditedAt: Date.now() });
      pushToast?.('File duplicated');
    } catch (err) { pushToast?.(err.message || 'Duplicate failed'); }
  }, [isReadOnly, workspaceId, pushToast]);

  const doSaveDeadline = useCallback(async () => {
    setSavingDeadline(true);
    try {
      await updateWorkspace(workspaceId, { deadline: deadlineInput ? new Date(deadlineInput).toISOString() : null });
      pushToast?.('Deadline updated');
    } catch (err) { pushToast?.(err.message || 'Could not update deadline'); }
    finally { setSavingDeadline(false); }
  }, [workspaceId, deadlineInput, pushToast]);

  const handleInvite = useCallback(async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    try {
      const inviter = { invitedByName: currentUser?.name || 'Someone', invitedByUid: currentUser?.uid, workspaceName: workspace?.name };
      if (inviteRole === 'lecturer') { await inviteLecturerByEmail(workspaceId, email, inviter); pushToast?.('Lecturer invited — they were notified'); }
      else { await inviteMemberByEmail(workspaceId, email, inviter); pushToast?.('Member invited — they were notified'); }
      setInviteEmail('');
    } catch (err) { pushToast?.(err.message || 'Invite failed'); }
  }, [inviteEmail, inviteRole, currentUser, workspace, workspaceId, pushToast]);

  const openItem = (item) => {
    if (item.kind === 'folder') setCurrentFolderId(item.id);
    else onOpenFile?.(item);
  };
  const openCtx = (e, kind, item) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, kind, item }); };
  const openEmptyCtx = (e) => {
    if (isReadOnly) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'empty' });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: bg, color: txt }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', borderBottom: `1px solid ${border}` }}>
        <div style={{ fontSize: 16, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {workspace?.name || 'Workspace'}
        </div>
        <div style={{ display: 'flex', gap: 4, background: panel, borderRadius: 8, padding: 3 }}>
          {['files', 'members', 'settings'].map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              style={{
                background: tab === t ? 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)' : 'transparent',
                color: tab === t ? '#fff' : sub, border: 'none', borderRadius: 6, padding: '6px 12px',
                cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
              }}>
              {t === 'members' ? `Members (${members.length})` : t === 'settings' ? 'Settings' : 'Files'}
            </button>
          ))}
        </div>
      </div>

      {/* FILES (desktop) */}
      {tab === 'files' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Breadcrumb + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderBottom: `1px solid ${border}` }}>
            <div style={{ fontSize: 14, fontWeight: 600, flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" onClick={() => setCurrentFolderId(null)}
                style={{ background: 'none', border: 'none', color: currentFolder ? '#1D9E75' : txt, fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: 0 }}>
                {workspace?.name || 'Workspace'}
              </button>
              {currentFolder && <><span style={{ color: sub }}>/</span><span>{currentFolder.name}</span></>}
            </div>
            {!isReadOnly && (
              <>
                <button type="button" onClick={() => setShowCreateFolder(true)}
                  style={{ background: 'transparent', border: `1px solid ${border}`, color: txt, borderRadius: 6, fontSize: 12, padding: '6px 12px', cursor: 'pointer' }}>
                  + Folder
                </button>
                <button type="button" onClick={() => { setNewFileName(''); setCreateFile({ type: 'document' }); }}
                  style={{ background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer' }}>
                  + New file
                </button>
              </>
            )}
          </div>

          {/* Desktop surface — right-click empty space for the create menu */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 22 }} onContextMenu={openEmptyCtx}>
            {items.length === 0 ? (
              <div
                onContextMenu={openEmptyCtx}
                style={{ color: sub, fontSize: 13, textAlign: 'center', padding: '60px 0', border: `1px dashed ${border}`, borderRadius: 12 }}
              >
                {currentFolder ? 'This folder is empty.' : 'Empty workspace.'}
                {!isReadOnly && <div style={{ marginTop: 6, fontSize: 12 }}>Right-click here, or use “+ New file” / “+ Folder”.</div>}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
                {items.map((item) => (
                  <div
                    key={`${item.kind}-${item.id}`}
                    onDoubleClick={() => openItem(item)}
                    onClick={(e) => { if (e.detail === 1 && item.kind === 'file') { /* single-click selects; open on dbl */ } }}
                    onContextMenu={(e) => openCtx(e, item.kind, item)}
                    title={item.kind === 'folder' ? `Open folder “${item.name}”` : `Open “${item.name}”`}
                    style={{
                      position: 'relative', padding: 14, borderRadius: 10, border: `1px solid ${border}`,
                      background: panel, cursor: 'pointer', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <FileTypeBadge type={item.kind === 'folder' ? 'folder' : item.type} size={40} />
                      {item.kind === 'folder' && (
                        <span style={{ position: 'absolute', bottom: -4, right: -8, fontSize: 9, color: sub, background: bg, padding: '0 4px', borderRadius: 3 }}>
                          {item.files?.length || 0}
                        </span>
                      )}
                      {item.submitted && <span style={{ position: 'absolute', top: -4, right: -8, fontSize: 9, fontWeight: 700, color: '#c5221f', background: '#fce8e6', padding: '1px 4px', borderRadius: 3 }}>LOCKED</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{item.name}</div>
                    <div style={{ fontSize: 10, color: sub, textTransform: 'capitalize' }}>{item.kind === 'folder' ? 'Folder' : item.type}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MEMBERS */}
      {tab === 'members' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          {!isReadOnly && (
            <div style={{ padding: 14, border: `1px solid ${border}`, borderRadius: 10, background: panel, marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: txt, marginBottom: 8 }}>Invite</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()} placeholder="someone@email.com"
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: `1px solid ${border}`, background: bg, color: txt, fontSize: 13 }} />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${border}`, background: bg, color: txt, fontSize: 13 }}>
                  <option value="member">Member</option>
                  <option value="lecturer">Lecturer</option>
                </select>
                <button type="button" onClick={handleInvite}
                  style={{ background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }}>
                  Invite
                </button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.length === 0 ? (
              <div style={{ color: sub, fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No members yet.</div>
            ) : members.map((m) => (
              <div key={m.id || m.uid} style={{ padding: '10px 14px', border: `1px solid ${border}`, borderRadius: 8, background: panel, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: txt }}>{m.name || m.email}</span>
                <span style={{ fontSize: 11, color: sub, textTransform: 'capitalize' }}>{m.role || 'member'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SETTINGS */}
      {tab === 'settings' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          <div style={{ padding: 16, border: `1px solid ${border}`, borderRadius: 10, background: panel, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: txt, marginBottom: 12 }}>Workspace</div>
            <div style={{ fontSize: 13, color: sub, marginBottom: 14 }}>Name: <span style={{ color: txt, fontWeight: 600 }}>{workspace?.name || '—'}</span></div>
            <label style={{ display: 'block', fontSize: 12, color: sub, marginBottom: 6 }}>Submission deadline</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="datetime-local"
                value={deadlineInput}
                disabled={isReadOnly}
                onChange={(e) => setDeadlineInput(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${border}`, background: bg, color: txt, fontSize: 13 }}
              />
              {!isReadOnly && (
                <>
                  <button type="button" onClick={doSaveDeadline} disabled={savingDeadline}
                    style={{ background: savingDeadline ? '#9aa0a6' : 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '8px 16px', cursor: savingDeadline ? 'not-allowed' : 'pointer' }}>
                    {savingDeadline ? 'Saving…' : 'Save deadline'}
                  </button>
                  {deadlineInput && (
                    <button type="button" onClick={() => { setDeadlineInput(''); }}
                      style={{ background: 'transparent', color: sub, border: `1px solid ${border}`, borderRadius: 6, fontSize: 12, padding: '8px 12px', cursor: 'pointer' }}>
                      Clear
                    </button>
                  )}
                </>
              )}
            </div>
            <div style={{ fontSize: 11, color: sub, marginTop: 8 }}>Auto-submit triggers around this deadline; leaving it empty disables auto-submit.</div>
          </div>

          {!isReadOnly && (
            <div style={{ padding: 14, border: `1px solid rgba(231,76,60,0.3)`, borderRadius: 10, background: 'rgba(231,76,60,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e74c3c' }}>Danger zone</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>Permanently delete this workspace and all its files.</div>
              </div>
              <button type="button" onClick={() => setConfirmDelete({ type: 'workspace', id: workspaceId, name: workspace?.name })}
                style={{ background: 'transparent', border: '1px solid #e74c3c', color: '#e74c3c', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                Delete workspace
              </button>
            </div>
          )}
        </div>
      )}

      {/* CREATE FILE MODAL */}
      {createFile && (
        <Modal onClose={() => setCreateFile(null)} onConfirm={doCreateFile} darkMode={darkMode} title={`New file${currentFolder ? ` in “${currentFolder.name}”` : ''}`}>
          <input type="text" placeholder="File name" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} autoFocus style={inputStyle(darkMode)} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
            {FILE_TYPES.map((t) => (
              <button key={t.type} type="button" onClick={() => setCreateFile({ type: t.type })}
                style={{
                  padding: 10, borderRadius: 8, cursor: 'pointer',
                  border: `2px solid ${createFile.type === t.type ? FILE_TYPE_COLORS[t.type] : (darkMode ? '#2e2e2e' : '#e0e0e0')}`,
                  background: 'transparent', color: darkMode ? '#ededed' : '#1a1a1a',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}>
                <FileTypeBadge type={t.type} size={32} />
                <span style={{ fontSize: 11, fontWeight: 600 }}>{t.label}</span>
              </button>
            ))}
          </div>
          <ModalActions onCancel={() => setCreateFile(null)} onConfirm={doCreateFile} confirmLabel="Create" />
        </Modal>
      )}

      {/* CREATE FOLDER MODAL */}
      {showCreateFolder && (
        <Modal onClose={() => setShowCreateFolder(false)} onConfirm={doCreateFolder} darkMode={darkMode} title="New folder">
          <input type="text" placeholder="Folder name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} autoFocus style={inputStyle(darkMode)} />
          <ModalActions onCancel={() => setShowCreateFolder(false)} onConfirm={doCreateFolder} confirmLabel="Create" />
        </Modal>
      )}

      {/* RENAME MODAL */}
      {renameTarget && (
        <Modal onClose={() => setRenameTarget(null)} onConfirm={doRename} darkMode={darkMode} title="Rename">
          <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus style={inputStyle(darkMode)} />
          <ModalActions onCancel={() => setRenameTarget(null)} onConfirm={doRename} confirmLabel="Rename" />
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)} onConfirm={doDelete} darkMode={darkMode} title={`Delete ${confirmDelete.type}?`}>
          <div style={{ color: darkMode ? '#ededed' : '#1a1a1a', fontSize: 13 }}>
            <strong>“{confirmDelete.name || confirmDelete.id}”</strong> will be permanently deleted. This cannot be undone.
          </div>
          <ModalActions onCancel={() => setConfirmDelete(null)} onConfirm={doDelete} confirmLabel="Delete" danger />
        </Modal>
      )}

      {/* CONTEXT MENU */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x,
            background: darkMode ? '#1c1c1c' : '#ffffff', border: `1px solid ${border}`, borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)', padding: 6, minWidth: 170, zIndex: 1000, color: txt,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.kind === 'empty' && (
            <>
              <CtxItem label="New file" onClick={() => { setNewFileName(''); setCreateFile({ type: 'document' }); setContextMenu(null); }} />
              <CtxItem label="New folder" onClick={() => { setShowCreateFolder(true); setContextMenu(null); }} />
            </>
          )}
          {contextMenu.kind === 'file' && (
            <>
              <CtxItem label="Open" onClick={() => { onOpenFile?.(contextMenu.item); setContextMenu(null); }} />
              {!isReadOnly && <CtxItem label="Rename" onClick={() => { setRenameTarget({ type: 'file', id: contextMenu.item.id }); setRenameValue(contextMenu.item.name); setContextMenu(null); }} />}
              {!isReadOnly && <CtxItem label="Duplicate" onClick={() => { doDuplicate(contextMenu.item); setContextMenu(null); }} />}
              {!isReadOnly && <CtxItem label="Delete" danger onClick={() => { setConfirmDelete({ type: 'file', id: contextMenu.item.id, name: contextMenu.item.name }); setContextMenu(null); }} />}
            </>
          )}
          {contextMenu.kind === 'folder' && (
            <>
              <CtxItem label="Open" onClick={() => { setCurrentFolderId(contextMenu.item.id); setContextMenu(null); }} />
              {!isReadOnly && <CtxItem label="Rename" onClick={() => { setRenameTarget({ type: 'folder', id: contextMenu.item.id }); setRenameValue(contextMenu.item.name); setContextMenu(null); }} />}
              {!isReadOnly && <CtxItem label="Delete" danger onClick={() => { setConfirmDelete({ type: 'folder', id: contextMenu.item.id, name: contextMenu.item.name }); setContextMenu(null); }} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function inputStyle(darkMode) {
  return {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
    background: darkMode ? 'rgba(255,255,255,0.04)' : '#f7f8fc',
    color: darkMode ? '#ededed' : '#1a1a1a', fontSize: 14, boxSizing: 'border-box', outline: 'none',
  };
}

// Modal supports keyboard: Enter = confirm, Esc = cancel.
function Modal({ children, onClose, onConfirm, darkMode, title }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); }
      else if (e.key === 'Enter' && onConfirm) {
        // Don't hijack Enter inside a multiline field (none here, but safe).
        if (e.target?.tagName !== 'TEXTAREA') { e.preventDefault(); onConfirm(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onConfirm]);

  return (
    <div onClick={onClose} className="pl-fade-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} className="pl-modal-enter"
        style={{ width: 'min(420px, 92vw)', background: darkMode ? '#0d0d0d' : '#ffffff', color: darkMode ? '#ededed' : '#1a1a1a', border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`, borderRadius: 14, padding: 22 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onCancel, onConfirm, confirmLabel, danger = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
      <button type="button" onClick={onCancel}
        style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', color: '#888', border: `1px solid #888`, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Cancel <span style={{ opacity: 0.6, fontSize: 11 }}>Esc</span>
      </button>
      <button type="button" onClick={onConfirm}
        style={{ padding: '8px 16px', borderRadius: 8, background: danger ? '#e74c3c' : 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        {confirmLabel} <span style={{ opacity: 0.7, fontSize: 11 }}>↵</span>
      </button>
    </div>
  );
}

function CtxItem({ label, onClick, danger }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: danger ? '#e74c3c' : 'inherit', textAlign: 'left' }}>
      {label}
    </button>
  );
}
