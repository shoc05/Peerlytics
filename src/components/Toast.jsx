import React from 'react';

export default function Toast({ toasts, darkMode }) {
  if (!toasts?.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            padding: '12px 18px',
            borderRadius: '10px',
            background: darkMode ? '#1c1c1c' : '#fff',
            border: `1px solid ${toast.type === 'error' ? '#e74c3c' : '#1D9E75'}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            color: darkMode ? '#ededed' : '#0d0d0d',
            fontSize: '13px',
            fontWeight: 500,
            minWidth: '220px',
            borderLeft: `4px solid ${toast.type === 'error' ? '#e74c3c' : '#1D9E75'}`,
            transition: 'opacity 0.3s ease, transform 0.3s ease',
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
