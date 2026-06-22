import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type OnboardingState } from '../../lib/onboarding';
import { Button, Card } from '../ui';

// Dashboard "Getting started" card. Renders a role's onboarding steps as a live
// checklist (progress comes from real data via the caller's hook) and links each
// open step to where it's done. It's collapsible - never dismissed to nothing: the
// header (with a live progress count) always stays, so it can be re-opened. The
// collapsed/expanded choice is remembered per `storageKey`.
export function GettingStarted({ title, subtitle, state, storageKey, completeNote }: {
  title: string;
  subtitle?: string;
  state: OnboardingState;
  storageKey: string;
  // Shown once every step is done - e.g. "this covered one team; repeat for more".
  completeNote?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === '1');

  if (state.loading) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(storageKey, next ? '1' : '0');
  };
  const pct = state.total ? Math.round((state.doneCount / state.total) * 100) : 0;

  return (
    <Card className="border-brand-200 bg-gradient-to-br from-brand-50/80 to-white p-5 dark:border-brand-500/30 dark:from-brand-500/10 dark:to-slate-900">
      {/* Header doubles as the collapse toggle. */}
      <button onClick={toggle} className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={!collapsed}>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          {subtitle && !collapsed && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
          {state.complete ? 'Done 🎉' : `${state.doneCount}/${state.total}`}
          <span className={`inline-block text-xs transition-transform ${collapsed ? '' : 'rotate-180'}`} aria-hidden>▾</span>
          <span className="sr-only">{collapsed ? 'Expand checklist' : 'Collapse checklist'}</span>
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Progress */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{state.doneCount}/{state.total} done</span>
          </div>

          {state.complete ? (
            <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <p className="font-semibold">🎉 You’re all set - every step is done.</p>
              {completeNote && <p className="mt-1 text-emerald-700/90 dark:text-emerald-300/90">{completeNote}</p>}
            </div>
          ) : (
            <ol className="mt-4 space-y-1.5">
              {state.steps.map((s, i) => (
                <li
                  key={s.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    s.done
                      ? 'border-transparent bg-white/40 dark:bg-slate-800/30'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60'
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      s.done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                    aria-hidden
                  >
                    {s.done ? '✓' : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold ${s.done ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'}`}>{s.title}</div>
                    {!s.done && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{s.description}</div>}
                  </div>
                  {!s.done && (
                    <Link to={s.cta.to} className="shrink-0">
                      <Button size="sm" variant="subtle">{s.cta.label}</Button>
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  );
}
