import React from 'react';

const STYLES = {
  document: { bg: '#4285f4', label: 'Doc' },
  spreadsheet: { bg: '#217346', label: 'Sheet' },
  presentation: { bg: '#d24726', label: 'Slide' },
  folder: { bg: '#f4b400', label: 'Folder' },
};

// Inline stroke icons (white on the colored tile), drawn at a 24-box viewBox.
function TypeIcon({ type, px }) {
  const common = {
    width: px,
    height: px,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#fff',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (type) {
    case 'document':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      );
    case 'spreadsheet':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 10h16M4 15h16M10 4v16" />
        </svg>
      );
    case 'presentation':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M12 16v4M8 20h8" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function FileTypeBadge({ type, size = 36, showLabel = false }) {
  const key = STYLES[type] ? type : 'document';
  const s = STYLES[key];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: key === 'folder' ? 8 : 6,
          background: s.bg,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <TypeIcon type={key} px={Math.round(size * 0.58)} />
      </div>
      {showLabel && <span style={{ fontSize: 10, color: '#5f6368', fontWeight: 600 }}>{s.label}</span>}
    </div>
  );
}
