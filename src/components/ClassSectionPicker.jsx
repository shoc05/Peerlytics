import React, { useEffect, useMemo, useState } from 'react';

// Shared Class/Section picker used at signup and in the profile. A student is either in
// SCHOOL (Class 6–12 + Section) or in a DEGREE (Year 1–5 + Department). The pieces are
// combined into ONE readable label (e.g. "Class 8 - A", "Year 2 - Computer Science") that the
// lecturer report groups by. `value` is that combined string; `onChange(combined)` reports it.

const SCHOOL_CLASSES = ['6', '7', '8', '9', '10', '11', '12'];
const DEGREE_YEARS = ['1', '2', '3', '4', '5'];

// Parse a stored combined label back into its parts so editing pre-fills correctly.
export function parseClassSection(value) {
  const v = String(value || '').trim();
  if (!v) return { kind: '', level: '', extra: '' };
  const [head, ...rest] = v.split(' - ');
  const extra = rest.join(' - ').trim();
  const classMatch = head.match(/^Class\s+(\d+)$/i);
  const yearMatch = head.match(/^Year\s+(\d+)$/i);
  if (classMatch) return { kind: 'school', level: classMatch[1], extra };
  if (yearMatch) return { kind: 'degree', level: yearMatch[1], extra };
  return { kind: '', level: '', extra: v }; // legacy/custom value → keep as free text
}

export function buildClassSection({ kind, level, extra }) {
  if (!kind || !level) return '';
  const head = kind === 'school' ? `Class ${level}` : `Year ${level}`;
  const tail = String(extra || '').trim();
  return tail ? `${head} - ${tail}` : head;
}

export default function ClassSectionPicker({ value, onChange, inputClassName, selectClassName, labelClassName, darkMode }) {
  const initial = useMemo(() => parseClassSection(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [kind, setKind] = useState(initial.kind);
  const [level, setLevel] = useState(initial.level);
  const [extra, setExtra] = useState(initial.extra);

  // Report the combined value upward whenever a part changes.
  useEffect(() => {
    onChange?.(buildClassSection({ kind, level, extra }));
  }, [kind, level, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  const selCls = selectClassName || `w-full px-3 py-2.5 rounded-lg border outline-none ${darkMode ? 'bg-white/5 text-ink-100 border-ink-700' : 'bg-slate-50 text-slate-900 border-slate-200'}`;
  const inpCls = inputClassName || selCls;
  const lblCls = labelClassName || `block text-[11px] font-bold uppercase tracking-[0.06em] mb-1.5 ${darkMode ? 'text-ink-400' : 'text-slate-500'}`;

  const levels = kind === 'school' ? SCHOOL_CLASSES : kind === 'degree' ? DEGREE_YEARS : [];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className={lblCls}>I am in</span>
        <select
          value={kind}
          onChange={(e) => { setKind(e.target.value); setLevel(''); setExtra(''); }}
          className={`${selCls} cursor-pointer`}
        >
          <option value="">Select…</option>
          <option value="school">School (Class 6–12)</option>
          <option value="degree">Degree (Year 1–5)</option>
        </select>
      </div>

      {kind && (
        <div className="flex gap-3">
          <div className="flex-1">
            <span className={lblCls}>{kind === 'school' ? 'Class' : 'Year'}</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className={`${selCls} cursor-pointer`}>
              <option value="">Select…</option>
              {levels.map((l) => (
                <option key={l} value={l}>{kind === 'school' ? `Class ${l}` : `Year ${l}`}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <span className={lblCls}>{kind === 'school' ? 'Section' : 'Department'}</span>
            <input
              type="text"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={kind === 'school' ? 'e.g. A' : 'e.g. Computer Science'}
              className={inpCls}
            />
          </div>
        </div>
      )}
    </div>
  );
}
