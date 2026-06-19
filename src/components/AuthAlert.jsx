import React from 'react';

export default function AuthAlert({ type = 'error', message }) {
  if (!message) return null;

  const isSuccess = type === 'success';
  const isInfo = type === 'info';

  return (
    <div
      role="alert"
      style={{
        marginTop: 16,
        padding: '12px 14px',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.5,
        background: isSuccess
          ? 'rgba(29, 158, 117, 0.15)'
          : isInfo
            ? 'rgba(79, 172, 254, 0.12)'
            : 'rgba(231, 76, 60, 0.12)',
        border: `1px solid ${
          isSuccess ? 'rgba(29, 158, 117, 0.45)' : isInfo ? 'rgba(79, 172, 254, 0.4)' : 'rgba(231, 76, 60, 0.45)'
        }`,
        color: isSuccess ? '#1D9E75' : isInfo ? '#4facfe' : '#e74c3c',
      }}
    >
      {message}
    </div>
  );
}
