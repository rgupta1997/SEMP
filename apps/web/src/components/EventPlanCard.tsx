import { useState } from 'react';
import { Gem } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/hooks';
import { useEventPlan } from '../lib/eventPlan';
import { PlanChangeDialog } from './PlanChangeDialog';
import { cn } from './ui';

// The plan this event runs on, with its per-event ceilings and how much of each
// is used. Platform admins can pin the event to a plan from here.

const SOURCE: Record<string, string> = {
  org: 'From the organisation’s plan',
  pass: 'Event pass',
  admin: 'Set by Sportagon',
  legacy: 'Grandfathered - no limits',
};

export function EventPlanCard({ eventId, name }: { eventId: string; name: string }) {
  const { plan } = useEventPlan(eventId);
  const isSuper = !!useAuth()?.ctx?.user?.is_super_admin;
  const [changing, setChanging] = useState(false);
  if (!plan) return <div aria-label="Loading" className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-4 dark:border-slate-800">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm" aria-hidden><Gem size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-black text-slate-900 dark:text-slate-100">{plan.source === 'legacy' ? 'Unlimited' : plan.name}</span>
            {plan.locked
              ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Read-only</span>
              : plan.inGrace ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Grace period</span> : null}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{SOURCE[plan.source] ?? plan.source}</p>
        </div>
        {isSuper && (
          <button type="button" onClick={() => setChanging(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Change plan
          </button>
        )}
      </header>
      {plan.inGrace && plan.graceUntil && (
        <p className="border-b border-slate-100 bg-amber-50/60 px-4 py-2.5 text-xs font-semibold text-amber-800 dark:border-slate-800 dark:bg-amber-500/10 dark:text-amber-200">
          Keeps running as it is until {fmtDate(plan.graceUntil)}.
        </p>
      )}
      {plan.source === 'legacy' ? (
        <p className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">This event has no limits.</p>
      ) : (
        // What the plan allows per event, and how much of it is used.
        <ul className="grid gap-3 p-4 sm:grid-cols-2">
          {plan.limits.map((l) => {
            const pct = l.fraction === null ? null : Math.round(l.fraction * 100);
            return (
              <li key={l.key} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{l.label}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{l.current.toLocaleString('en-IN')}</span>
                  <span className="text-sm font-semibold text-slate-400">/ {l.capLabel}</span>
                </div>
                {pct !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-brand-500')} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {changing && (
        <PlanChangeDialog target={{ kind: 'event', id: eventId, name, current: plan.source === 'legacy' ? null : plan.tier }} onClose={() => setChanging(false)} />
      )}
    </section>
  );
}
