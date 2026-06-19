import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import AuthAlert from './AuthAlert';
import AuthThemeToggle from './AuthThemeToggle';
import { signUp } from '../firebase/authService';
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

export default function Signup() {
  const navigate = useNavigate();
  const { applyProfile } = useAuth();
  const { darkMode, toggleTheme } = useThemePreference();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  // Class/Section lets lecturers group students in reports. Only shown for students.
  const [classSection, setClassSection] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (role === 'student' && (!classSection.trim() || classSection === '__other')) {
      setError('Please select or enter your class/section.');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const profile = await signUp({ email, password, name, role, classSection });
      applyProfile(profile);
      setSuccess('Account created successfully! Redirecting to dashboard…');
      setTimeout(() => navigate('/dashboard', { replace: true }), 600);
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '28px', gap: 10 }}>
          <Logo variant="banner" darkMode={darkMode} width={280} height={72} />
          <p style={{ ...authSubtitleStyle(darkMode), margin: 0 }}>Create your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={authLabelStyle(darkMode)}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            required
            disabled={loading}
            style={authInputStyle(darkMode)}
          />

          <label style={{ ...authLabelStyle(darkMode), marginTop: 16 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@university.edu"
            required
            disabled={loading}
            style={authInputStyle(darkMode)}
          />

          <label style={{ ...authLabelStyle(darkMode), marginTop: 16 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
            minLength={6}
            disabled={loading}
            style={authInputStyle(darkMode)}
          />

          <div style={{ margin: '20px 0' }}>
            <label style={{ ...authLabelStyle(darkMode), display: 'inline-flex', alignItems: 'center', marginRight: 20, cursor: 'pointer' }}>
              <input type="radio" checked={role === 'student'} onChange={() => setRole('student')} style={{ marginRight: 8 }} />
              Student
            </label>
            <label style={{ ...authLabelStyle(darkMode), display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" checked={role === 'lecturer'} onChange={() => setRole('lecturer')} style={{ marginRight: 8 }} />
              Lecturer
            </label>
          </div>

          {role === 'student' && (
            <div style={{ marginBottom: 4 }}>
              <label style={authLabelStyle(darkMode)}>Class / Section</label>
              <select
                value={classSection}
                onChange={(e) => setClassSection(e.target.value)}
                required
                disabled={loading}
                style={{ ...authInputStyle(darkMode), cursor: 'pointer' }}
              >
                <option value="">Select your class…</option>
                <option value="Level 2">Level 2</option>
                <option value="Level 3">Level 3</option>
                <option value="Open">Open</option>
                <option value="__other">Other (type below)</option>
              </select>
              {classSection === '__other' && (
                <input
                  type="text"
                  onChange={(e) => setClassSection(e.target.value)}
                  placeholder="e.g. CST Year 2, Section A"
                  disabled={loading}
                  style={{ ...authInputStyle(darkMode), marginTop: 8 }}
                />
              )}
            </div>
          )}

          <AuthAlert type="error" message={error} />
          <AuthAlert type="success" message={success} />

          <button type="submit" disabled={loading} style={{ ...authBtnStyle, marginTop: 20, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating account…' : 'Sign Up'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: authSubtitleStyle(darkMode).color, fontSize: 13, marginTop: 20 }}>
          Already have an account?{' '}
          <Link to="/login" style={authLinkStyle}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
