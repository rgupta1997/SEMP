import { cn } from '../../components/ui';
import { PERSONAL_NAVY } from './styles';

// Loading placeholders in the shape of the event cards they stand in for,
// so the page keeps its layout when the data lands.

const Bar = ({ className }: { className: string }) => <span className={cn('block animate-pulse rounded-full bg-slate-200 dark:bg-slate-800', className)} />;
const DarkBar = ({ className }: { className: string }) => <span className={cn('block animate-pulse rounded-full bg-white/10', className)} />;
const SHELL = 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';

/** My Events: a ticket with its navy date stub. */
export function TicketSkeleton() {
  return (
    <div className={cn('flex', SHELL)}>
      <div className={cn('relative flex w-20 shrink-0 flex-col items-center justify-center gap-2 px-2 py-4 sm:w-24', PERSONAL_NAVY)}>
        <DarkBar className="h-2 w-8 bg-[var(--accent)]/30" />
        <DarkBar className="h-8 w-10" />
        <DarkBar className="h-2 w-12" />
        <span aria-hidden className="absolute inset-y-3 right-0 border-r-2 border-dashed border-white/15" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-2.5 p-4">
          <div className="flex items-start justify-between gap-3"><Bar className="h-4 w-3/5" /><Bar className="h-5 w-16" /></div>
          <div className="flex gap-3"><Bar className="h-3 w-32" /><Bar className="h-3 w-20" /></div>
          <div className="flex gap-1.5">{['w-20', 'w-24', 'w-16'].map((w) => <Bar key={w} className={cn('h-5', w)} />)}</div>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <div className="flex gap-1.5"><Bar className="h-4 w-16 bg-[var(--accent)]/25" /><Bar className="h-4 w-14" /></div>
          <Bar className="h-3.5 w-20" />
        </div>
      </div>
    </div>
  );
}

/** Discover: a poster with its navy band, sport icons, name and entry row. */
export function PosterSkeleton() {
  return (
    <div className={cn('flex flex-col', SHELL)}>
      <div className={cn('space-y-3 px-4 pb-4 pt-3', PERSONAL_NAVY)}>
        <div className="flex items-center justify-between"><DarkBar className="h-5 w-24" /><DarkBar className="h-2.5 w-20 bg-[var(--accent)]/25" /></div>
        <DarkBar className="h-5 w-44" />
        <div className="flex gap-1.5">{[0, 1, 2, 3].map((i) => <span key={i} className="h-7 w-7 animate-pulse rounded-full bg-white/10" />)}</div>
      </div>
      <div className="flex-1 space-y-2 p-4">
        <Bar className="h-4 w-4/5" />
        <Bar className="h-3 w-28" />
        <Bar className="h-2.5 w-3/5" />
      </div>
      <div className="flex min-h-[52px] items-center justify-between border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <Bar className="h-3.5 w-16" /><Bar className="h-8 w-24 bg-[var(--accent)]/25" />
      </div>
    </div>
  );
}
