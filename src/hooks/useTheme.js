import { GRADIENT_BTN, COLORS } from '../constants/theme';

export function useTheme(darkMode) {
  const card = {
    background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
    border: `1px solid ${darkMode ? '#2e2e2e' : '#e0e0e0'}`,
    borderRadius: '12px',
    padding: '24px',
    backdropFilter: 'blur(10px)',
  };

  const muted = darkMode ? '#9a9a9a' : '#666';
  const text = darkMode ? '#ededed' : '#0d0d0d';
  const bg = darkMode ? '#0d0d0d' : '#f5f7fa';
  const sidebar = darkMode ? 'rgba(15, 20, 40, 0.6)' : 'rgba(255, 255, 255, 0.8)';
  const inputBg = darkMode ? '#121212' : '#f9f9f9';
  const border = darkMode ? '#2e2e2e' : '#e0e0e0';

  const btnPrimary = {
    background: GRADIENT_BTN,
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 600,
  };

  return { card, muted, text, bg, sidebar, inputBg, border, btnPrimary, primary: COLORS.primary, gradient: GRADIENT_BTN };
}
