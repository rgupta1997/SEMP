import { useState } from 'react';
import { Check, Lock, Minus } from 'lucide-react';
import type { Tier } from '@semp/entitlements';
import {
  actionFor,
  annualSavingPct,
  priceLabel,
  priceSuffix,
  type BillingPeriod,
  type LimitDefView,
  type PlanView,
} from '../lib/billing';
import { Badge, Button, Segmented, cn } from './ui';

// The plan table. One component, rendered on both ladders and on both surfaces
// that sell - a person's own plan page and an institution's billing panel.
//
// It is the ONLY place in the product where a price may appear. Every locked
// surface names the capability that is missing and routes here; here, naming
// what it costs is the entire job. Keeping that in one component is what stops
// the rule eroding one convenient exception at a time.

const TICK = <Check size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden />;
const DASH = <Minus size={14} className="text-slate-300 dark:text-slate-600" aria-hidden />;

export interface PlanComparisonProps {
  plans: PlanView[];
  /** The tier held right now, so one column can render as current. */
  current: Tier;
  limits: Record<string, LimitDefView>;
  /** Called when somebody picks a plan. Absent means read-only. */
  onChoose?: (plan: PlanView, period: BillingPeriod) => void;
  /**
   * When false, every action is replaced by a single "ask someone who can" -
   * a Sports Admin can see what the institution is missing and cannot buy it,
   * and a wall with no route out of it is a dead end.
   */
  mayBuy?: boolean;
  onRequestUpgrade?: (plan: PlanView) => void;
  /** A scheduled move down, so the column it targets can say so. */
  pendingPlan?: Tier | null;
}

export function PlanComparison({
  plans, current, limits, onChoose, mayBuy = true, onRequestUpgrade, pendingPlan,
}: PlanComparisonProps) {
  const [period, setPeriod] = useState<BillingPeriod>('annual');

  // Every capability across the ladder, in the order the cheapest plan that
  // includes it introduces it. Derived from what the server sent rather than
  // hand-ordered, so a new capability appears in the table by existing.
  const allCapabilities = plans.flatMap((p) => p.capabilities)
    .filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i);

  const limitKeys = Object.keys(plans[0]?.limits ?? {});

  return (
    <div className="flex flex-col gap-5">
      {/* The billing cycle applies across the whole table, so it sits above it
          rather than inside each column - three toggles that must agree is three
          chances for them not to. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'annual', label: 'Annual' },
          ]}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Prices exclude GST. Tax is added at checkout and shown on the invoice.
        </p>
      </div>

      {/* Columns. They scroll sideways on a narrow screen rather than stacking,
          because a plan table read one column at a time is not a comparison. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="grid min-w-[680px] grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.tier === current;
            const isPending = pendingPlan === plan.tier;
            const saving = period === 'annual' ? annualSavingPct(plan) : null;
            const action = actionFor(current, plan);

            return (
              <div
                key={plan.tier}
                className={cn(
                  'flex flex-col rounded-card border bg-white p-5 dark:bg-slate-900',
                  isCurrent
                    ? 'border-brand-500 ring-[3px] ring-brand-500/15'
                    : 'border-eos-line dark:border-slate-800',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-extrabold tracking-tight dark:text-slate-100">{plan.name}</h3>
                  {isCurrent && <Badge tone="brand">Current</Badge>}
                  {isPending && !isCurrent && <Badge tone="amber">Scheduled</Badge>}
                </div>

                <p className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {plan.tagline}
                </p>

                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold tracking-tight dark:text-slate-100">
                    {priceLabel(plan, period)}
                  </span>
                  {priceSuffix(plan, period) && (
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {priceSuffix(plan, period)}
                    </span>
                  )}
                </div>
                {/* Computed from the two prices, never written down - see
                    annualSavingPct. A stale "save 17%" outlives its price. */}
                <div className="min-h-[1.25rem]">
                  {saving !== null && (
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Two months free — save {saving}%
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  {!mayBuy && !isCurrent && plan.selfServe ? (
                    <Button variant="outline" className="w-full" onClick={() => onRequestUpgrade?.(plan)}>
                      Ask an admin
                    </Button>
                  ) : (
                    <Button
                      variant={action.kind === 'current' ? 'outline' : action.kind === 'downgrade' ? 'ghost' : 'primary'}
                      className="w-full"
                      disabled={action.disabled || !onChoose}
                      onClick={() => onChoose?.(plan, period)}
                    >
                      {action.label}
                    </Button>
                  )}
                </div>

                {/* What this plan ADDS. The full grid is below; this is the
                    reason somebody would move, in their own words. */}
                <ul className="mt-4 flex flex-col gap-2 border-t border-eos-line pt-4 dark:border-slate-800">
                  {plan.adds.map((line) => (
                    <li key={line} className="flex gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      <span className="mt-0.5 shrink-0">{TICK}</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* The grid. Shown rather than hidden behind a "compare plans" link:
          somebody who cannot see what they are missing assumes it does not
          exist, which is the same failure the locked surfaces exist to avoid. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="min-w-[680px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--canvas)] py-2 pr-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:bg-slate-950">
                What you get
              </th>
              {plans.map((p) => (
                <th key={p.tier} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {limitKeys.length > 0 && (
              <SectionRow label="Ceilings" span={plans.length + 1} />
            )}
            {limitKeys.map((key) => (
              <tr key={key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-[var(--canvas)] py-2.5 pr-3 text-left align-top text-xs font-medium text-slate-700 dark:bg-slate-950 dark:text-slate-300"
                  title={limits[key]?.counts}
                >
                  {limits[key]?.label ?? key}
                </th>
                {plans.map((p) => {
                  const cap = p.limits[key as keyof typeof p.limits];
                  return (
                    <td key={p.tier} className="border-t border-eos-line px-3 py-2.5 text-center text-xs dark:border-slate-800">
                      <span className={cn(
                        'font-semibold',
                        cap === null || cap === undefined
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-700 dark:text-slate-200',
                      )}>
                        {cap === null || cap === undefined ? 'Unlimited' : cap.toLocaleString('en-IN')}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}

            <SectionRow label="Features" span={plans.length + 1} />
            {allCapabilities.map((cap) => (
              <tr key={cap.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-[var(--canvas)] py-2.5 pr-3 text-left align-top text-xs font-medium text-slate-700 dark:bg-slate-950 dark:text-slate-300"
                >
                  {cap.label}
                  <span className="block text-[11px] font-normal leading-snug text-slate-400 dark:text-slate-500">
                    {cap.surface}
                  </span>
                </th>
                {plans.map((p) => (
                  <td key={p.tier} className="border-t border-eos-line px-3 py-2.5 text-center dark:border-slate-800">
                    <span className="inline-flex justify-center">
                      {p.capabilities.some((c) => c.key === cap.key) ? TICK : DASH}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        <Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Moving down never deletes anything. Work created on a higher plan stays where
          it is and becomes available again if you resubscribe.
        </span>
      </p>
    </div>
  );
}

function SectionRow({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <td
        colSpan={span}
        className="border-t border-eos-line pt-5 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800"
      >
        {label}
      </td>
    </tr>
  );
}
