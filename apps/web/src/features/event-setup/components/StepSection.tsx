import { forwardRef, type ReactNode } from 'react';
import { Check, Lock } from 'lucide-react';
import { cn } from '../../../components/ui';
import type { SectionState } from '../status';

const STATE_LABEL: Record<SectionState, string> = {
  done: 'Done',
  current: 'Next',
  open: 'Open',
  locked: 'Locked',
};

/**
 * One rung of the detail page's vertical stepper: a numbered marker on a rail, the
 * section's title and state, and its content. A locked section shows why it is
 * locked instead of controls that would do nothing.
 */
export const StepSection = forwardRef<HTMLLIElement, {
  n: number;
  id: string;
  title: string;
  state: SectionState;
  description?: ReactNode;
  lockedHint?: ReactNode;
  last?: boolean;
  aside?: ReactNode;
  children?: ReactNode;
}>(function StepSection({ n, id, title, state, description, lockedHint, last, aside, children }, ref) {
  const headingId = `${id}-title`;
  return (
    <li ref={ref} id={id} className="relative flex scroll-mt-20 gap-3 sm:gap-4">
      <div className="flex flex-col items-center" aria-hidden>
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold',
            state === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
            state === 'current' && 'border-brand-600 bg-brand-600 text-white ring-4 ring-brand-500/20',
            state === 'open' && 'border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300',
            state === 'locked' && 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600',
          )}
        >
          {state === 'done' ? <Check size={15} /> : state === 'locked' ? <Lock size={13} /> : n}
        </span>
        {!last && (
          <span className={cn('mt-1.5 w-0.5 flex-1 rounded-full', state === 'done' ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-slate-200 dark:bg-slate-800')} />
        )}
      </div>

      <section aria-labelledby={headingId} className={cn('min-w-0 flex-1', last ? 'pb-2' : 'pb-8')}>
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id={headingId} className={cn('t-section', state === 'locked' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100')}>
            <span className="sr-only">Step {n}: </span>{title}
          </h2>
          <div className="flex items-center gap-2">
            {aside}
            <span
              className={cn(
                't-eyebrow rounded-full px-2 py-0.5',
                state === 'done' && '!text-emerald-700 bg-emerald-50 dark:bg-emerald-500/15 dark:!text-emerald-300',
                state === 'current' && '!text-brand-700 bg-brand-50 dark:bg-brand-500/15 dark:!text-brand-300',
                (state === 'open' || state === 'locked') && 'bg-slate-100 dark:bg-slate-800',
              )}
            >
              {STATE_LABEL[state]}
            </span>
          </div>
        </div>
        {description && <p className="t-meta mt-1 max-w-prose">{description}</p>}
        {state === 'locked'
          ? lockedHint && <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">{lockedHint}</p>
          : children && <div className="mt-3">{children}</div>}
      </section>
    </li>
  );
});
