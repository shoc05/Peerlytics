// Small building blocks shared by the superAdmin billing tabs and the collegeAdmin console. They
// use the course site's Tailwind theme (src/courses/courseTheme.js), so the new screens match it
// in light and dark mode.
import React, { useCallback, useEffect, useState } from 'react';
import { billingErrorText, statusTone } from './billingFormat';

const TONES = {
  good: { light: 'bg-emerald-50 text-emerald-800 border-emerald-200', dark: 'bg-emerald-400/10 text-emerald-200 border-emerald-400/30' },
  warn: { light: 'bg-amber-50 text-amber-900 border-amber-300', dark: 'bg-amber-400/10 text-amber-100 border-amber-400/40' },
  bad: { light: 'bg-rose-50 text-rose-800 border-rose-200', dark: 'bg-rose-400/10 text-rose-200 border-rose-400/30' },
  muted: { light: 'bg-slate-100 text-slate-700 border-slate-200', dark: 'bg-white/10 text-ink-100 border-ink-700' },
};

export const toneClass = (tone, darkMode) => (TONES[tone] || TONES.muted)[darkMode ? 'dark' : 'light'];

export function StatusPill({ status, text, darkMode }) {
  return (
    <span className={`inline-block border rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em] ${toneClass(statusTone(status), darkMode)}`}>
      {text}
    </span>
  );
}

/** A coloured note: tone is 'good', 'warn', 'bad' or 'muted'. */
export function Notice({ tone = 'muted', darkMode, children, role }) {
  return (
    <div role={role} className={`border rounded-xl px-4 py-3 text-sm ${toneClass(tone, darkMode)}`}>
      {children}
    </div>
  );
}

export function ErrorText({ error, ui }) {
  if (!error) return null;
  return (
    <p role="alert" className={`m-0 text-sm font-medium ${ui.error}`}>
      {typeof error === 'string' ? error : billingErrorText(error)}
    </p>
  );
}

export function Field({ id, label, hint, ui, children }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={ui.label}>{label}</label>
      {children}
      {hint && <p className={`m-0 mt-1 text-xs ${ui.sub}`}>{hint}</p>}
    </div>
  );
}

export function SectionTitle({ title, subtitle, ui, id }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="m-0 text-base font-bold">{title}</h2>
      {subtitle && <p className={`m-0 mt-1 text-[13px] ${ui.sub}`}>{subtitle}</p>}
    </div>
  );
}

/** A tab bar that works with the keyboard: arrow keys move between tabs. */
export function Tabs({ tabs, active, onChange, label, ui }) {
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.id === active);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      onChange(next.id);
      document.getElementById(`tab-${next.id}`)?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex flex-wrap gap-1 border-b mb-5 ${ui.divider}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`px-3.5 py-2.5 text-[13px] border-b-2 -mb-px transition ${ui.focus} ${
            active === t.id ? `border-brand-500 font-bold ${ui.txt}` : `border-transparent font-medium ${ui.sub}`
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Runs `load` on mount and when `reload()` is called: { loading, error, data, reload, setData }. */
export function useLoad(load) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    load()
      .then((data) => !cancelled && setState({ loading: false, error: null, data }))
      .catch((error) => !cancelled && setState({ loading: false, error, data: null }));
    return () => {
      cancelled = true;
    };
  }, [load, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setData = useCallback((update) => setState((s) => ({ ...s, data: update(s.data) })), []);
  return { ...state, reload, setData };
}

/** Wraps an async action with busy and error state: [run, busy, error, setError]. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return [run, busy, error, setError];
}

export function Table({ caption, head, children, ui }) {
  return (
    <div className={`border rounded-xl overflow-x-auto ${ui.divider}`}>
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className={`text-left ${ui.sub}`}>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3.5 py-2.5 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const cell = 'px-3.5 py-2.5 align-top';
