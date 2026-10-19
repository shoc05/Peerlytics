// Tailwind classes for the course site, matching CalendarPanel and the sidebar (brand
// gradient, ink surfaces in dark mode). Every control gets a visible keyboard focus ring.
export function courseTheme(darkMode) {
  const focus = `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
    darkMode ? 'focus-visible:ring-offset-ink-900' : 'focus-visible:ring-offset-white'
  }`;
  return {
    focus,
    txt: darkMode ? 'text-ink-100' : 'text-slate-900',
    sub: darkMode ? 'text-ink-400' : 'text-slate-600',
    card: `border rounded-xl p-4 sm:p-5 ${darkMode ? 'bg-ink-800/70 border-ink-700' : 'bg-white border-slate-200'}`,
    tabBar: darkMode ? 'bg-ink-800/60 border-ink-700' : 'bg-white border-slate-200',
    divider: darkMode ? 'border-ink-700' : 'border-slate-200',
    label: `block text-xs font-semibold mb-1 ${darkMode ? 'text-ink-100' : 'text-slate-700'}`,
    input: `w-full rounded-lg border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
      darkMode
        ? 'bg-ink-900 border-ink-700 text-ink-100 placeholder:text-ink-400'
        : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-500'
    } ${focus}`,
    primaryBtn: `inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand-gradient shadow-soft transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100 ${focus}`,
    ghostBtn: `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition active:scale-[0.98] ${
      darkMode ? 'border-ink-700 text-ink-100 hover:bg-white/5' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
    } ${focus}`,
    notice: darkMode ? 'bg-amber-400/10 border-amber-400/40 text-amber-100' : 'bg-amber-50 border-amber-300 text-amber-900',
    noticeBadge: darkMode ? 'bg-amber-400/20 text-amber-200' : 'bg-amber-200 text-amber-900',
    error: darkMode ? 'text-rose-300' : 'text-rose-700',
    pill: darkMode ? 'bg-brand-500/15 text-brand-300' : 'bg-brand-50 text-brand-700',
  };
}
