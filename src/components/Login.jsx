import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import AuthAlert from './AuthAlert';
import AuthThemeToggle from './AuthThemeToggle';
import { signIn } from '../firebase/authService';
import { useAuth } from '../context/AuthContext';
import { mapAuthError } from '../utils/authErrors';
import {
  authPageStyle,
  authCardStyle,
  authInputStyle,
  authBtnStyle,
  authSubtitleStyle,
  authLabelStyle,
  authLinkStyle,
} from './authStyles';
import { useThemePreference } from '../hooks/useThemePreference';

export default function Login() {
  const navigate = useNavigate();
  const { applyProfile } = useAuth();
  const { darkMode, toggleTheme } = useThemePreference();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const profile = await signIn(email, password);
      applyProfile(profile);
      setSuccess('Signed in successfully! Redirecting to dashboard…');
      setTimeout(() => navigate('/dashboard', { replace: true }), 500);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={authPageStyle(darkMode)}>
      <AuthThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
      <div style={authCardStyle(darkMode)}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '28px' }}>
          <Logo variant="banner" darkMode={darkMode} width={280} height={72} />
        </div>

        <form onSubmit={handleSubmit}>
          <label style={authLabelStyle(darkMode)}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            disabled={loading}
            style={authInputStyle(darkMode)}
          />

          <label style={{ ...authLabelStyle(darkMode), marginTop: 16 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            required
            disabled={loading}
            style={authInputStyle(darkMode)}
          />

          <AuthAlert type="error" message={error} />
          <AuthAlert type="success" message={success} />

          <button type="submit" disabled={loading} style={{ ...authBtnStyle, marginTop: 20, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: authSubtitleStyle(darkMode).color, fontSize: 13, marginTop: 20 }}>
          No account?{' '}
          <Link to="/signup" style={authLinkStyle}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
