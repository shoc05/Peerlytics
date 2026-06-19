import React, { useEffect, useMemo, useState } from 'react';
import { getAllGroups, getAllUsers, getAllGradeDecisions } from '../firebase/firestoreService';

// Admin dashboard (role:'admin'): read-only oversight of how lecturers grade. For each lecturer
// it shows how many grades they set, how often they override the AI suggestion, the average
// gap between AI-suggested and final grade (and its direction — leniency vs strictness), and
// every override with its reason. Overrides without a reason, or large unexplained upward bumps,
// are flagged for review — this is the accountability layer for unfair grading.
export default function AdminPanel({ darkMode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [gs, us] = await Promise.all([getAllGroups(), getAllUsers()]);
        const decs = await getAllGradeDecisions(gs.map((g) => g.id));
        if (!cancelled) { setGroups(gs); setUsers(us); setDecisions(decs); }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load admin data. Check that your role is "admin".');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const userById = useMemo(() => {
    const m = {};
    users.forEach((u) => { m[u.uid || u.id] = u; });
    return m;
  }, [users]);

  // Aggregate grade decisions by the lecturer who made them.
  const lecturerStats = useMemo(() => {
    const byLecturer = {};
    decisions.forEach((d) => {
      const lid = d.lecturerId || 'unknown';
      const s = (byLecturer[lid] ||= {
        lecturerId: lid,
        name: d.lecturerName || userById[lid]?.name || 'Unknown lecturer',
        total: 0, overrides: 0, gapSum: 0, gapCount: 0,
        noReason: 0, bigUpBumps: 0, records: [],
      });
      s.total += 1;
      const hasGap = d.suggestedGrade != null && d.grade != null;
      if (d.isOverride) {
        s.overrides += 1;
        if (!String(d.overrideReason || '').trim()) s.noReason += 1;
        if (hasGap) {
          const gap = Number(d.grade) - Number(d.suggestedGrade); // + = more lenient
          s.gapSum += gap; s.gapCount += 1;
          if (gap >= 3) s.bigUpBumps += 1; // raised the grade 3+ points above AI
        }
      }
      s.records.push(d);
    });
    return Object.values(byLecturer).sort((a, b) => b.total - a.total);
  }, [decisions, userById]);

  const groupName = (id) => groups.find((g) => g.id === id)?.name || '—';

  const totals = useMemo(() => ({
    lecturers: lecturerStats.length,
    grades: decisions.length,
    overrides: decisions.filter((d) => d.isOverride).length,
    noReason: decisions.filter((d) => d.isOverride && !String(d.overrideReason || '').trim()).length,
  }), [lecturerStats, decisions]);

  const card = darkMode ? '#1a1a1a' : '#fff';
  const border = darkMode ? '#2e2e2e' : '#e0e0e0';
  const text = darkMode ? '#ededed' : '#1a1a1a';
  const sub = darkMode ? '#9a9a9a' : '#666';

  const Stat = ({ label, value, tone }) => (
    <div style={{ flex: 1, minWidth: 130, background: card, border: `1px solid ${border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: tone || text }}>{value}</div>
    </div>
  );

  return (
    <div style={{ color: text }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 700 }}>Admin · Grading Oversight</h1>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: sub }}>
        Read-only audit of how lecturers grade and override the AI suggestions across all workspaces.
      </p>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: sub }}>Loading admin data…</div>
      ) : error ? (
        <div style={{ padding: 24, borderRadius: 12, background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.4)', color: '#e74c3c' }}>
          {error}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Stat label="Lecturers grading" value={totals.lecturers} />
            <Stat label="Grades set" value={totals.grades} />
            <Stat label="Overrides" value={totals.overrides} tone="#4facfe" />
            <Stat label="Overrides w/o reason" value={totals.noReason} tone={totals.noReason ? '#e74c3c' : undefined} />
          </div>

          {!lecturerStats.length ? (
            <div style={{ padding: 40, textAlign: 'center', color: sub, background: card, borderRadius: 12, border: `1px solid ${border}` }}>
              No grades have been set yet.
            </div>
          ) : lecturerStats.map((s) => {
            const overrideRate = s.total ? Math.round((s.overrides / s.total) * 100) : 0;
            const avgGap = s.gapCount ? (s.gapSum / s.gapCount) : 0;
            const lenient = avgGap > 0;
            const flagged = s.noReason > 0 || s.bigUpBumps > 0;
            const isOpen = expanded === s.lecturerId;
            return (
              <div key={s.lecturerId} style={{ background: card, border: `1px solid ${flagged ? 'rgba(231,76,60,0.5)' : border}`, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
                <div
                  onClick={() => setExpanded(isOpen ? null : s.lecturerId)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '14px 18px', cursor: 'pointer' }}
                >
                  <div>
                    <strong style={{ fontSize: 15 }}>{s.name}</strong>
                    {flagged && <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color: '#fff', background: '#e74c3c', borderRadius: 4, padding: '2px 7px' }}>REVIEW</span>}
                    <div style={{ fontSize: 12, color: sub, marginTop: 4 }}>
                      {s.total} grade(s) · {s.overrides} override(s) ({overrideRate}%)
                      {s.gapCount > 0 && <> · avg {lenient ? '+' : ''}{avgGap.toFixed(1)} vs AI ({lenient ? 'more lenient' : 'stricter'})</>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    {s.noReason > 0 && <span style={{ fontSize: 12, color: '#e74c3c' }}>{s.noReason} no reason</span>}
                    {s.bigUpBumps > 0 && <span style={{ fontSize: 12, color: '#e0a800' }}>{s.bigUpBumps} big bump(s)</span>}
                    <span style={{ fontSize: 12, color: sub }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: `1px solid ${border}`, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: sub, textAlign: 'left' }}>
                          <th style={{ padding: '10px 18px', fontWeight: 600 }}>Student</th>
                          <th style={{ padding: '10px 12px', fontWeight: 600 }}>Workspace</th>
                          <th style={{ padding: '10px 12px', fontWeight: 600 }}>AI</th>
                          <th style={{ padding: '10px 12px', fontWeight: 600 }}>Final</th>
                          <th style={{ padding: '10px 18px', fontWeight: 600 }}>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.records.map((d, i) => {
                          const studentName = userById[d.memberId]?.name || d.memberId;
                          const gap = d.suggestedGrade != null ? Number(d.grade) - Number(d.suggestedGrade) : 0;
                          const noReason = d.isOverride && !String(d.overrideReason || '').trim();
                          return (
                            <tr key={`${d.groupId}-${d.memberId}-${i}`} style={{ borderTop: `1px solid ${border}`, background: noReason ? 'rgba(231,76,60,0.06)' : 'transparent' }}>
                              <td style={{ padding: '10px 18px' }}>{studentName}</td>
                              <td style={{ padding: '10px 12px', color: sub }}>{groupName(d.groupId)}</td>
                              <td style={{ padding: '10px 12px', color: sub }}>{d.suggestedGrade ?? '—'}</td>
                              <td style={{ padding: '10px 12px', fontWeight: 700, color: gap >= 3 ? '#e0a800' : text }}>
                                {d.grade ?? '—'}{d.isOverride && gap !== 0 && <span style={{ fontSize: 11, color: gap > 0 ? '#1D9E75' : '#e74c3c' }}> ({gap > 0 ? '+' : ''}{gap})</span>}
                              </td>
                              <td style={{ padding: '10px 18px', fontStyle: d.overrideReason ? 'italic' : 'normal', color: noReason ? '#e74c3c' : (d.overrideReason ? text : sub) }}>
                                {d.isOverride ? (d.overrideReason || '⚠ No reason given') : '— (matched AI)'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
