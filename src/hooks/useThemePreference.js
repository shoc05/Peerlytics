import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'peerlytics-theme';

export function useThemePreference() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, darkMode ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [darkMode]);

  const toggleTheme = useCallback(() => setDarkMode((d) => !d), []);

  return { darkMode, setDarkMode, toggleTheme };
}
