import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithGoogle } from '../firebase/authService';
import { useAuth } from '../context/AuthContext';
import { mapAuthError } from '../utils/authErrors';
import { authSecondaryBtnStyle, authSubtitleStyle } from './authStyles';

// "Continue with Google" for Login and Signup. A first-time Google user lands on the role
// picker (ProtectedRoute) before the dashboard. Ngawang restyles this in step 1.3.
export default function GoogleSignInButton({ darkMode, disabled, onError }) {
  const navigate = useNavigate();
  const { applyProfile } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    onError?.('');
    setLoading(true);
    try {
      applyProfile(await signInWithGoogle());
      navigate('/dashboard', { replace: true });
    } catch (err) {
      onError?.(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
        <span style={{ flex: 1, height: 1, background: darkMode ? '#2a2a2a' : '#dce5e0' }} />
        <span style={{ ...authSubtitleStyle(darkMode), fontSize: 12 }}>or</span>
        <span style={{ flex: 1, height: 1, background: darkMode ? '#2a2a2a' : '#dce5e0' }} />
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading}
        style={{ ...authSecondaryBtnStyle(darkMode), opacity: disabled || loading ? 0.7 : 1 }}
      >
        {loading ? 'Opening Google…' : 'Continue with Google'}
      </button>
    </>
  );
}
