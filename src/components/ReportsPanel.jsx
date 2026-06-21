import React, { useEffect, useMemo, useState } from 'react';
import { getUsersByIds, getAllGradeDecisions } from '../firebase/firestoreService';

// Lecturer Reports: every student who submitted across the lecturer's workspaces, grouped by
// the student's Class/Section, with their final grade, the AI-suggested grade, and the
// lecturer's override reason (the fairness/accountability trail). Exportable to CSV.
//
// Data joins three sources:
//   submissions  -> who submitted, in which workspace
//   user profile -> the student's classSection + name
//   grade record -> final grade, suggestedGrade, overrideReason (groups/{gid}/grades/{uid})
export default function ReportsPanel({ submissions = [], groups = [], darkMode }) {
  const [profiles, setProfiles] = useState({});
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [classFilter, setClassFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({}); // { [class]: true } when collapsed

  const lecturerGroupIds = useMemo(() => groups.map((g) => g.id), [groups]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const studentIds = submissions.map((s) => s.submittedBy || s.userId).filter(Boolean);
      const [profs, decs] = await Promise.all([
        getUsersByIds(studentIds),
        getAllGradeDecisions(lecturerGroupIds),
      ]);
      if (!cancelled) {
        setProfiles(profs);
        setDecisions(decs);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [submissions, lecturerGroupIds.join(',')]);

  // Build one row per (student, workspace) submission with class + grade joined in.
  const rows = useMemo(() => {
    const gradeByKey = {};
    decisions.forEach((d) => { gradeByKey[`${d.groupId}:${d.memberId}`] = d; });
    const groupName = (id) => groups.find((g) => g.id === id)?.name || '—';

    return submissions.map((s) => {
      const uid = s.submittedBy || s.userId;
      const profile = profiles[uid] || {};
      const decision = gradeByKey[`${s.workspaceId}:${uid}`];
      return {
        uid,
        name: profile.name || s.submittedByName || 'Unknown',
        // Prefer the class stamped on the submission at submit time; fall back to the student's
        // current profile (for older submissions saved before classSection was snapshotted).
        classSection: s.classSection || profile.classSection || 'Unassigned',
        workspace: groupName(s.workspaceId),
        finalGrade: decision?.grade ?? null,
        suggestedGrade: decision?.suggestedGrade ?? null,
        isOverride: decision?.isOverride || false,
        reason: decision?.overrideReason || '',
        submittedAt: s.submittedAt,
      };
    });
  }, [submissions, profiles, decisions, groups]);

  const classes = useMemo(() => {
    const set = new Set(rows.map((r) => r.classSection));
    return ['all', ...[...set].sort()];
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (classFilter !== 'all' && r.classSection !== classFilter) return false;
      if (q && !(`${r.name} ${r.workspace}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, classFilter, search]);

  const grouped = useMemo(() => {
    const map = {};
    visibleRows.forEach((r) => { (map[r.classSection] ||= []).push(r); });
    return map;
  }, [visibleRows]);

  // Top-line stats across the currently visible rows.
  const stats = useMemo(() => {
    const graded = visibleRows.filter((r) => r.finalGrade != null);
    const avg = graded.length ? graded.reduce((a, r) => a + r.finalGrade, 0) / graded.length : null;
    return {
      students: new Set(visibleRows.map((r) => r.uid)).size,
      submissions: visibleRows.length,
      graded: graded.length,
      avg: avg == null ? '—' : avg.toFixed(1),
      overrides: visibleRows.filter((r) => r.isOverride).length,
    };
  }, [visibleRows]);

  const exportCsv = () => {
    const header = ['Class/Section', 'Student', 'Workspace', 'AI Suggested', 'Final Grade', 'Overridden', 'Reason'];
    const lines = [header.join(',')];
    Object.entries(grouped).forEach(([cls, items]) => {
      items.forEach((r) => {
        const cells = [cls, r.name, r.workspace, r.suggestedGrade ?? '', r.finalGrade ?? '', r.isOverride ? 'Yes' : 'No', r.reason]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`);
        lines.push(cells.join(','));
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peerlytics-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Theme tokens ──
  const card = darkMode ? '#1a1a1a' : '#fff';
  const cardHead = darkMode ? '#161616' : '#f7faf9';
  const border = darkMode ? '#2a2a2a' : '#e6e9e8';
  const text = darkMode ? '#ededed' : '#1a1a1a';
  const sub = darkMode ? '#9a9a9a' : '#6b7280';
  const inputBg = darkMode ? '#121212' : '#fff';

  const gradeColor = (g) => (g == null ? sub : g >= 8 ? '#1D9E75' : g >= 6 ? '#e0a800' : '#e74c3c');
  const gradeBg = (g) => (g == null ? (darkMode ? '#222' : '#f1f1f1')
    : g >= 8 ? 'rgba(29,158,117,0.15)' : g >= 6 ? 'rgba(224,168,0,0.15)' : 'rgba(231,76,60,0.15)');

  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const avatarHue = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

  const GradePill = ({ value }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 46,
      padding: '4px 10px', borderRadius: 8, fontSize: 13, fontWeight: 800,
      color: gradeColor(value), background: gradeBg(value),
    }}>
      {value == null ? '—' : `${value}`}<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.7, marginLeft: 1 }}>/10</span>
    </span>
  );

  return (
    <div style={{ color: text }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em' }}>Student Reports</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: sub }}>
            Submissions grouped by class &amp; section — with AI-suggested vs final grades and override reasons.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!visibleRows.length}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: 'none',
            background: visibleRows.length ? 'linear-gradient(135deg,#1D9E75,#0F6E56)' : (darkMode ? '#222' : '#eee'),
            color: visibleRows.length ? '#fff' : sub, fontSize: 13, fontWeight: 700,
            cursor: visibleRows.length ? 'pointer' : 'not-allowed', boxShadow: visibleRows.length ? '0 2px 8px rgba(29,158,117,0.3)' : 'none',
          }}
        >
          <span style={{ fontSize: 15 }}>↓</span> Export CSV
        </button>
      </div>

      {/* Stat strip */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginBottom: 22 }}>
          {[
            { label: 'Students', value: stats.students },
            { label: 'Submissions', value: stats.submissions },
            { label: 'Graded', value: `${stats.graded}/${stats.submissions}` },
            { label: 'Average grade', value: `${stats.avg}`, tone: gradeColor(stats.avg === '—' ? null : Number(stats.avg)) },
            { label: 'Overrides', value: stats.overrides, tone: stats.overrides ? '#4facfe' : undefined },
          ].map((s) => (
            <div key={s.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: sub, marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.tone || text }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: sub, fontSize: 13 }}>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student or workspace…"
              style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 9, border: `1px solid ${border}`, background: inputBg, color: text, fontSize: 13, outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {classes.map((c) => {
              const active = classFilter === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setClassFilter(c)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${active ? 'transparent' : border}`,
                    background: active ? 'linear-gradient(135deg,#1D9E75,#0F6E56)' : 'transparent',
                    color: active ? '#fff' : sub,
                  }}
                >
                  {c === 'all' ? 'All classes' : c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: sub }}>Loading reports…</div>
      ) : !rows.length ? (
        <div style={{ padding: '60px 24px', textAlign: 'center', color: sub, background: card, borderRadius: 14, border: `1px dashed ${border}` }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🗂</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: text, marginBottom: 4 }}>No submissions yet</div>
          <div style={{ fontSize: 13 }}>Reports appear here once students submit work to your workspaces.</div>
        </div>
      ) : !visibleRows.length ? (
        <div style={{ padding: 40, textAlign: 'center', color: sub, background: card, borderRadius: 14, border: `1px solid ${border}` }}>
          No students match your search/filter.
        </div>
      ) : (
        Object.entries(grouped).map(([cls, items]) => {
          const graded = items.filter((r) => r.finalGrade != null);
          const avg = graded.length ? (graded.reduce((a, r) => a + r.finalGrade, 0) / graded.length) : null;
          const overrides = items.filter((r) => r.isOverride).length;
          const isCollapsed = collapsed[cls];
          return (
            <div key={cls} style={{ background: card, border: `1px solid ${border}`, borderRadius: 14, marginBottom: 16, overflow: 'hidden', boxShadow: darkMode ? 'none' : '0 1px 3px rgba(0,0,0,0.04)' }}>
              {/* Class header */}
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [cls]: !c[cls] }))}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: cardHead, cursor: 'pointer', borderBottom: isCollapsed ? 'none' : `1px solid ${border}` }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ color: sub, fontSize: 12, transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>▼</span>
                  <strong style={{ fontSize: 15.5 }}>{cls}</strong>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: sub, background: darkMode ? '#222' : '#eef1f0', borderRadius: 999, padding: '2px 9px' }}>
                    {items.length} submission{items.length !== 1 ? 's' : ''}
                  </span>
                  {overrides > 0 && (
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#4facfe', background: 'rgba(79,172,254,0.12)', borderRadius: 999, padding: '2px 9px' }}>
                      {overrides} override{overrides !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: sub }}>class avg</span>
                  <GradePill value={avg == null ? null : Number(avg.toFixed(1))} />
                </div>
              </div>

              {/* Student rows */}
              {!isCollapsed && (
                <div>
                  {items.map((r, i) => (
                    <div
                      key={`${r.uid}-${i}`}
                      style={{
                        display: 'grid', gridTemplateColumns: 'minmax(160px,1.4fr) minmax(120px,1fr) auto auto minmax(140px,1.6fr)',
                        alignItems: 'center', gap: 14, padding: '12px 18px',
                        borderTop: i === 0 ? 'none' : `1px solid ${border}`,
                      }}
                    >
                      {/* Student */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <span style={{
                          width: 32, height: 32, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: '#fff',
                          background: `hsl(${avatarHue(r.name)},55%,45%)`,
                        }}>{initials(r.name)}</span>
                        <span style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      </div>
                      {/* Workspace */}
                      <div style={{ fontSize: 12.5, color: sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.workspace}</div>
                      {/* AI suggested */}
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: sub, marginBottom: 2 }}>AI</div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: sub }}>{r.suggestedGrade ?? '—'}</span>
                      </div>
                      {/* Final */}
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: sub, marginBottom: 2 }}>Final</div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <GradePill value={r.finalGrade} />
                          {r.isOverride && <span title="Overridden by lecturer" style={{ width: 7, height: 7, borderRadius: '50%', background: '#4facfe' }} />}
                        </span>
                      </div>
                      {/* Reason */}
                      <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                        {r.reason ? (
                          <span style={{ fontStyle: 'italic', color: text }}>“{r.reason}”</span>
                        ) : r.isOverride ? (
                          <span style={{ color: '#e74c3c' }}>⚠ no reason recorded</span>
                        ) : (
                          <span style={{ color: sub }}>matched AI suggestion</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
