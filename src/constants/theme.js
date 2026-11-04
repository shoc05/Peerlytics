export const COLORS = {
  primary: '#1D9E75',
  primaryDark: '#0F6E56',
  primaryLight: '#7cb89a',
  mint: '#a8d5bc',
  mintBg: '#f0f7f4',
  canvas: '#e8eeeb',
  forest: '#2d5a47',
  accent: '#4facfe',
  warning: '#ffc107',
  danger: '#e74c3c',
  text: '#1a2e24',
  textMuted: '#5f6f66',
};

export const GRADIENT = 'linear-gradient(135deg, #7cb89a 0%, #1D9E75 100%)';
export const GRADIENT_BTN = 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)';

export const FILE_DIFFICULTY = {
  code: 3,
  document: 2,
  spreadsheet: 1.5,
  presentation: 1,
};

// public/ files live under Vite's base ('/' or e.g. '/peerlytics/' on GitHub Pages).
const BASE = import.meta.env?.BASE_URL ?? '/';
export const LOGO_SRC = `${BASE}logo.png`;
export const LOGO_DARK_SRC = `${BASE}logo2.png`;
// Icon-only mark (no wordmark). Drop logo-mark.png and logo-mark-dark.png into public/.
// Falls back to the wordmark logo until those files exist.
export const LOGO_MARK_SRC = `${BASE}logo-mark.png`;
export const LOGO_MARK_DARK_SRC = `${BASE}logo-mark-dark.png`;
