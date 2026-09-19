import { useEffect, useState } from 'react';
import { themeStorage } from './browserStorage';

export type Theme = 'light' | 'dark';

export function getInitialTheme(): Theme {
  const stored = themeStorage.get();
  if (stored === 'light' || stored === 'dark') return stored;
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// Tracks the active theme, persists it, and toggles `.dark` on <html>.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    themeStorage.set(theme);
  }, [theme]);
  return { theme, setTheme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
