import React, { useMemo, useState } from 'react';
import { formatDate, formatDateTime } from '../utils/workspaceHelpers';

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFilename(name) {
  return String(name || 'submission').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

function submissionTime(sub) {
  if (sub.submittedAt) return new Date(sub.submittedAt).getTime();
  if (sub.createdAt?.toMillis) return sub.createdAt.toMillis();
  if (typeof sub.createdAt === 'number') return sub.createdAt;
  return 0;
}

const STATUS_META = {
  reviewed: { ring: 'ring-brand-500/30', text: 'text-brand-500', bg: 'bg-brand-500/15', label: 'Reviewed' },
  submitted: { ring: 'ring-sky-400/30', text: 'text-sky-400', bg: 'bg-sky-400/15', label: 'Submitted' },
  pending: { ring: 'ring-amber-400/30', text: 'text-amber-400', bg: 'bg-amber-400/15', label: 'Pending' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.pending;
}

const FolderIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const DownloadIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

const ReportIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </svg>
);

const TrashIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
  </svg>
);

export default function StoragePanel({
  submissions = [],
  workspaces = [],
  isLecturer = false,
  darkMode = false,
  selectedSubmission,
  onSelectSubmission,
  onOpenReport,
  onMarkReviewed,
  onDelete,
  pushToast,
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirmDelete, setConfirmDelete] = useState(null); // submission pending deletion

  const workspaceLookup = useMemo(() => {
    const map = new Map();
    for (const ws of workspaces) map.set(ws.id, ws);
    return map;
  }, [workspaces]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      if (statusFilter !== 'all' && (s.status || 'pending') !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        s.fileName, s.folderName,
        s.submittedByName, s.submittedBy,
        workspaceLookup.get(s.workspaceId)?.name,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [submissions, search, statusFilter, workspaceLookup]);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const sub of filtered) {
      const key = sub.workspaceId || '_unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(sub);
    }
    const list = [];
    for (const [workspaceId, items] of groups) {
      items.sort((a, b) => submissionTime(b) - submissionTime(a));
      const ws = workspaceLookup.get(workspaceId);
      const latest = items[0] ? submissionTime(items[0]) : 0;
      list.push({
        workspaceId,
        name: ws?.name || (workspaceId === '_unassigned' ? 'Unassigned' : workspaceId),
        deadline: ws?.deadline || null,
        items,
        latest,
      });
    }
    list.sort((a, b) => b.latest - a.latest);
    return list;
  }, [filtered, workspaceLookup]);

  const total = submissions.length;
  const counts = useMemo(() => {
    const c = { submitted: 0, reviewed: 0, pending: 0 };
    for (const s of submissions) {
      const st = s.status || 'pending';
      if (c[st] !== undefined) c[st]++;
    }
    return c;
  }, [submissions]);

  const handleDownload = (s) => {
    const html = s.documentContent || '';
    if (!html) {
      pushToast?.('Nothing to download — submission has no content');
      return;
    }
    const base = sanitizeFilename(s.fileName || s.folderName || 'submission');
    const isHtml = /<[a-z][^>]*>/i.test(html);
    if (isHtml) {
      const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${base}</title></head><body>${html}</body></html>`;
      downloadBlob(`${base}.html`, 'text/html;charset=utf-8', wrapped);
    } else {
      downloadBlob(`${base}.txt`, 'text/plain;charset=utf-8', html);
    }
  };

  const surfaceCard = darkMode ? 'bg-ink-800/70 border-ink-700' : 'bg-white border-slate-200';
  const surfaceHeader = darkMode ? 'bg-brand-500/10 border-ink-700' : 'bg-brand-50 border-slate-200';
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  const txt = darkMode ? 'text-ink-100' : 'text-slate-900';
  const inputCls = darkMode
    ? 'bg-ink-800/70 text-ink-100 border-ink-700 placeholder-ink-400 focus:border-brand-500'
    : 'bg-white text-slate-900 border-slate-200 placeholder-slate-400 focus:border-brand-500';

  return (
    <div className={`p-8 overflow-auto ${txt}`}>
      <h1 className="m-0 mb-2 text-[26px] font-bold tracking-tight">Submitted Work</h1>
      <p className={`m-0 mb-6 text-[13px] ${sub}`}>
        {isLecturer
          ? 'Submissions sent to you, organized by project. Select one to unlock analytics and grading.'
          : 'Files and folders you\'ve submitted, organized by project. Open or download to review.'}
      </p>

      <div className="flex gap-3 mb-5 flex-wrap">
        <StatPill label="Total" value={total} accent="brand" darkMode={darkMode} />
        <StatPill label="Pending" value={counts.pending} accent="warn" darkMode={darkMode} />
        <StatPill label="Submitted" value={counts.submitted} accent="info" darkMode={darkMode} />
        <StatPill label="Reviewed" value={counts.reviewed} accent="brand" darkMode={darkMode} />
      </div>

      <div className="flex gap-2.5 mb-5 flex-wrap">
        <input
          type="text"
          placeholder="Search by file, sender or project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`flex-1 min-w-[220px] px-3 py-2.5 rounded-lg border text-[13px] outline-none transition focus:ring-4 focus:ring-brand-500/15 ${inputCls}`}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`px-3 py-2.5 rounded-lg border text-[13px] outline-none transition focus:ring-4 focus:ring-brand-500/15 cursor-pointer ${inputCls}`}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="reviewed">Reviewed</option>
        </select>
      </div>

      {grouped.length === 0 ? (
        <div className={`text-center py-16 px-6 ${sub}`}>
          <div className={`text-base font-bold mb-2 ${txt}`}>
            {total === 0 ? 'No submissions yet' : 'No matches'}
          </div>
          <div className="text-[13px]">
            {total === 0
              ? (isLecturer
                  ? 'Students will appear here after they submit work.'
                  : 'Use the Submit button inside a file to send work to your lecturer.')
              : 'Adjust your search or filter to see more.'}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((group) => (
            <div key={group.workspaceId}>
              <div className={`${surfaceHeader} border border-l-4 border-l-brand-500 rounded-xl px-4 py-2.5 flex items-center justify-between gap-2.5 mb-2.5`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderIcon className="w-4 h-4 text-brand-500 flex-shrink-0" />
                  <span className={`text-sm font-bold truncate ${txt}`}>{group.name}</span>
                  <span className={`text-[11px] whitespace-nowrap ${sub}`}>
                    · {group.items.length} submission{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                {group.deadline && (
                  <span className={`text-[11px] whitespace-nowrap ${sub}`}>Due {formatDate(group.deadline)}</span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {group.items.map((s) => {
                  const isSelected = selectedSubmission?.id === s.id;
                  const m = statusMeta(s.status);
                  return (
                    <div
                      key={s.id}
                      onClick={() => onSelectSubmission?.(s, isSelected)}
                      className={`group ${surfaceCard} rounded-xl px-4 py-3 cursor-pointer transition-all border-2 hover:-translate-y-0.5 hover:shadow-soft ${
                        isSelected ? 'border-brand-500 ring-4 ring-brand-500/15' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`text-xs font-bold w-9 h-9 rounded-md text-white inline-flex items-center justify-center flex-shrink-0 shadow-soft transition-transform group-hover:scale-105 ${
                            s.type === 'folder' || s.type === 'workspace' ? 'bg-amber-400' : 'bg-sky-500'
                          }`}>
                            {s.type === 'folder' || s.type === 'workspace' ? 'F' : 'D'}
                          </span>
                          <div className="min-w-0">
                            <div className={`text-sm font-bold truncate ${txt}`}>
                              {s.fileName || s.folderName || 'Submission'}
                            </div>
                            <div className={`text-xs mt-0.5 ${sub}`}>
                              {isLecturer ? `From: ${s.submittedByName || s.submittedBy || 'Student'}` : `To: ${s.lecturerEmail || 'Lecturer'}`}
                              {' · '}
                              {s.submittedAt ? formatDateTime(s.submittedAt) : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 items-center flex-wrap">
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md ring-1 ${m.bg} ${m.text} ${m.ring}`}>
                            {m.label}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDownload(s); }}
                            disabled={!s.documentContent}
                            title={s.documentContent ? 'Download submission' : 'No content to download'}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[11px] font-bold transition active:scale-95 ${
                              s.documentContent
                                ? darkMode
                                  ? 'border-ink-700 text-ink-100 hover:bg-white/5 cursor-pointer'
                                  : 'border-slate-200 text-slate-900 hover:bg-slate-50 cursor-pointer'
                                : 'border-current/20 opacity-50 cursor-not-allowed'
                            } ${darkMode ? 'text-ink-100' : 'text-slate-900'}`}
                          >
                            <DownloadIcon className="w-3.5 h-3.5" />
                            Download
                          </button>
                          {s.reportId && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onOpenReport?.(s); }}
                              className="inline-flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 active:scale-95 transition text-white rounded-md px-3 py-1.5 text-[11px] font-bold shadow-soft"
                            >
                              <ReportIcon className="w-3.5 h-3.5" />
                              View Report
                            </button>
                          )}
                          {isLecturer && (s.status || 'pending') === 'pending' && (
                            <button
                              type="button"
                              onClick={async (e) => { e.stopPropagation(); await onMarkReviewed?.(s); }}
                              className="bg-brand-gradient text-white rounded-md px-3 py-1.5 text-[11px] font-bold shadow-soft active:scale-95 transition hover:-translate-y-0.5"
                            >
                              Mark Reviewed
                            </button>
                          )}
                          {isLecturer && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setConfirmDelete(s); }}
                              title="Delete submission"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 active:scale-95 transition text-[11px] font-bold"
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      {isSelected && isLecturer && (
                        <div className="mt-2.5 px-3 py-2 bg-brand-500/10 rounded-lg text-xs text-brand-500 font-semibold">
                          Analytics and grading are now unlocked for this submission.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-[360px] max-w-[90vw] rounded-xl border p-6 shadow-soft ${darkMode ? 'bg-ink-900 border-ink-700 text-ink-100' : 'bg-white border-slate-200 text-slate-900'}`}
          >
            <div className="text-base font-bold mb-2">Delete submission?</div>
            <div className={`text-[13px] mb-5 ${sub}`}>
              "{confirmDelete.fileName || confirmDelete.folderName || 'Submission'}" will be permanently removed from storage. This cannot be undone.
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className={`px-4 py-2 rounded-lg border text-[13px] font-semibold ${darkMode ? 'border-ink-700 text-ink-100' : 'border-slate-200 text-slate-900'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmDelete;
                  setConfirmDelete(null);
                  await onDelete?.(target);
                }}
                className="px-4 py-2 rounded-lg border-none bg-rose-500 text-white text-[13px] font-bold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ACCENT_CLS = {
  brand: 'border-l-brand-500 text-brand-500',
  warn: 'border-l-amber-400 text-amber-400',
  info: 'border-l-sky-400 text-sky-400',
  danger: 'border-l-rose-500 text-rose-500',
};

function StatPill({ label, value, accent, darkMode }) {
  const accentCls = ACCENT_CLS[accent] || ACCENT_CLS.brand;
  const surface = darkMode ? 'bg-ink-800/60 border-ink-700' : 'bg-white border-slate-200';
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  return (
    <div className={`px-4 py-2.5 rounded-xl border border-l-4 min-w-[100px] transition hover:-translate-y-0.5 hover:shadow-soft ${accentCls} ${surface}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.06em] ${sub}`}>{label}</div>
      <div className={`text-[22px] font-bold mt-1 ${accentCls.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>{value}</div>
    </div>
  );
}
