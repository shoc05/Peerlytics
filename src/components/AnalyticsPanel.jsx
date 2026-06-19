import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, CartesianGrid, Sector,
} from 'recharts';
import ReportCard from './ReportCard';
import { getDocumentContent } from '../firebase/firestoreService';
import { detectFreeRider } from '../utils/scoring';
import { formatDuration, formatDate, formatDateTime } from '../utils/workspaceHelpers';

const PIE_COLORS = ['#1D9E75', '#4facfe', '#ffc107', '#e74c3c', '#a29bfe', '#00cec9'];
const LINE_COLORS = ['#1D9E75', '#4facfe', '#ffc107', '#e74c3c', '#a29bfe', '#00cec9'];

// Polished, theme-aware tooltip shared by all charts.
function ChartTooltip({ active, payload, label, darkMode, suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: darkMode ? 'rgba(20,20,20,0.96)' : 'rgba(255,255,255,0.98)',
      border: `1px solid ${darkMode ? '#333' : '#e2e8f0'}`,
      borderRadius: 10, padding: '8px 12px', fontSize: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)', color: darkMode ? '#ededed' : '#1a1a1a',
    }}>
      {label != null && <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.7 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color || p.payload?.fill, display: 'inline-block' }} />
          <span style={{ opacity: 0.8 }}>{p.name}:</span>
          <span style={{ fontWeight: 700 }}>{p.value}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

// Active pie slice — pops out + shows a label ring when hovered.
function ActivePieSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
  return (
    <g>
      <text x={cx} y={cy - 6} textAnchor="middle" fill={fill} style={{ fontSize: 15, fontWeight: 800 }}>
        {payload.name}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill={fill} style={{ fontSize: 12 }}>
        {Math.round((percent || 0) * 100)}%
      </text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 8}
        startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 10} outerRadius={outerRadius + 13}
        startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.45} />
    </g>
  );
}

// Per-member colour for TYPED content in the version history (member 1 = red,
// member 2 = blue, member 3 = green, …). Yellow is reserved for copy-paste only.
const MEMBER_COLORS = ['#e74c3c', '#4facfe', '#1D9E75', '#a29bfe', '#00cec9', '#e67e22'];
const PASTE_COLOR = '#daa520'; // yellow = copy-pasted (any member)

const initials = (name) =>
  String(name || 'U')
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

const stripTags = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

function shortName(name) {
  if (!name) return 'Unknown';
  const parts = String(name).split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
}

