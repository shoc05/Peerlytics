export const authPageStyle = (darkMode = false) => ({
  minHeight: '100vh',
  position: 'relative',
  background: darkMode
    ? 'linear-gradient(135deg, #242424 0%, #2e2e2e 100%)'
    : 'linear-gradient(160deg, #f0f7f4 0%, #e8f0eb 50%, #dce8e0 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  padding: '20px',
});

export const authCardStyle = (darkMode = false) => ({
  // Black inner card matching the logo's black box; the page sits lighter (grey) behind it.
  background: darkMode ? '#000000' : '#ffffff',
  padding: '40px',
  borderRadius: '16px',
  border: `1px solid ${darkMode ? '#1a1a1a' : '#dce5e0'}`,
  width: '100%',
  maxWidth: '420px',
  boxShadow: darkMode
    ? '0 20px 60px rgba(0,0,0,0.45)'
    : '0 8px 32px rgba(45, 74, 62, 0.12)',
});

export const authTitleStyle = (darkMode = false) => ({
  color: darkMode ? '#ededed' : '#1a2e24',
  margin: '0 0 10px 0',
  fontSize: '28px',
  fontWeight: 700,
});

export const authSubtitleStyle = (darkMode = false) => ({
  color: darkMode ? '#9a9a9a' : '#5f6f66',
  margin: 0,
  fontSize: '14px',
});

export const authLabelStyle = (darkMode = false) => ({
  display: 'block',
  marginBottom: '8px',
  color: darkMode ? '#ededed' : '#1a2e24',
  fontSize: '14px',
  fontWeight: 500,
});

export const authInputStyle = (darkMode = false) => ({
  width: '100%',
  padding: '12px',
  border: `1px solid ${darkMode ? '#2a2a2a' : '#dce5e0'}`,
  borderRadius: '8px',
  background: darkMode ? '#141414' : '#fafcfb',
  color: darkMode ? '#ededed' : '#1a2e24',
  fontSize: '14px',
  boxSizing: 'border-box',
});

export const authBtnStyle = {
  width: '100%',
  padding: '12px',
  background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: '600',
  cursor: 'pointer',
};

export const authLinkStyle = {
  color: '#1D9E75',
  textDecoration: 'none',
  fontWeight: 600,
};
