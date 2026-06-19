import React, { useState } from 'react';
import { getInitials, getAvatarColor } from '../utils/avatarHelpers';

export default function ProfilePanel({ user, onSave, onClose, saving = false, darkMode = true }) {
  const [name, setName] = useState(user?.name || '');
  // Email and role are not editable — only the display name can change.
  const email = user?.email || '';

  const initials = getInitials(name || user?.name);
  const bgColor = getAvatarColor(initials);

  const dirty = name.trim() !== (user?.name || '');

  const handleSave = (e) => {
    e.preventDefault();
    if (!dirty || saving) return;
    onSave?.({ name: name.trim() });
  };

  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '—';

  const panel = darkMode
    ? 'bg-ink-900 text-ink-100 border-ink-700'
    : 'bg-white text-slate-900 border-slate-200';
  const inputCls = darkMode
    ? 'bg-white/5 text-ink-100 border-ink-700 focus:border-brand-500 placeholder-ink-400'
    : 'bg-slate-50 text-slate-900 border-slate-200 focus:border-brand-500 placeholder-slate-400';
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  const labelCls = `block text-[11px] font-bold uppercase tracking-[0.06em] mb-1.5 ${sub}`;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] bg-black/55 backdrop-blur-sm flex items-center justify-center animate-[fadeIn_0.15s_ease-out]"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
        className={`relative w-[min(420px,92vw)] rounded-2xl border p-6 shadow-panel transition ${panel}`}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="m-0 text-lg font-bold">Profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`grid place-items-center w-8 h-8 rounded-full border border-transparent hover:border-current/20 transition ${sub} hover:text-current text-2xl leading-none`}
          >
            ×
          </button>
        </div>

        <div className="flex flex-col items-center gap-2.5 mb-6">
          <div
            className="w-20 h-20 rounded-full text-white font-bold text-3xl grid place-items-center shadow-soft ring-4 ring-white/10 transition-transform hover:scale-105"
            style={{ background: bgColor }}
          >
            {initials}
          </div>
          <div className={`text-xs ${sub}`}>{roleLabel}</div>
        </div>

        <label className="block mb-3.5">
          <span className={labelCls}>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border outline-none transition focus:ring-4 focus:ring-brand-500/15 ${inputCls}`}
          />
        </label>

        <label className="block mb-3.5">
          <span className={labelCls}>Email</span>
          <input
            type="email"
            value={email}
            readOnly
            className={`w-full px-3 py-2.5 rounded-lg border outline-none cursor-not-allowed opacity-80 ${inputCls}`}
          />
        </label>

        <label className="block mb-6">
          <span className={labelCls}>Role</span>
          <input
            type="text"
            value={roleLabel}
            readOnly
            className={`w-full px-3 py-2.5 rounded-lg border outline-none cursor-not-allowed opacity-80 ${inputCls}`}
          />
        </label>

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg border text-sm font-semibold transition hover:bg-black/5 ${
              darkMode ? 'border-ink-700 text-ink-400 hover:bg-white/5' : 'border-slate-200 text-slate-500'
            }`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!dirty || saving}
            className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition active:scale-95 ${
              dirty && !saving
                ? 'bg-brand-gradient hover:shadow-soft hover:-translate-y-0.5'
                : darkMode
                  ? 'bg-ink-700 cursor-not-allowed opacity-70'
                  : 'bg-slate-300 cursor-not-allowed opacity-70'
            }`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
