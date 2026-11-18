import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { cn } from './ui';

// Light/dark switch for pages outside the app shell. `onDark` styles it for an always-dark header.
export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light view' : 'Switch to dark view'}
      title={dark ? 'Light view' : 'Dark view'}
      data-qa="theme-toggle"
      className={cn(
        'grid h-8 w-8 place-items-center rounded-lg border transition-colors',
        onDark
          ? 'border-slate-700 text-slate-300 hover:bg-white/10 hover:text-white'
          : 'border-[var(--line)] text-[var(--muted)] hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {dark ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}
