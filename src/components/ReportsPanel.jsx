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
        classSection: profile.classSection || 'Unassigned',
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

  const grouped = useMemo(() => {
    const filtered = classFilter === 'all' ? rows : rows.filter((r) => r.classSection === classFilter);
    const map = {};
    filtered.forEach((r) => { (map[r.classSection] ||= []).push(r); });
    return map;
  }, [rows, classFilter]);

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

  const card = darkMode ? '#1a1a1a' : '#fff';
  const border = darkMode ? '#2e2e2e' : '#e0e0e0';
  const text = darkMode ? '#ededed' : '#1a1a1a';
  const sub = darkMode ? '#9a9a9a' : '#666';

  const gradeColor = (g) => (g == null ? sub : g > 8 ? '#1D9E75' : g > 6 ? '#e0a800' : '#e74c3c');

  return (
    <div style={{ color: text }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Student Reports</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: sub }}>
            All students who submitted, grouped by class/section, with final grades and override reasons.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid ${border}`, background: card, color: text, fontSize: 13, cursor: 'pointer' }}
          >
            {classes.map((c) => <option key={c} value={c}>{c === 'all' ? 'All classes' : c}</option>)}
          </select>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.6 }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: sub }}>Loading reports…</div>
      ) : !rows.length ? (
        <div style={{ padding: 40, textAlign: 'center', color: sub, background: card, borderRadius: 12, border: `1px solid ${border}` }}>
          No submissions yet. Reports appear once students submit work to your workspaces.
        </div>
      ) : (
        Object.entries(grouped).map(([cls, items]) => {
          const graded = items.filter((r) => r.finalGrade != null);
          const avg = graded.length ? (graded.reduce((a, r) => a + r.finalGrade, 0) / graded.length).toFixed(1) : '—';
          const overrides = items.filter((r) => r.isOverride).length;
          return (
            <div key={cls} style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, marginBottom: 20, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: `1px solid ${border}`, background: darkMode ? '#161616' : '#fafafa' }}>
                <strong style={{ fontSize: 15 }}>{cls}</strong>
                <span style={{ fontSize: 12, color: sub }}>
                  {items.length} submission(s) · class avg {avg}/10 · {overrides} override(s)
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: sub, textAlign: 'left' }}>
                      <th style={{ padding: '10px 18px', fontWeight: 600 }}>Student</th>
                      <th style={{ padding: '10px 12px', fontWeight: 600 }}>Workspace</th>
                      <th style={{ padding: '10px 12px', fontWeight: 600 }}>AI Suggested</th>
                      <th style={{ padding: '10px 12px', fontWeight: 600 }}>Final</th>
                      <th style={{ padding: '10px 18px', fontWeight: 600 }}>Override reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r, i) => (
                      <tr key={`${r.uid}-${i}`} style={{ borderTop: `1px solid ${border}` }}>
                        <td style={{ padding: '10px 18px', fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: '10px 12px', color: sub }}>{r.workspace}</td>
                        <td style={{ padding: '10px 12px', color: sub }}>{r.suggestedGrade ?? '—'}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: gradeColor(r.finalGrade) }}>
                          {r.finalGrade ?? '—'}{r.isOverride && <span style={{ fontSize: 10, marginLeft: 4, color: '#4facfe' }}>●</span>}
                        </td>
                        <td style={{ padding: '10px 18px', fontStyle: r.reason ? 'italic' : 'normal', color: r.reason ? text : sub }}>
                          {r.reason || (r.isOverride ? '(no reason recorded)' : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
