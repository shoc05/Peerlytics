export const APA_STYLE = {
  fontFamily: '"Times New Roman", Times, serif',
  fontSize: '12pt',
  lineHeight: 2,
  textAlign: 'left',
};

export const getDefaultFileContent = () => '';

/**
 * Format an active-time value (stored in MINUTES) into exact, human-readable units:
 *   < 1 min  → "Ns" (seconds)
 *   < 60 min → "N min"
 *   >= 60    → "Hh Mm" (or "Hh" when no remainder)
 */
export function formatDuration(minutes) {
  const m = Number(minutes) || 0;
  if (m <= 0) return '0 min';
  if (m < 1) {
    const secs = Math.max(1, Math.round(m * 60));
    return `${secs} sec${secs === 1 ? '' : 's'}`;
  }
  if (m < 60) {
    const mins = Math.round(m);
    return `${mins} min${mins === 1 ? '' : 's'}`;
  }
  const hrs = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/** Lecturers may open student-submitted files only (not their own uploads). */
export const isStudentWorkspaceFile = (file, lecturerName) => {
  if (!file) return false;
  if (file.createdBy && file.createdBy === lecturerName) return false;
  return Boolean(file.createdBy || file.lastEditedBy);
};

export const buildInitialFolders = () => [
  { id: 'folder-project', name: 'Project Files', files: [] },
  { id: 'folder-resources', name: 'Resources', files: [] },
];

export const formatActivityTime = (date = new Date()) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Consistent day/month/year formatting across the app (e.g. 14/06/2026), regardless of
// the browser locale. Accepts a Date, ISO string, or ms timestamp; returns '' if invalid.
export const formatDate = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Same dd/mm/yyyy date plus HH:MM time (e.g. 14/06/2026 15:30).
export const formatDateTime = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const formatRelativeTime = (ts) => {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return formatActivityTime(new Date(ts));
};

export const createActivityEntry = (user, action, extra = {}) => ({
  id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  user,
  action,
  timestamp: Date.now(),
  time: 'just now',
  ...extra,
});

export const createVersionEntry = (user, summary, opts = {}) => ({
  id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  user,
  timestamp: Date.now(),
  summary,
  displayTime: formatActivityTime(),
  changeType: opts.changeType || 'edit',
  content: opts.content ?? '',
  previousContent: opts.previousContent ?? '',
  pasteRanges: opts.pasteRanges ?? [],
});

export const CHANGE_TYPE_LABELS = {
  'paste-large': 'Large paste',
  'paste-small': 'Small paste',
  paste: 'Pasted content',
  edit: 'Edited',
  open: 'Opened',
  import: 'Submitted',
};

const HIGHLIGHT_KIND = {
  'paste-large': 'paste',
  'paste-small': 'insert',
  paste: 'paste',
  edit: 'insert',
};

export const renderVersionContent = (content, { pasteRanges = [], changeType, previousContent = '' }) => {
  if (!content) return null;
  const pasteKind = HIGHLIGHT_KIND[changeType] || (changeType?.startsWith('paste') ? 'paste' : 'normal');
  if ((changeType === 'paste' || changeType === 'paste-large' || changeType === 'paste-small') && pasteRanges.length > 0) {
    const parts = [];
    let cursor = 0;
    const sorted = [...pasteRanges].sort((a, b) => a.start - b.start);
    sorted.forEach((range) => {
      if (range.start > cursor) parts.push({ text: content.slice(cursor, range.start), kind: 'normal' });
      parts.push({ text: content.slice(range.start, range.end), kind: pasteKind });
      cursor = range.end;
    });
    if (cursor < content.length) parts.push({ text: content.slice(cursor), kind: 'normal' });
    return parts;
  }
  if (changeType === 'edit' && previousContent && previousContent !== content) {
    const minLen = Math.min(previousContent.length, content.length);
    let diffStart = 0;
    while (diffStart < minLen && previousContent[diffStart] === content[diffStart]) diffStart++;
    let prevEnd = previousContent.length;
    let nextEnd = content.length;
    while (prevEnd > diffStart && nextEnd > diffStart && previousContent[prevEnd - 1] === content[nextEnd - 1]) {
      prevEnd--;
      nextEnd--;
    }
    const parts = [];
    if (diffStart > 0) parts.push({ text: content.slice(0, diffStart), kind: 'normal' });
    if (nextEnd > diffStart) parts.push({ text: content.slice(diffStart, nextEnd), kind: 'insert' });
    if (nextEnd < content.length) parts.push({ text: content.slice(nextEnd), kind: 'normal' });
    return parts.length ? parts : [{ text: content, kind: 'normal' }];
  }
  return [{ text: content, kind: 'normal' }];
};

export const FILE_TYPE_LABELS = {
  document: 'Document',
  presentation: 'Presentation',
  spreadsheet: 'Spreadsheet',
  code: 'Code',
};

export const newFileFromType = (type, folderId, name, createdBy = null) => {
  const id = `file-${Date.now()}`;
  const defaults = {
    document: 'Untitled Document',
    presentation: 'Untitled Presentation',
    spreadsheet: 'Untitled Spreadsheet',
    code: 'untitled.py',
  };
  return {
    id,
    type,
    name: name || defaults[type] || 'Untitled',
    size: '0 KB',
    modified: 'just now',
    difficulty: type === 'code' ? 3 : type === 'document' ? 2 : type === 'spreadsheet' ? 1.5 : 1,
    folderId,
    createdBy,
    content: getDefaultFileContent(type),
    lastEditedBy: createdBy,
    lastEditedAt: createdBy ? Date.now() : null,
  };
};
