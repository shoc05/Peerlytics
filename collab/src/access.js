// Who may open which document, and whether they may write. Pure functions; the same rules
// as firestore.rules for workspace content (see docs/auth-contract.md for roles).

// One Yjs document per workspace file: "group:<groupId>:file:<fileId>".
const DOC_NAME = /^group:([A-Za-z0-9_-]{1,128}):file:([A-Za-z0-9_-]{1,128})$/;

export function documentName(groupId, fileId) {
  return `group:${groupId}:file:${fileId}`;
}

export function parseDocumentName(name) {
  const m = DOC_NAME.exec(String(name || ''));
  return m ? { groupId: m[1], fileId: m[2] } : null;
}

/**
 * Returns { allow: false, reason } or { allow: true, readOnly }.
 * - Student members write, until the file is submitted or the workspace is locked.
 * - A lecturer of the group reads only after a student submitted to them, and never writes.
 * - Everyone else is refused.
 */
export function decideAccess({ uid, role, group, file }) {
  if (!uid) return { allow: false, reason: 'NO_TOKEN' };
  if (!group) return { allow: false, reason: 'NO_WORKSPACE' };
  if (!file) return { allow: false, reason: 'NO_FILE' };

  const memberIds = group.memberIds || [];
  const lecturerIds = group.lecturerIds || [];
  const submittedTo = group.submittedToLecturers || [];

  if (role !== 'lecturer' && memberIds.includes(uid)) {
    return { allow: true, readOnly: group.locked === true || file.submitted === true };
  }
  if (role === 'lecturer' && lecturerIds.includes(uid) && submittedTo.includes(uid)) {
    return { allow: true, readOnly: true };
  }
  if (role === 'lecturer' && lecturerIds.includes(uid)) {
    return { allow: false, reason: 'NOT_SUBMITTED' };
  }
  return { allow: false, reason: 'NOT_A_MEMBER' };
}
