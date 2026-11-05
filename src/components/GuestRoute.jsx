import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';
import { useThemePreference } from '../hooks/useThemePreference';
import { pageBackground } from './authStyles';

export default function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  const { darkMode } = useThemePreference();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: pageBackground(darkMode),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        <Logo variant="banner" darkMode={darkMode} width={240} height={64} />
        <p style={{ color: darkMode ? '#9a9a9a' : '#5f6f66', margin: 0, fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
