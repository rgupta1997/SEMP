import { useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { SPORT_ICON_KINDS, SportIcon } from '../features/schedule/ScheduleParts';

// The full-screen loader on a page refresh: a small sport line icon that changes,
// a slim bar, and one line of a sports quote. Only the app's first load uses it.

const QUOTES: Array<[string, string]> = [
  ['The more difficult the victory, the greater the happiness in winning.', 'Pelé'],
  ['You miss 100% of the shots you don\'t take.', 'Wayne Gretzky'],
  ['I\'ve failed over and over again in my life. And that is why I succeed.', 'Michael Jordan'],
  ['People throw stones at you and you convert them into milestones.', 'Sachin Tendulkar'],
  ['Champions keep playing until they get it right.', 'Billie Jean King'],
  ['It\'s not whether you get knocked down, it\'s whether you get up.', 'Vince Lombardi'],
  ['Hard work beats talent when talent doesn\'t work hard.', 'Tim Notke'],
];
const ICON_MS = 900;
const QUOTE_MS = 4000;

export function SportsLoader({ notice }: {
  /** A status note (e.g. "can't reach the server"), pinned to the bottom of the screen. */
  notice?: ReactNode;
}) {
  const [icon, setIcon] = useState(0);
  const [quote, setQuote] = useState(() => Math.floor(Math.random() * QUOTES.length));
  useEffect(() => {
    // Still under reduced motion: one icon, one quote.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = setInterval(() => setIcon((i) => (i + 1) % SPORT_ICON_KINDS.length), ICON_MS);
    const b = setInterval(() => setQuote((q) => (q + 1) % QUOTES.length), QUOTE_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  const [text, by] = QUOTES[quote];

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
        <p key={`quote-${quote}`} className="sl-anim mt-5 text-[13px] leading-snug text-slate-500 dark:text-slate-400" style={{ animation: 'sl-in .5s ease-out both' }}>
          “{text}” <span className="whitespace-nowrap font-semibold text-slate-600 dark:text-slate-300">- {by}</span>
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
