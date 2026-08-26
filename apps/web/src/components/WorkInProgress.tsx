import type { ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { Card, PageHeader } from './ui';

// A parked surface, said out loud.
//
// These are epics whose API is built and tested but whose screen is deliberately not
// scheduled yet. A blank page or a missing nav item would read as a bug; saying "the
// data is ready, the screen is not" is the honest version, and it stops somebody
// filing the same question twice.

export function WorkInProgress({ title, subtitle, epic, whatWorks, children }: {
  /** Omitted when this renders inside a tab that already has a page header. */
  title?: string;
  subtitle?: string;
  /** The epic this screen belongs to, so it can be traced back to the roadmap. */
  epic: string;
  /** What already exists behind it - the reason this is parked, not missing. */
  whatWorks: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-5">
      {title && <PageHeader title={title} subtitle={subtitle} />}
      <Card className="p-8 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
          <Construction size={22} aria-hidden />
        </span>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">UI work in progress</h2>
        <p className="mx-auto mt-2 max-w-prose text-sm text-slate-600 dark:text-slate-400">{whatWorks}</p>
        <p className="mt-4 inline-block rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {epic}
        </p>
        {children}
      </Card>
    </div>
  );
}
