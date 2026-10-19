// Inline feedback list under a submitted document (step 4.6). The lecturer selects text,
// writes a comment and saves; the group sees the comments read-only, with the commented
// text highlighted in the document.
import React, { useState } from 'react';

export default function FeedbackPanel({ items = [], canComment = false, currentUid, getSelectionAnchor, onAdd, onDelete }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!canComment && !items.length) return null;

  const add = async () => {
    const anchor = getSelectionAnchor?.();
    if (!anchor) return setError('Select the words you want to comment on first.');
    if (!draft.trim()) return setError('Write a comment.');
    setBusy(true);
    setError(null);
    try {
      await onAdd(anchor, draft.trim());
      setDraft('');
    } catch (err) {
      setError(err.message || 'Could not save the comment.');
    } finally {
      setBusy(false);
    }
  };

  const box = { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', fontSize: 12 };

  return (
    <section aria-label="Lecturer feedback" style={{ padding: '10px 16px', borderTop: '1px solid rgba(127,127,127,0.2)', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Lecturer feedback{items.length ? ` (${items.length})` : ''}</div>
      {canComment && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            type="text"
            value={draft}
            maxLength={2000}
            placeholder="Select text in the document, then write a comment"
            onChange={(e) => setDraft(e.target.value)}
            style={{ ...box, flex: 1 }}
          />
          <button type="button" onClick={add} disabled={busy} style={{ ...box, background: '#1D9E75', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {busy ? 'Saving…' : 'Comment'}
          </button>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#e74c3c', marginBottom: 6 }}>{error}</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {items.map((item) => (
          <li key={item.id} style={{ padding: 8, borderRadius: 6, background: 'rgba(255,196,0,0.12)' }}>
            <div style={{ opacity: 0.75, fontStyle: 'italic' }}>“{item.quote?.exact}”</div>
            <div style={{ marginTop: 4 }}>{item.comment}</div>
            <div style={{ marginTop: 4, opacity: 0.6, display: 'flex', justifyContent: 'space-between' }}>
              <span>{item.lecturerName || 'Lecturer'}</span>
              {canComment && item.lecturerId === currentUid && (
                <button type="button" onClick={() => onDelete?.(item.id)} style={{ ...box, padding: '0 6px', cursor: 'pointer' }}>
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
