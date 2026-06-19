import React from 'react';
import { isFirebaseConfigured } from '../firebase/config';
import Logo from './Logo';

export default function FirebaseGate({ children }) {
  if (isFirebaseConfigured()) return children;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0d0d0d 0%, #1c1c1c 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: '#1c1c1c',
          border: '1px solid #2e2e2e',
          borderRadius: 16,
          padding: 40,
          textAlign: 'center',
        }}
      >
        <Logo variant="banner" darkMode width={240} height={64} />
        <h1 style={{ color: '#ededed', margin: '20px 0 8px', fontSize: 24 }}>Firebase required</h1>
        <p style={{ color: '#9a9a9a', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Copy <code style={{ color: '#1D9E75' }}>.env.example</code> to <code style={{ color: '#1D9E75' }}>.env</code> and
          set your <code style={{ color: '#1D9E75' }}>VITE_FIREBASE_*</code> keys. See README.md for setup steps.
        </p>
      </div>
    </div>
  );
}
