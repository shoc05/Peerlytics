import React from 'react';

export default function AuthThemeToggle({ darkMode, onToggle }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        gap: 4,
        padding: 4,
        borderRadius: 10,
        background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.9)',
        border: `1px solid ${darkMode ? '#2e2e2e' : '#dce5e0'}`,
        boxShadow: darkMode ? 'none' : '0 2px 8px rgba(45,74,62,0.08)',
      }}
    >
      <button
        type="button"
        onClick={() => darkMode && onToggle()}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          background: !darkMode ? '#1D9E75' : 'transparent',
          color: !darkMode ? '#fff' : '#9a9a9a',
        }}
      >
        Light
      </button>
      <button
        type="button"
        onClick={() => !darkMode && onToggle()}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          background: darkMode ? '#1D9E75' : 'transparent',
          color: darkMode ? '#fff' : '#5f6f66',
        }}
      >
        Dark
      </button>
    </div>
  );
}
