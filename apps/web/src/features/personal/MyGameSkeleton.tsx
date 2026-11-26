import { cn } from '../../components/ui';
import { HEX_CLIP, PERSONAL_NAVY } from './styles';

// My Game while it loads: the page's own shape (hero, fixture card, stat band, cards),
// so nothing jumps when the data lands.

const CARD = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
/** A shimmering bar on a light card. */
const Bar = ({ className }: { className: string }) => <span className={cn('block animate-pulse rounded-full bg-slate-200 dark:bg-slate-800', className)} />;
/** The same on the navy hero. */
const DarkBar = ({ className }: { className: string }) => <span className={cn('block animate-pulse rounded-full bg-white/10', className)} />;

function CardHead({ action = false }: { action?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <span className="flex items-center gap-2.5">
        <span className="h-8 w-8 animate-pulse rounded-xl bg-[var(--accent)]/15" />
        <span className="space-y-1.5"><Bar className="h-3 w-28" /><Bar className="h-2.5 w-16" /></span>
      </span>
      {action && <Bar className="h-8 w-28" />}
    </div>
  );
}

export function MyGameSkeleton() {
  return (
    <div className="space-y-5 pb-16" role="status" aria-label="Loading My Game">
      {/* Hero: badge and greeting, the fixture card, the stat band. */}
      <section className={cn('overflow-hidden rounded-2xl shadow-lg', PERSONAL_NAVY)}>
        <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
          <div className="flex items-center gap-4">
            <span className="h-[64px] w-[56px] shrink-0 animate-pulse bg-white/10 max-sm:hidden" style={{ clipPath: HEX_CLIP }} />
            <div className="min-w-0 flex-1 space-y-2.5">
              <DarkBar className="h-2.5 w-44 bg-[var(--accent)]/30" />
              <DarkBar className="h-7 w-64 max-w-full" />
              <div className="flex gap-1.5">{['w-16', 'w-14', 'w-14'].map((w, i) => <DarkBar key={i} className={`h-5 ${w}`} />)}</div>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-black/30 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800"><Bar className="h-2.5 w-24 bg-[var(--accent)]/25" /><Bar className="h-4 w-24" /></div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4">
              {[0, 1].map((side) => (
                <span key={side} className={cn('flex flex-col items-center gap-2', side === 1 && 'order-last')}>
                  <span className="h-10 w-10 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                  <Bar className="h-3 w-20" />
                </span>
              ))}
              <span className="flex flex-col items-center gap-1.5"><Bar className="h-6 w-20" /><Bar className="h-2.5 w-14" /></span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/40"><Bar className="h-3 w-36" /><Bar className="h-8 w-28 bg-[var(--accent)]/30" /></div>
          </div>
        </div>
        <div className="grid grid-cols-6 border-t border-white/10 bg-black/25 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={cn('col-span-2 space-y-2 border-r border-white/10 px-3 py-3 sm:px-4 lg:col-span-1', i >= 3 && 'border-t lg:border-t-0')}>
              <DarkBar className="h-5 w-10" /><DarkBar className="h-2 w-14" />
            </div>
          ))}
          <div className="col-span-6 flex items-center gap-2 border-t border-white/10 px-3 py-3 sm:px-4 lg:col-span-1 lg:border-t-0">
            <DarkBar className="h-2 w-8" />{[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-6 w-6 animate-pulse rounded-md bg-white/10" />)}
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Recent results: date tile, two scoreline rows, result tag. */}
        <section className={CARD}>
          <CardHead action />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first-of-type:border-t-0 dark:border-slate-800">
              <span className="h-11 w-11 shrink-0 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
              <span className="min-w-0 flex-1 space-y-2">
                {[0, 1].map((r) => (
                  <span key={r} className="flex items-center gap-2.5">
                    <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                    <Bar className="h-3 flex-1" /><Bar className="h-3 w-6" />
                  </span>
                ))}
                <Bar className="h-2.5 w-40" />
              </span>
              <Bar className="h-5 w-14 shrink-0" />
            </div>
          ))}
        </section>

        <aside className="space-y-5">
          {/* My teams. */}
          <section className={CARD}>
            <CardHead />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 first-of-type:border-t-0 dark:border-slate-800">
                <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                <span className="min-w-0 flex-1 space-y-1.5"><Bar className="h-3 w-32" /><Bar className="h-2.5 w-20" /></span>
                <Bar className="h-4 w-14" />
              </div>
            ))}
          </section>
          {/* Jump to. */}
          <section className={CARD}>
            <CardHead />
            <div className="grid grid-cols-2 gap-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="flex items-center gap-2.5 rounded-xl border border-slate-100 p-2.5 dark:border-slate-800">
                  <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-[var(--accent)]/15" />
                  <span className="min-w-0 flex-1 space-y-1.5"><Bar className="h-2.5 w-full" /><Bar className="h-2 w-2/3" /></span>
                </span>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
