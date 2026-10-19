// The small live-editing badge in the editor's status bar: "Live editing", "Syncing…",
// "Offline — saved on this device" or "Connecting to live editing…".
import React from 'react';
import { syncLabel } from './collab';

const TONES = {
  'Live editing': { bg: 'rgba(29,158,117,0.12)', fg: '#1D9E75' },
  'Syncing…': { bg: 'rgba(79,172,254,0.14)', fg: '#2B7FD0' },
  'Offline — saved on this device': { bg: 'rgba(230,126,34,0.14)', fg: '#C0661A' },
};

export default function SyncBadge({ collab }) {
  const label = syncLabel(collab || {});
  if (!label) return null;
  const tone = TONES[label] || { bg: 'rgba(127,127,127,0.12)', fg: 'inherit' };
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        background: tone.bg,
        color: tone.fg,
        borderRadius: 999,
        padding: '1px 8px',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