export default function AnalyticsPanel({
  reports = [],
  groupMembers = [],
  lecturerIds = [],
  memberIds = [],
  activityLog = [],
  darkMode = true,
  currentSubmissionReport = null,
  workspaceCreatedAt = null, // span the timeline/heatmap from here…
  deadline = null,           // …to here (the submission deadline)
}) {
  const [docHtmlCache, setDocHtmlCache] = useState({});
  const [activePie, setActivePie] = useState(-1); // hovered pie slice index
  const [hiddenLines, setHiddenLines] = useState({}); // timeline series toggled off via legend

  // Lecturers are read-only viewers — exclude them entirely from all analytics
  // (charts, grading, tables, flags). A member is a lecturer if their role says so,
  // their uid is in lecturerIds, or (when memberIds is known) they're not in memberIds.
  const studentMembers = useMemo(() => {
    const lecSet = new Set(lecturerIds || []);
    return (groupMembers || []).filter((m) => {
      const role = String(m.role || '').toLowerCase();
      const id = m.uid || m.id;
      if (role.includes('lecturer')) return false;
      if (lecSet.has(id)) return false;
      return true;
    });
  }, [groupMembers, lecturerIds]);

  const contributionData = useMemo(() => {
    return studentMembers
      .map((m) => ({
        id: m.id || m.uid || m.name,
        name: shortName(m.name || m.displayName || m.id || 'Member'),
        fullName: m.name || m.displayName || m.id || 'Member',
        edits: m.edits || 0,
        timeSpent: Math.round(m.timeSpent || 0),
        timeRaw: m.timeSpent || 0,
        contribution: m.contribution ?? m.edits ?? 0,
        contributions: Array.isArray(m.contributions) ? m.contributions : [],
        member: m,
      }))
      .sort((a, b) => b.edits - a.edits);
  }, [studentMembers]);

  const pieData = useMemo(() => {
    const total = contributionData.reduce((s, m) => s + (m.edits || 1), 0) || 1;
    return contributionData.map((m) => ({
      name: m.name,
      value: Math.round(((m.edits || 0) / total) * 100) || 1,
    }));
  }, [contributionData]);

  // Real dated activity per member, bucketed by calendar day from the FIRST recorded
  // action to the LAST (submission). Sources: the activity log + the submission's
  // version history — both carry a real timestamp and an author. Replaces the old
  // synthetic Day 1–6 buckets so the timeline/heatmap reflect actual work over time.
  const { timelineData, heatmapDates } = useMemo(() => {
    const norm = (s) => String(s || '').trim().toLowerCase();
    const memberOf = (who) => contributionData.find(
      (m) => norm(m.fullName) === norm(who) || norm(m.name) === norm(who) || m.id === who
    );
    const tsOf = (e) =>
      e.timestamp ||
      (e.createdAt?.seconds ? e.createdAt.seconds * 1000 : null) ||
      (e.createdAt ? Date.parse(e.createdAt) : null) ||
      (e.at ? e.at : null);

    const events = [];
    for (const a of activityLog || []) {
      const t = tsOf(a); const m = memberOf(a.user);
      if (t && m) events.push({ t, id: m.id });
    }
    for (const v of currentSubmissionReport?.versionHistory || []) {
      const t = tsOf(v); const m = memberOf(v.author || v.user || v.userName);
      if (t && m) events.push({ t, id: m.id });
    }
    if (!contributionData.length) return { timelineData: [], heatmapDates: [] };

    const dayKey = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const parseTs = (v) => {
      if (!v) return null;
      if (typeof v === 'number') return v;
      const ms = Date.parse(v);
      return Number.isNaN(ms) ? null : ms;
    };

    // Span the chart from WORKSPACE CREATION to the SUBMISSION DEADLINE when both are
    // known. Fall back to the activity range for whichever bound is missing.
    const createdMs = parseTs(workspaceCreatedAt);
    const deadlineMs = parseTs(deadline);
    const eventTimes = events.map((e) => e.t);
    const firstEvent = eventTimes.length ? Math.min(...eventTimes) : null;
    const lastEvent = eventTimes.length ? Math.max(...eventTimes) : null;

    let start = createdMs ?? firstEvent;
    let end = deadlineMs ?? lastEvent;
    if (start == null && end == null) return { timelineData: [], heatmapDates: [] };
    start = dayKey(start ?? end);
    end = dayKey(end ?? start);
    // Make sure any activity that falls outside the [created, deadline] window still shows.
    if (firstEvent != null) start = Math.min(start, dayKey(firstEvent));
    if (lastEvent != null) end = Math.max(end, dayKey(lastEvent));
    if (end < start) end = start;

    const DAY = 86400000;
    const dates = [];
    for (let d = start; d <= end && dates.length < 120; d += DAY) dates.push(d);

    const counts = {}; // counts[dayKey][memberId]
    for (const e of events) {
      const k = dayKey(e.t);
      (counts[k] ||= {})[e.id] = ((counts[k] || {})[e.id] || 0) + 1;
    }

    const rows = dates.map((d) => {
      const label = new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const row = { day: label, _d: d };
      for (const m of contributionData) row[m.name] = counts[d]?.[m.id] || 0;
      return row;
    });
    return { timelineData: rows, heatmapDates: dates };
  }, [contributionData, activityLog, currentSubmissionReport, workspaceCreatedAt, deadline]);

  const heatmap = useMemo(() => {
    if (!heatmapDates.length || !contributionData.length) return null;
    let max = 0;
    for (const row of timelineData) for (const m of contributionData) max = Math.max(max, row[m.name] || 0);
    return { days: heatmapDates.length, max, dates: heatmapDates };
  }, [contributionData, timelineData, heatmapDates]);

  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';

  if (!reports.length && !contributionData.length) {
    return (
      <p className={`text-[13px] m-0 ${sub}`}>
        No analytics yet. Data appears after students submit work and collaborate in the workspace.
      </p>
    );
  }

  const loadDocHtml = async (report) => {
    if (!report.fileId || docHtmlCache[report.id] !== undefined) return;
    setDocHtmlCache((c) => ({ ...c, [report.id]: '' }));
    try {
      const doc = await getDocumentContent(report.fileId);
      setDocHtmlCache((c) => ({ ...c, [report.id]: doc?.html || '' }));
    } catch {
      setDocHtmlCache((c) => ({ ...c, [report.id]: '' }));
    }
  };

  const chartTxt = darkMode ? '#9a9a9a' : '#666';
  const gridStroke = darkMode ? '#2e2e2e' : '#e8ecf1';
  const referenceReport = currentSubmissionReport || reports[0] || null;

  const rosterWithStatus = useMemo(
    () => studentMembers.map((m) => ({ ...m, status: m.status || detectFreeRider(m, studentMembers) })),
    [studentMembers]
  );
  const freeRiders = rosterWithStatus.filter((m) => m.status === 'low-contributor');
  const topContributors = rosterWithStatus.filter((m) => m.status === 'top-contributor');

  const tooltipBg = darkMode ? '#1c1c1c' : '#fff';

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
        <Stat label="Submissions" value={reports.length} darkMode={darkMode} />
        <Stat label="Contributors" value={contributionData.length} darkMode={darkMode} />
      </div>

      {contributionData.length > 0 && (
        <div className="grid gap-5 grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
          <ChartBox title="Edits per student" darkMode={darkMode}>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={contributionData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
                <defs>
                  <linearGradient id="barEdits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1D9E75" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#1D9E75" stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="barTime" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4facfe" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#4facfe" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: chartTxt, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: chartTxt, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip cursor={{ fill: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} content={<ChartTooltip darkMode={darkMode} />} />
                <Legend wrapperStyle={{ fontSize: 11, color: chartTxt }} />
                <Bar dataKey="edits" fill="url(#barEdits)" name="Edits" radius={[6, 6, 0, 0]} animationDuration={700} />
                <Bar dataKey="timeSpent" fill="url(#barTime)" name="Minutes" radius={[6, 6, 0, 0]} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>

          <ChartBox title="Contribution share" darkMode={darkMode}>
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie
                  data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={48} outerRadius={78} paddingAngle={3}
                  activeIndex={activePie >= 0 ? activePie : undefined}
                  activeShape={ActivePieSlice}
                  onMouseEnter={(_, i) => setActivePie(i)}
                  onMouseLeave={() => setActivePie(-1)}
                  animationDuration={600}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke={darkMode ? '#141414' : '#fff'} strokeWidth={2} style={{ cursor: 'pointer', outline: 'none' }} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11, color: chartTxt }} />
                <Tooltip content={<ChartTooltip darkMode={darkMode} suffix="%" />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>
      )}

      {timelineData.length > 0 && (
        <ChartBox title="Activity timeline" darkMode={darkMode}>
          <ResponsiveContainer width="100%" height={270}>
            <AreaChart data={timelineData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                {contributionData.map((m, idx) => {
                  const c = LINE_COLORS[idx % LINE_COLORS.length];
                  return (
                    <linearGradient key={m.id} id={`area-${idx}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: chartTxt, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: chartTxt, fontSize: 11 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <Tooltip content={<ChartTooltip darkMode={darkMode} />} />
              <Legend
                wrapperStyle={{ fontSize: 11, color: chartTxt, cursor: 'pointer' }}
                onClick={(e) => setHiddenLines((h) => ({ ...h, [e.value]: !h[e.value] }))}
              />
              {contributionData.map((m, idx) => (
                <Area
                  key={m.id} type="monotone" dataKey={m.name}
                  stroke={LINE_COLORS[idx % LINE_COLORS.length]} strokeWidth={2.5}
                  fill={`url(#area-${idx})`} hide={!!hiddenLines[m.name]}
                  dot={{ r: 3 }} activeDot={{ r: 6 }} animationDuration={700}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <div className={`text-[10px] mt-1 ${chartTxt === '#666' ? 'text-slate-500' : 'text-ink-400'}`}>
            Tip: click a name in the legend to show/hide that student.
          </div>
        </ChartBox>
      )}

      {heatmap && heatmap.max > 0 && (
        <ChartBox title="Contribution heatmap" darkMode={darkMode}>
          <Heatmap contributionData={contributionData} timelineData={timelineData} dates={heatmap.dates} max={heatmap.max} darkMode={darkMode} />
        </ChartBox>
      )}

      {(freeRiders.length > 0 || topContributors.length > 0) && (
        <ChartBox title="Contribution flags" darkMode={darkMode}>
          <div className="flex flex-wrap gap-4">
            {topContributors.length > 0 && (
              <FlagCard label="Top contributors" tone="brand" darkMode={darkMode} members={topContributors} />
            )}
            {freeRiders.length > 0 && (
              <FlagCard
                label="Possible free-riders"
                tone="danger"
                darkMode={darkMode}
                members={freeRiders}
                note="Edits and time both fall below 60% of the group average."
              />
            )}
          </div>
        </ChartBox>
      )}

      {/* Explainable grading moved to the Grading menu (per spec). Analysis = graphs only. */}

      {contributionData.length > 0 && (
        <ChartBox title="Contribution summary" darkMode={darkMode}>
          {(() => {
            const maxEdits = Math.max(1, ...contributionData.map((r) => r.edits || 0));
            const maxTime = Math.max(1, ...contributionData.map((r) => r.timeRaw || 0));
            const trackBg = darkMode ? 'rgba(255,255,255,0.07)' : '#eef1f5';
            const rowBorder = darkMode ? 'border-ink-700' : 'border-slate-200';
            return (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className={`text-left text-[11px] uppercase tracking-[0.06em] ${sub}`}>
                      <th className={`px-3 py-2 border-b ${rowBorder}`}>Student</th>
                      <th className={`px-3 py-2 border-b ${rowBorder}`}>Edits</th>
                      <th className={`px-3 py-2 border-b ${rowBorder}`}>Time spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contributionData.map((row, idx) => {
                      const editT = Math.min(1, (row.edits || 0) / maxEdits);
                      const timeT = Math.min(1, (row.timeRaw || 0) / maxTime);
                      const ratingT = (editT + timeT) / 2; // overall standing → red→green dot
                      const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
                      return (
                        <tr key={row.id} className={`transition hover:bg-current/5`}>
                          <td className={`px-3 py-2.5 border-b ${rowBorder} ${darkMode ? 'text-ink-100' : 'text-slate-900'}`}>
                            <span className="inline-flex items-center gap-2.5">
                              <span className="w-7 h-7 rounded-full text-white grid place-items-center text-[10px] font-bold flex-shrink-0" style={{ background: color }}>
                                {initials(row.fullName)}
                              </span>
                              <span className="font-semibold">{row.name}</span>
                              <span title="Overall contribution" style={{ width: 8, height: 8, borderRadius: '50%', background: rygColor(ratingT), display: 'inline-block' }} />
                            </span>
                          </td>
                          <td className={`px-3 py-2.5 border-b ${rowBorder}`}>
                            <div className="flex items-center gap-2">
                              <span className={`w-7 text-right font-bold ${darkMode ? 'text-ink-100' : 'text-slate-900'}`}>{row.edits || 0}</span>
                              <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: trackBg, minWidth: 80 }}>
                                <span className="block h-full rounded-full" style={{ width: `${editT * 100}%`, background: '#1D9E75', transition: 'width .5s' }} />
                              </span>
                            </div>
                          </td>
                          <td className={`px-3 py-2.5 border-b ${rowBorder}`}>
                            <div className="flex items-center gap-2">
                              <span className={`w-16 font-bold ${darkMode ? 'text-ink-100' : 'text-slate-900'}`}>{formatDuration(row.timeRaw)}</span>
                              <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: trackBg, minWidth: 80 }}>
                                <span className="block h-full rounded-full" style={{ width: `${timeT * 100}%`, background: '#4facfe', transition: 'width .5s' }} />
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </ChartBox>
      )}

      {contributionData.length > 0 && (
        <ChartBox title="Individual member breakdown" darkMode={darkMode}>
          <div className={`text-[11px] mb-3 ${sub}`}>
            Activities and contributions grouped by member. Each entry is prefixed with the
            member's initials so it's clear who did what.
          </div>
          <div className="flex flex-col gap-3">
            {contributionData.map((row, idx) => (
              <MemberBreakdown
                key={row.id}
                member={row}
                memberIndex={idx}
                activityLog={activityLog}
                versionHistory={currentSubmissionReport?.versionHistory || []}
                attribution={
                  currentSubmissionReport?.authorAttribution?.[row.id]
                  || currentSubmissionReport?.authorAttribution?.[`name:${String(row.fullName || row.name || '').trim().toLowerCase()}`]
                  || null
                }
                darkMode={darkMode}
              />
            ))}
          </div>
        </ChartBox>
      )}

      {/* The Submission Analysis Report (ReportCard) lives in the AI Report menu, not here.
          Analysis = graphs & visualizations only. */}
    </div>
  );
}

// Interpolate red (low contribution) → amber → green (high contribution).
function rygColor(t) {
  // t in 0..1.  0 = red (#e74c3c), 0.5 = amber (#f1c40f), 1 = green (#1D9E75).
  const lerp = (a, b, x) => Math.round(a + (b - a) * x);
  let r, g, b;
  if (t < 0.5) {
    const x = t / 0.5; // red → amber
    r = lerp(231, 241, x); g = lerp(76, 196, x); b = lerp(60, 15, x);
  } else {
    const x = (t - 0.5) / 0.5; // amber → green
    r = lerp(241, 29, x); g = lerp(196, 158, x); b = lerp(15, 117, x);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

function Heatmap({ contributionData, timelineData = [], dates = [], max, darkMode }) {
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  const txt = darkMode ? 'text-ink-100' : 'text-slate-900';
  const [hover, setHover] = useState(null); // { x, y, name, date, count, total, share }
  const safeMax = Math.max(1, max || 0);

  const headers = dates.map((d) => {
    const dt = new Date(d);
    return { key: d, top: dt.toLocaleDateString(undefined, { day: 'numeric' }), bottom: dt.toLocaleDateString(undefined, { month: 'short' }) };
  });
  const countFor = (memberName, idx) => timelineData[idx]?.[memberName] || 0;

  // Each member's total over the whole period → drives their red→green "worker" rating.
  const totals = {};
  let grandMax = 1;
  for (const m of contributionData) {
    const total = headers.reduce((sum, _h, i) => sum + countFor(m.name, i), 0);
    totals[m.id] = total;
    if (total > grandMax) grandMax = total;
  }

  // Empty cell = no work that day (neutral). Otherwise shade by the day's intensity,
  // tinted toward the member's overall standing (low workers skew red, high skew green).
  const cellColor = (memberId, v) => {
    if (!v) return darkMode ? 'rgba(255,255,255,0.04)' : '#eef1f5';
    const dayT = Math.min(1, v / safeMax);                 // how busy this day was
    const workerT = Math.min(1, (totals[memberId] || 0) / grandMax); // overall standing
    const t = 0.4 * dayT + 0.6 * workerT;                  // mostly by overall contribution
    return rygColor(t);
  };

  return (
    <div className="relative overflow-x-auto">
      <table className="border-separate border-spacing-1 text-[11px]">
        <thead>
          <tr>
            <th className={`min-w-[130px] font-bold text-left px-1.5 py-0.5 ${sub}`}>Student</th>
            {headers.map((h) => (
              <th key={h.key} className={`font-semibold px-1 py-0.5 text-center leading-tight ${sub}`}>
                <div className={`text-[11px] ${txt}`}>{h.top}</div>
                <div className="text-[9px] opacity-70">{h.bottom}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contributionData.map((m) => {
            const workerT = Math.min(1, (totals[m.id] || 0) / grandMax);
            const ratingDot = rygColor(workerT);
            return (
              <tr key={m.id}>
                <td className={`font-semibold px-1.5 py-0.5 whitespace-nowrap ${txt}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: ratingDot, display: 'inline-block' }} />
                    {m.name}
                  </span>
                </td>
                {headers.map((h, i) => {
                  const v = countFor(m.name, i);
                  return (
                    <td
                      key={h.key}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const host = e.currentTarget.closest('.relative')?.getBoundingClientRect();
                        setHover({
                          x: rect.left - (host?.left || 0) + rect.width / 2,
                          y: rect.top - (host?.top || 0),
                          name: m.fullName, date: formatDate(h.key),
                          count: v, total: totals[m.id] || 0,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                      className="w-7 h-7 rounded-md text-center font-bold text-[10px] transition hover:scale-[1.18] hover:ring-2 hover:ring-white/40 cursor-default"
                      style={{ background: cellColor(m.id, v), color: v ? '#fff' : (darkMode ? '#777' : '#aaa') }}
                    >
                      {v || ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {hover && (
        <div style={{
          position: 'absolute', left: hover.x, top: hover.y - 8, transform: 'translate(-50%, -100%)',
          background: darkMode ? 'rgba(20,20,20,0.96)' : 'rgba(255,255,255,0.98)',
          border: `1px solid ${darkMode ? '#333' : '#e2e8f0'}`, borderRadius: 10,
          padding: '8px 12px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap',
          boxShadow: '0 8px 24px rgba(0,0,0,0.22)', color: darkMode ? '#ededed' : '#1a1a1a', zIndex: 20,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{hover.name}</div>
          <div style={{ opacity: 0.8 }}>{hover.date}</div>
          <div style={{ marginTop: 2 }}>{hover.count} action{hover.count === 1 ? '' : 's'} that day</div>
          <div style={{ opacity: 0.75 }}>{hover.total} total over the period</div>
        </div>
      )}

      <div className={`mt-3 flex items-center gap-2 text-[10px] ${sub}`}>
        <span>Low worker</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} className="w-5 h-4 rounded-sm" style={{ background: rygColor(t) }} />
        ))}
        <span>Top worker</span>
        <span className="ml-3 inline-flex items-center gap-1">
          <span className="w-4 h-4 rounded-sm" style={{ background: darkMode ? 'rgba(255,255,255,0.04)' : '#eef1f5' }} /> No activity
        </span>
      </div>
    </div>
  );
}

const FLAG_TONE = {
  brand: 'border-l-brand-500 text-brand-500',
  danger: 'border-l-rose-500 text-rose-500',
};

function FlagCard({ label, tone, members, note, darkMode }) {
  const accent = FLAG_TONE[tone] || FLAG_TONE.brand;
  const surface = darkMode ? 'bg-ink-800/60 border-ink-700' : 'bg-white border-slate-200';
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  const chip = darkMode ? 'bg-white/5 text-ink-100 border-ink-700' : 'bg-slate-50 text-slate-900 border-slate-200';
  return (
    <div className={`flex-1 min-w-[240px] p-3.5 rounded-xl border border-l-4 transition hover:-translate-y-0.5 hover:shadow-soft ${surface} ${accent}`}>
      <div className={`text-[11px] font-bold uppercase tracking-[0.06em] mb-2 ${accent.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
        {label} ({members.length})
      </div>
      <div className={`flex flex-wrap gap-1.5 ${note ? 'mb-2' : ''}`}>
        {members.map((m) => (
          <span
            key={m.id || m.uid || m.name}
            title={m.name}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${chip}`}
          >
            {initials(m.name)} · {shortName(m.name)}
          </span>
        ))}
      </div>
      {note && <div className={`text-[11px] ${sub}`}>{note}</div>}
    </div>
  );
}

function MemberBreakdown({ member, memberIndex = 0, activityLog, versionHistory = [], attribution = null, darkMode }) {
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  const txt = darkMode ? 'text-ink-100' : 'text-slate-900';
  const surface = darkMode ? 'bg-ink-900/50 border-ink-700' : 'bg-slate-50 border-slate-200';
  const ini = initials(member.fullName);
  const memberColor = MEMBER_COLORS[memberIndex % MEMBER_COLORS.length];

  const norm = (s) => String(s || '').trim().toLowerCase();
  const isThisMember = (who) =>
    norm(who) === norm(member.fullName) || norm(who) === norm(member.name) ||
    who === member.id || who === member.uid;

  // Logged actions attributed to this member (activity.user stores the display name).
  const memberActions = (activityLog || []).filter((a) => isThisMember(a.user));

  // Full version history for this member (entries carry author/user + content + changeType).
  const memberVersionsRaw = (versionHistory || [])
    .filter((v) => isThisMember(v.author || v.user || v.userName || v.editedBy))
    .slice()
    .sort((a, b) => (b.createdAt?.seconds || b.timestamp || 0) - (a.createdAt?.seconds || a.timestamp || 0));

  const fmtTime = (v) => {
    const ms = v.timestamp || (v.createdAt?.seconds ? v.createdAt.seconds * 1000 : null) || (v.createdAt ? Date.parse(v.createdAt) : null);
    return ms ? formatDateTime(ms) : '';
  };

  // Colour rule: YELLOW = copy-pasted (any member). Otherwise the member's own colour
  // for typed/written content (member 1 = red, member 2 = blue, …).
  const entryInfo = (v) => {
    const t = v.changeType || v.type || '';
    if (t.includes('paste-large')) return { label: 'Large paste', color: PASTE_COLOR };
    if (t.includes('paste')) return { label: 'Paste', color: PASTE_COLOR };
    if (t === 'import' || t === 'submit') return { label: 'Submitted', color: memberColor };
    if (t === 'open') return { label: 'Opened', color: memberColor };
    return { label: v.label || 'Typed', color: memberColor };
  };

  // The actual text written or pasted in this version: the part of `content` that
  // wasn't in `previousContent`. Falls back to a content snippet, then summary.
  const entryText = (v) => {
    const cur = stripTags(v.content || '');
    const prev = stripTags(v.previousContent || '');
    let added = cur;
    if (prev && cur.startsWith(prev)) added = cur.slice(prev.length).trim();
    else if (prev && cur.includes(prev)) added = cur.replace(prev, '').trim();
    const text = (added || cur || v.summary || '').trim();
    return text.length > 220 ? `${text.slice(0, 220)}…` : text;
  };

  // Keep only substantive entries: every paste, and any typed/other entry that actually shows
  // content. This drops the near-empty micro-"Typed" rows that made the timeline a wall of bars.
  const memberVersions = memberVersionsRaw
    .filter((v) => {
      const t = v.changeType || v.type || '';
      if (t.includes('paste')) return true;       // always show pastes
      return entryText(v).length >= 3;            // typed/other: must have visible content
    })
    .slice(0, 30);

  const cardBg = darkMode ? 'bg-ink-800/60 border-ink-700' : 'bg-white border-slate-200';
  const railBg = darkMode ? 'bg-ink-900/40' : 'bg-slate-50';
  const divide = darkMode ? 'border-ink-700' : 'border-slate-200';
  const Chip = ({ label, value, tone }) => (
    <div className={`flex flex-col items-start px-3 py-1.5 rounded-lg border ${divide} ${railBg}`}>
      <span className={`text-[10px] uppercase tracking-[0.05em] ${sub}`}>{label}</span>
      <span className="text-[13px] font-bold" style={tone ? { color: tone } : undefined}>{value}</span>
    </div>
  );

  return (
    <div className={`${cardBg} border rounded-xl overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: darkMode ? '#2e2e2e' : '#e2e8f0' }}>
        <span className="w-9 h-9 rounded-full text-white grid place-items-center text-[12px] font-bold flex-shrink-0" style={{ background: memberColor }}>
          {ini}
        </span>
        <div className="min-w-0">
          <div className={`text-[14px] font-semibold truncate ${txt}`}>{member.fullName}</div>
          <div className={`text-[11px] ${sub}`}>{member.edits} edits · {formatDuration(member.timeRaw)}</div>
        </div>
      </div>

      {/* Metric chips */}
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Chip label="Edits" value={member.edits ?? 0} />
        <Chip label="Time" value={formatDuration(member.timeRaw)} />
        <Chip label="Pastes" value={attribution?.largePasteCount || 0} tone={attribution?.largePasteCount ? PASTE_COLOR : undefined} />
        <Chip label="AI share" value={`${attribution?.aiShare || 0}%`} tone={attribution?.aiShare ? '#dc143c' : undefined} />
      </div>

      {/* Version history (activity over time) */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${sub}`}>Version history</div>
          <div className={`flex items-center gap-3 text-[10px] ${sub}`}>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: memberColor }} /> Typed</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: PASTE_COLOR }} /> Pasted</span>
          </div>
        </div>
        {memberVersions.length ? (
          <ol className="m-0 pl-0 list-none flex flex-col max-h-80 overflow-y-auto pr-1">
            {memberVersions.map((v, i) => {
              const info = entryInfo(v);
              const content = entryText(v);
              const isPasteEntry = info.color === PASTE_COLOR;
              const isLast = i === memberVersions.length - 1;
              return (
                <li key={i} className="flex gap-2.5">
                  {/* Timeline rail: dot + connecting line */}
                  <div className="flex flex-col items-center flex-shrink-0 pt-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: info.color }} />
                    {!isLast && <span className="w-px flex-1 mt-1" style={{ background: darkMode ? '#2e2e2e' : '#e2e8f0' }} />}
                  </div>
                  {/* Entry card */}
                  <div className={`flex-1 mb-2 rounded-lg border ${divide} overflow-hidden`} style={{ borderLeft: `3px solid ${info.color}` }}>
                    <div className="flex items-center gap-2 px-2.5 py-1" style={{ background: `${info.color}10` }}>
                      <span
                        className="text-[10px] font-bold rounded px-1.5 py-0.5 flex-shrink-0"
                        style={{ background: info.color, color: '#fff' }}
                      >
                        {isPasteEntry ? '⎘ ' : '✎ '}{info.label}
                      </span>
                      {fmtTime(v) && <span className={`ml-auto text-[10px] flex-shrink-0 ${sub}`}>{fmtTime(v)}</span>}
                    </div>
                    {content ? (
                      <div className={`px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-wrap break-words ${txt}`}>
                        {content}
                      </div>
                    ) : (
                      <div className={`px-2.5 py-1 text-[11px] italic ${sub}`}>{v.summary || 'Edit'}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className={`text-[11px] ${sub} py-2`}>No version history recorded for this member.</div>
        )}
      </div>

      {/* Logged activity */}
      <div className={`px-4 py-3 border-t ${divide}`}>
        <div className={`text-[11px] font-semibold uppercase tracking-[0.06em] mb-2 ${sub}`}>Logged activity</div>
        {memberActions.length ? (
          <ul className="m-0 pl-0 list-none flex flex-col gap-1.5">
            {memberActions.slice(0, 12).map((a, i) => (
              <li key={i} className={`text-[12px] flex items-start gap-2 ${txt}`}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: memberColor }} />
                <span className="flex-1">{a.action}</span>
                {a.time && <span className={`text-[10px] flex-shrink-0 ${sub}`}>{a.time}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <div className={`text-[11px] ${sub}`}>No logged actions for this member yet.</div>
        )}
      </div>
    </div>
  );
}

function ChartBox({ title, darkMode, children }) {
  const surface = darkMode ? 'bg-ink-800/60 border-ink-700' : 'bg-white border-slate-200';
  const txt = darkMode ? 'text-ink-100' : 'text-slate-900';
  return (
    <div className={`p-4 rounded-xl border transition hover:shadow-soft ${surface}`}>
      <div className={`text-[13px] font-bold mb-3 ${txt}`}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, darkMode }) {
  const surface = darkMode ? 'bg-ink-800/60 border-ink-700' : 'bg-white border-slate-200';
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  return (
    <div className={`p-3.5 rounded-xl border transition hover:-translate-y-0.5 hover:shadow-soft ${surface}`}>
      <div className={`text-[11px] mb-1 ${sub}`}>{label}</div>
      <div className="text-[22px] font-bold text-brand-500">{value}</div>
    </div>
  );
}
