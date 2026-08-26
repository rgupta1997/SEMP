import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { TourStep } from '../../lib/onboarding';
import { Button } from '../ui';

// Lightweight spotlight tour. `startTour(steps)` dims the page, rings the current
// step's target (`[data-tour="<target>"]`) and floats a tooltip beside it. No deps:
// the cut-out is a transparent box with a huge spread box-shadow. Targets that are
// missing or off-screen (e.g. a collapsed mobile sidebar) are skipped automatically.

interface TourApi { start: (steps: TourStep[]) => void }
const TourContext = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within a TourProvider');
  return ctx;
}

interface Rect { top: number; left: number; width: number; height: number }

function rectOf(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // hidden (e.g. drawer closed)
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const start = useCallback((s: TourStep[]) => { setSteps(s); setIndex(0); }, []);
  const stop = useCallback(() => { setSteps(null); setRect(null); }, []);

  const step = steps?.[index] ?? null;

  // Position the spotlight on the current target; recompute on resize/scroll.
  useLayoutEffect(() => {
    if (!step) return;
    const place = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      setRect(rectOf(step.target));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [step]);

  // Esc closes the tour.
  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps, stop]);

  const next = () => {
    if (!steps) return;
    if (index >= steps.length - 1) stop();
    else setIndex((i) => i + 1);
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  // Tooltip sits below the target, or centred if we couldn't find it.
  const tipTop = rect ? Math.min(rect.top + rect.height + 12, window.innerHeight - 200) : window.innerHeight / 2 - 80;
  const tipLeft = rect ? Math.max(12, Math.min(rect.left, window.innerWidth - 332)) : window.innerWidth / 2 - 160;

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {step && (
        <div className="fixed inset-0 z-[800]" role="dialog" aria-modal="true">
          {/* Backdrop + spotlight ring (or a plain dim layer when no target). */}
          {rect ? (
            <div
              className="pointer-events-none absolute rounded-xl ring-2 ring-brand-400 transition-all duration-200"
              style={{
                top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8,
                boxShadow: '0 0 0 9999px rgba(15,23,42,0.65)',
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-slate-900/65" onClick={stop} />
          )}

          {/* Click-catcher so clicks outside the tooltip dismiss the tour. */}
          <div className="absolute inset-0" onClick={stop} />

          <div
            className="absolute w-[320px] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            style={{ top: tipTop, left: tipLeft }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{step.title}</h4>
              <span className="text-xs text-slate-400">{index + 1}/{steps!.length}</span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">{step.body}</p>
            <div className="mt-4 flex items-center justify-between">
              <button onClick={stop} className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Skip tour</button>
              <div className="flex gap-2">
                {index > 0 && <Button size="sm" variant="ghost" onClick={prev}>Back</Button>}
                <Button size="sm" onClick={next}>{index >= steps!.length - 1 ? 'Done' : 'Next'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </TourContext.Provider>
  );
}
