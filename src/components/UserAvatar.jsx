import React, { useState } from 'react';
import { getInitials, getAvatarColor } from '../utils/avatarHelpers';

export default function UserAvatar({ user, darkMode, onProfileClick }) {
  // Prefer the real name; fall back to the email local-part so we never show a bare "U".
  const displayName =
    user?.name && user.name !== 'User'
      ? user.name
      : user?.email?.split('@')[0] || user?.name || '';
  const initials = getInitials(displayName);
  const bgColor = getAvatarColor(initials);

  return (
    <button
      onClick={onProfileClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: darkMode ? '#1c1c1c' : '#f0f0f0',
        border: `1px solid ${darkMode ? '#2e2e2e' : '#ddd'}`,
        borderRadius: 8,
        padding: '6px 12px',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = darkMode ? '#262626' : '#e8e8e8';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = darkMode ? '#1c1c1c' : '#f0f0f0';
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: bgColor,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        {initials}
      </div>
      <div style={{ textAlign: 'left', fontSize: 12 }}>
        <div style={{ fontWeight: 600, color: darkMode ? '#ededed' : '#222' }}>
          {displayName.split(' ')[0]}
        </div>
        <div style={{ fontSize: 10, color: darkMode ? '#9a9a9a' : '#666' }}>
          {user?.role}
        </div>
      </div>
    </button>
  );
}
