// Lecturer form to give one group a new deadline with a reason (step 4.6). The backend
// checks that the caller is a lecturer of the group and logs the change.
import React, { useState } from 'react';
import { grantExtension } from '../services/api';
import { formatDateTime } from '../utils/workspaceHelpers';
import { effectiveDeadline, isExtended, localInputToIso } from './effectiveDeadline';

export default function ExtensionForm({ group, darkMode, onDone }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const current = effectiveDeadline(group);
  const border = darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  const input = { padding: '6px 8px', borderRadius: 6, border: `1px solid ${border}`, background: 'transparent', color: 'inherit', fontSize: 12 };

  if (group?.locked) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...input, cursor: 'pointer' }}>
        Extend deadline
      </button>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    const deadline = localInputToIso(when);
    if (!deadline) return setMessage({ error: true, text: 'Choose the new date and time.' });
    if (reason.trim().length < 5) return setMessage({ error: true, text: 'Give a reason of at least 5 characters.' });
    setBusy(true);
    setMessage(null);
    try {
      await grantExtension(group.id, { deadline, reason: reason.trim() });
      setMessage({ error: false, text: 'Deadline extended.' });
      setOpen(false);
      setWhen('');
      setReason('');
      onDone?.();
    } catch (err) {
      setMessage({ error: true, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 6, minWidth: 240, fontSize: 12 }}>
      <div style={{ opacity: 0.75 }}>
        Now due {current ? formatDateTime(current) : 'not set'}
        {isExtended(group) ? ' (already extended)' : ''}
      </div>
      <label style={{ display: 'grid', gap: 2 }}>
        New deadline
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={input} required />
      </label>
      <label style={{ display: 'grid', gap: 2 }}>
        Reason (shown in the audit log)
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} style={input} required />
      </label>
      {message && <div role="alert" style={{ color: message.error ? '#e74c3c' : '#1D9E75' }}>{message.text}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" disabled={busy} style={{ ...input, background: '#1D9E75', color: '#fff', border: 'none', cursor: 'pointer' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ ...input, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
