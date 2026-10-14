import React, { useState } from 'react';
import Logo from './Logo';
import AuthAlert from './AuthAlert';
import ClassSectionPicker from './ClassSectionPicker';
import { pickRole, logOut } from '../firebase/authService';
import { useAuth } from '../context/AuthContext';
import { mapAuthError } from '../utils/authErrors';
import { useThemePreference } from '../hooks/useThemePreference';
import {
  authPageStyle,
  authCardStyle,
  authBtnStyle,
  authSubtitleStyle,
  authLabelStyle,
  authLinkStyle,
} from './authStyles';

// Shown once to a signed-in user without a role (new Google users, or an email sign-up whose
// role call failed). The choice is final; only a super admin can change it later.
export default function RolePicker() {
  const { applyProfile } = useAuth();
  const { darkMode } = useThemePreference();
  const [role, setRole] = useState('student');
  const [classSection, setClassSection] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (role === 'student' && !classSection.trim()) {
      setError('Please select your class/year (and section/department).');
      return;
    }
    setError('');
    setLoading(true);
    try {
      applyProfile(await pickRole({ role, classSection }));
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={authPageStyle(darkMode)}>
      <div style={authCardStyle(darkMode)}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24, gap: 10 }}>
          <Logo variant="banner" darkMode={darkMode} width={280} height={72} />
          <p style={{ ...authSubtitleStyle(darkMode), margin: 0 }}>Are you a student or a lecturer?</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ margin: '0 0 8px' }}>
            {['student', 'lecturer'].map((value) => (
              <label
                key={value}
                style={{ ...authLabelStyle(darkMode), display: 'inline-flex', alignItems: 'center', marginRight: 20, cursor: 'pointer' }}
              >
                <input type="radio" checked={role === value} onChange={() => setRole(value)} style={{ marginRight: 8 }} />
                {value === 'student' ? 'Student' : 'Lecturer'}
              </label>
            ))}
          </div>
          <p style={{ ...authSubtitleStyle(darkMode), fontSize: 12, marginBottom: 16 }}>
            You can choose only once. To change it later, ask an administrator.
          </p>

          {role === 'student' && (
            <div style={{ marginBottom: 4 }}>
              <ClassSectionPicker value={classSection} onChange={setClassSection} darkMode={darkMode} />
            </div>
          )}

          <AuthAlert type="error" message={error} />

          <button type="submit" disabled={loading} style={{ ...authBtnStyle, marginTop: 20, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving…' : 'Continue'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 13, marginTop: 20 }}>
          <a href="/login" onClick={(e) => { e.preventDefault(); logOut(); }} style={authLinkStyle}>
            Sign out
          </a>
        </p>
      </div>
    </div>
  );
}
