import React, { useMemo, useState, useEffect } from 'react';
import { formatDateTime } from '../utils/workspaceHelpers';

const MS_DAY = 24 * 60 * 60 * 1000;
const AUTO_SUBMIT_WINDOW_MS = 30 * 60 * 1000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDeadline(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const startOfDay = (d) => { const o = new Date(d); o.setHours(0,0,0,0); return o; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfWeek = (d) => { const o = startOfDay(d); o.setDate(o.getDate() - o.getDay()); return o; };

function formatCountdown(ms) {
  if (ms === null || ms === undefined) return '—';
  const overdue = ms < 0;
  let abs = Math.abs(ms);
  const days = Math.floor(abs / MS_DAY); abs -= days * MS_DAY;
  const hours = Math.floor(abs / 3.6e6); abs -= hours * 3.6e6;
  const minutes = Math.floor(abs / 60000); abs -= minutes * 60000;
  const seconds = Math.floor(abs / 1000);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  if (!days && !hours) parts.push(`${seconds}s`);
  return overdue ? `${parts.join(' ')} overdue` : parts.join(' ');
}

function deadlineStatus(d, now) {
  if (!d) return 'none';
  const ms = d.getTime() - now;
  if (ms <= 0) return 'overdue';
  if (ms <= AUTO_SUBMIT_WINDOW_MS) return 'autosubmit';
  if (ms <= MS_DAY) return 'today';
  if (ms <= 7 * MS_DAY) return 'soon';
  return 'future';
}

const STATUS_CLS = {
  overdue:    { bg: 'bg-rose-500/20',  fg: 'text-rose-500',  dot: 'bg-rose-500',  label: 'Overdue' },
  autosubmit: { bg: 'bg-amber-400/20', fg: 'text-amber-400', dot: 'bg-amber-400', label: 'Auto-submit window' },
  today:      { bg: 'bg-sky-400/20',   fg: 'text-sky-400',   dot: 'bg-sky-400',   label: 'Due today' },
  soon:       { bg: 'bg-brand-500/15', fg: 'text-brand-500', dot: 'bg-brand-500', label: 'This week' },
  future:     { bg: 'bg-slate-400/15', fg: 'text-slate-400', dot: 'bg-slate-400', label: 'Upcoming' },
  none:       { bg: '',                fg: 'text-slate-400', dot: 'bg-slate-400', label: 'No deadline' },
};

const ChevronLeft = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" {...p}><polyline points="15 18 9 12 15 6" /></svg>;
const ChevronRight = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" {...p}><polyline points="9 18 15 12 9 6" /></svg>;

export default function CalendarPanel({
  workspaces = [],
  darkMode = false,
  isLecturer = false,
  onOpenWorkspace,
}) {
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadlined = useMemo(
    () => workspaces
      .map((w) => ({ ...w, due: parseDeadline(w.deadline) }))
      .filter((w) => w.due !== null)
      .sort((a, b) => a.due.getTime() - b.due.getTime()),
    [workspaces]
  );
  const undeadlined = useMemo(
    () => workspaces.filter((w) => !parseDeadline(w.deadline)),
    [workspaces]
  );
  const nextDeadline = useMemo(
    () => deadlined.find((w) => w.due.getTime() >= now) || null,
    [deadlined, now]
  );

  const txt = darkMode ? 'text-ink-100' : 'text-slate-900';
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  const cardBg = darkMode ? 'bg-ink-800/70 border-ink-700' : 'bg-white border-slate-200';
  const tabBg = darkMode ? 'bg-ink-800/60 border-ink-700' : 'bg-white border-slate-200';

  const ctx = { now, txt, sub, cardBg, darkMode, onOpenWorkspace };

  return (
    <div className={`p-8 overflow-auto ${txt}`}>
      <h1 className="m-0 mb-1.5 text-[26px] font-bold tracking-tight">Calendar</h1>
      <p className={`m-0 mb-5 text-[13px] ${sub}`}>
        Deadlines across all your projects. Auto-submit triggers 30 minutes before each due time.
      </p>

      {nextDeadline && (
        <div className={`${cardBg} border border-l-4 border-l-brand-500 rounded-xl px-5 py-3.5 mb-5 flex flex-wrap gap-4 items-center justify-between transition hover:shadow-soft`}>
          <div className="min-w-0">
            <div className={`text-[11px] font-bold uppercase tracking-[0.06em] ${sub}`}>Next deadline</div>
            <div className={`text-base font-bold mt-1 truncate ${txt}`}>{nextDeadline.name}</div>
            <div className={`text-xs mt-1 ${sub}`}>{formatDateTime(nextDeadline.due)}</div>
          </div>
          <div className="text-right">
            <div className={`text-[11px] font-bold uppercase tracking-[0.06em] ${sub}`}>Countdown</div>
            <div className="text-[22px] font-bold text-brand-500 mt-1 tabular-nums">
              {formatCountdown(nextDeadline.due.getTime() - now)}
            </div>
          </div>
        </div>
      )}

      <div className={`flex gap-1 ${tabBg} border rounded-xl p-1 mb-4 w-fit`}>
        {[{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'timeline', label: 'Timeline' }].map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition active:scale-95 ${
              view === v.id
                ? 'bg-brand-gradient text-white shadow-soft'
                : `${sub} hover:text-current`
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'month' && <MonthView deadlined={deadlined} cursor={cursor} setCursor={setCursor} {...ctx} />}
      {view === 'week' && <WeekView deadlined={deadlined} cursor={cursor} setCursor={setCursor} {...ctx} />}
      {view === 'timeline' && <TimelineView deadlined={deadlined} {...ctx} />}

      {undeadlined.length > 0 && (
        <div className="mt-7">
          <div className={`text-[11px] font-bold uppercase tracking-[0.06em] mb-2.5 ${sub}`}>
            Projects without a deadline
          </div>
          <div className="flex flex-wrap gap-2">
            {undeadlined.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onOpenWorkspace?.(w)}
                className={`${cardBg} border rounded-full px-3.5 py-1.5 text-xs transition hover:-translate-y-0.5 hover:shadow-soft active:scale-95 ${txt}`}
              >
                {w.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {workspaces.length === 0 && (
        <div className={`text-center py-10 px-6 text-[13px] mt-4 ${sub}`}>
          {isLecturer
            ? 'No projects yet. Once a project is created, its deadline shows here.'
            : 'No projects yet. Create or join a project to see its deadline here.'}
        </div>
      )}
    </div>
  );
}

function MonthView({ deadlined, cursor, setCursor, now, txt, sub, cardBg, darkMode, onOpenWorkspace }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = startOfWeek(firstOfMonth);

  const cells = useMemo(() => {
    const out = [];
    const d = new Date(gridStart);
    for (let i = 0; i < 42; i++) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [gridStart]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const w of deadlined) {
      const key = startOfDay(w.due).getTime();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(w);
    }
    return map;
  }, [deadlined]);

  const today = startOfDay(new Date(now));
  const cellBg = darkMode ? 'bg-ink-900/50' : 'bg-slate-50';

  return (
    <div className={`${cardBg} border rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`text-base font-bold ${txt}`}>{MONTH_NAMES[month]} {year}</div>
        <div className="flex gap-1.5">
          <NavBtn onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="w-3.5 h-3.5" /></NavBtn>
          <NavBtn onClick={() => setCursor(startOfDay(new Date()))}>Today</NavBtn>
          <NavBtn onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="w-3.5 h-3.5" /></NavBtn>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className={`text-[11px] font-bold text-center py-1 ${sub}`}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = sameDay(d, today);
          const dayDeadlines = byDay.get(d.getTime()) || [];
          return (
            <div
              key={i}
              className={`${cellBg} rounded-lg p-1.5 min-h-[84px] flex flex-col gap-1 transition border ${
                isToday ? 'border-brand-500 ring-2 ring-brand-500/20' : darkMode ? 'border-ink-700' : 'border-slate-200'
              } ${inMonth ? 'opacity-100' : 'opacity-40'}`}
            >
              <div className={`text-[11px] font-bold ${isToday ? 'text-brand-500' : txt}`}>{d.getDate()}</div>
              {dayDeadlines.map((w) => {
                const s = STATUS_CLS[deadlineStatus(w.due, now)];
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onOpenWorkspace?.(w)}
                    title={`${w.name} · ${formatDateTime(w.due)}`}
                    className={`${s.bg} ${s.fg} rounded-md px-1.5 py-0.5 text-[10px] font-bold text-left truncate cursor-pointer transition hover:scale-105 active:scale-95`}
                  >
                    {w.name}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ deadlined, cursor, setCursor, now, txt, sub, cardBg, darkMode, onOpenWorkspace }) {
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const days = useMemo(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekStart]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const w of deadlined) {
      const key = startOfDay(w.due).getTime();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(w);
    }
    return map;
  }, [deadlined]);

  const today = startOfDay(new Date(now));
  const cellBg = darkMode ? 'bg-ink-900/50' : 'bg-slate-50';

  return (
    <div className={`${cardBg} border rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`text-sm font-bold ${txt}`}>
          Week of {weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="flex gap-1.5">
          <NavBtn onClick={() => { const n = new Date(weekStart); n.setDate(n.getDate() - 7); setCursor(n); }}><ChevronLeft className="w-3.5 h-3.5" /></NavBtn>
          <NavBtn onClick={() => setCursor(startOfDay(new Date()))}>This week</NavBtn>
          <NavBtn onClick={() => { const n = new Date(weekStart); n.setDate(n.getDate() + 7); setCursor(n); }}><ChevronRight className="w-3.5 h-3.5" /></NavBtn>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          const items = byDay.get(d.getTime()) || [];
          return (
            <div
              key={i}
              className={`${cellBg} rounded-lg p-2.5 min-h-[200px] flex flex-col gap-1.5 border transition ${
                isToday ? 'border-brand-500 ring-2 ring-brand-500/20' : darkMode ? 'border-ink-700' : 'border-slate-200'
              }`}
            >
              <div className={`text-[11px] font-bold ${sub}`}>{WEEKDAYS[d.getDay()]}</div>
              <div className={`text-lg font-bold ${isToday ? 'text-brand-500' : txt}`}>{d.getDate()}</div>
              {items.length === 0 ? (
                <div className={`text-[11px] ${sub}`}>—</div>
              ) : items.map((w) => {
                const s = STATUS_CLS[deadlineStatus(w.due, now)];
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onOpenWorkspace?.(w)}
                    className={`${s.bg} ${s.fg} rounded-md px-2 py-1.5 text-[11px] font-bold text-left transition hover:scale-105 active:scale-95`}
                  >
                    <div className="truncate">{w.name}</div>
                    <div className="text-[9px] font-semibold opacity-80 mt-0.5">
                      {w.due.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineView({ deadlined, now, txt, sub, cardBg, onOpenWorkspace }) {
  if (deadlined.length === 0) {
    return (
      <div className={`${cardBg} border rounded-xl p-8 text-center text-[13px] ${sub}`}>
        No deadlines to show.
      </div>
    );
  }
  return (
    <div className={`${cardBg} border rounded-xl p-5`}>
      <div className="relative pl-5">
        <div className="absolute left-1.5 top-1 bottom-1 w-0.5 bg-current/10 rounded" />
        {deadlined.map((w) => {
          const s = STATUS_CLS[deadlineStatus(w.due, now)];
          const ms = w.due.getTime() - now;
          return (
            <div key={w.id} className="relative mb-4 pl-4 group">
              <span className={`absolute -left-0.5 top-1 w-3.5 h-3.5 rounded-full ${s.dot} ring-2 ring-current/10 transition-transform group-hover:scale-125`} />
              <div className="flex flex-wrap items-baseline gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenWorkspace?.(w)}
                  className={`text-sm font-bold text-left ${txt} hover:text-brand-500 transition`}
                >
                  {w.name}
                </button>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${s.bg} ${s.fg}`}>{s.label}</span>
              </div>
              <div className={`text-xs mt-1 ${sub}`}>
                {formatDateTime(w.due)} · {formatCountdown(ms)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NavBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-current/20 text-xs font-semibold opacity-80 hover:opacity-100 hover:border-current/50 transition active:scale-95"
    >
      {children}
    </button>
  );
}
