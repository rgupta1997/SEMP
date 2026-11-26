import { useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { SPORT_ICON_KINDS, SportIcon } from '../features/schedule/ScheduleParts';

// The full-screen loader on a page refresh: a small sport line icon that changes,
// a slim bar, and a short line about what is loading. Only the app's first load uses it.

const LINES = [
  'Getting your events ready…',
  'Loading fixtures and results…',
  'Updating the standings…',
  'Checking live scores…',
  'Setting up your dashboard…',
  'Almost there…',
];
const ICON_MS = 900;
const LINE_MS = 2500;

export function SportsLoader({ notice }: {
  /** A status note (e.g. "can't reach the server"), pinned to the bottom of the screen. */
  notice?: ReactNode;
}) {
  const [icon, setIcon] = useState(0);
  const [line, setLine] = useState(0);
  useEffect(() => {
    // Still under reduced motion: one icon, one line.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = setInterval(() => setIcon((i) => (i + 1) % SPORT_ICON_KINDS.length), ICON_MS);
    // Stops on the last line rather than looping back to the first.
    const b = setInterval(() => setLine((l) => Math.min(l + 1, LINES.length - 1)), LINE_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  return (
    <div role="status" aria-label="Loading Sportagon" className="grid h-screen h-dvh place-items-center bg-[var(--canvas)] px-6 dark:bg-slate-950">
      <style>{`
        @keyframes sl-in { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
        @keyframes sl-bar { 0% { transform: translateX(-100%) } 100% { transform: translateX(250%) } }
        @media (prefers-reduced-motion: reduce) { .sl-anim { animation: none !important } }
      `}</style>
      <div className="flex w-full max-w-xs flex-col items-center text-center">
        <span key={`icon-${icon}`} className="sl-anim text-brand-600 dark:text-brand-400" style={{ animation: 'sl-in .35s ease-out both' }}>
          <SportIcon kind={SPORT_ICON_KINDS[icon]} size={28} />
        </span>
        {/* A slim indeterminate bar. */}
        <div className="mt-4 h-0.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden>
          <span className="sl-anim block h-full w-2/5 rounded-full bg-brand-600 dark:bg-brand-400" style={{ animation: 'sl-bar 1.1s ease-in-out infinite' }} />
        </div>
        <p key={`line-${line}`} className="sl-anim mt-5 text-[13px] font-medium text-slate-500 dark:text-slate-400" style={{ animation: 'sl-in .4s ease-out both' }}>
          {LINES[line]}
        </p>
        <div className="mt-8 opacity-60"><BrandMark height={16} /></div>
      </div>
      {notice && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center px-4">
          <div role="alert" className="flex max-w-lg flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 sm:rounded-full text-center text-[13px] text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {notice}
          </div>
        </div>
      )}
    </div>
  );
}
