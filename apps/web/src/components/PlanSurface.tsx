import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Download, Receipt } from 'lucide-react';
import type { Tier } from '@semp/entitlements';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import {
  EVENT_LABEL,
  formatDate,
  formatPaise,
  isDowngrade,
  type BillingPeriod,
  type BillingState,
  type PlanView,
  type PlansResponse,
  type UsageMeter,
} from '../lib/billing';
import { PlanComparison } from './PlanComparison';
import { CheckoutModal } from './CheckoutModal';
import {
  Badge, Button, Card, CardBody, Spinner, Table, TD, TH, THead, TR,
  cn, confirmDialog, toast,
} from './ui';

// Everything a plan surface is made of, shared by the two that exist: a person's
// own plan page and an institution's Billing & Subscription tab.
//
// One component rather than two because they differ only in which ladder they
// read and who is allowed to buy - and the prototype's two copies had already
// drifted, describing the same downgrade in two different ways. What differs is
// passed in; what is the same is here.

export interface PlanSurfaceProps {
  ladder: 'org' | 'personal';
  /** Where the current state is read from - /billing/me or /billing/org/:id. */
  statePath: string;
  /** Prefix for the mutations: '/billing/me' or '/billing/org/:id'. */
  actionPath: string;
}

export function PlanSurface({ ladder, statePath, actionPath }: PlanSurfaceProps) {
  const plans = useApi<PlansResponse>('/billing/plans');
  const state = useApi<BillingState>(statePath);
  const qc = useQueryClient();
  const [checkout, setCheckout] = useState<{ plan: PlanView; period: BillingPeriod } | null>(null);

  if (plans.isLoading || state.isLoading) return <Spinner label="Loading plans…" />;
  if (!plans.data || !state.data) return null;

  const ladderPlans = ladder === 'org' ? plans.data.org : plans.data.personal;
  const current = state.data.tier;
  const sub = state.data.subscription;

  /**
   * Refetch everything the plan governs, not just the plan.
   *
   * A tier change re-evaluates every gated surface in the workspace, and the
   * entitlement snapshot is what the shell renders those from. Refreshing only
   * this page would leave the sidebar and every lock showing the plan the person
   * had a moment ago.
   */
  function refreshAll() {
    qc.invalidateQueries({ queryKey: [statePath] });
    qc.invalidateQueries({ queryKey: ['/me/entitlements'] });
  }

  async function choose(plan: PlanView, period: BillingPeriod) {
    if (!plan.selfServe) {
      toast.info(`${plan.name} is arranged with us directly`, 'Write to play@sportagon.in and we will set it up.');
      return;
    }
    if (plan.tier === current) return;

    if (isDowngrade(current, plan.tier)) {
      const until = sub ? formatDate(sub.current_period_end) : 'the end of your current period';
      const ok = await confirmDialog({
        title: `Move down to ${plan.name}?`,
        message: `Nothing changes until ${until} — you keep everything you have paid for until then. After that, features not on ${plan.name} become unavailable. Nothing you have created is deleted, and it all comes back if you resubscribe.`,
        confirmLabel: 'Schedule it',
      });
      if (!ok) return;
      try {
        await api('POST', `${actionPath}/schedule-downgrade`, { plan: plan.tier });
        toast.success('Scheduled', `You move to ${plan.name} on ${until}.`);
        refreshAll();
      } catch (e: any) {
        toast.error('Could not schedule that', e?.message);
      }
      return;
    }

    setCheckout({ plan, period });
  }

  async function requestUpgrade(plan: PlanView) {
    try {
      await api('POST', `${actionPath}/request-upgrade`, { plan: plan.tier });
      toast.success('Sent', 'The people who can change the plan have been notified.');
    } catch (e: any) {
      toast.error('Could not send that', e?.message);
    }
  }

  async function cancelScheduled() {
    try {
      await api('POST', `${actionPath}/cancel-scheduled`);
      toast.success('Called off', 'Your plan stays as it is.');
      refreshAll();
    } catch (e: any) {
      toast.error('Could not call that off', e?.message);
    }
  }

  const currentPlan = ladderPlans.find((p) => p.tier === current);

  return (
    <div className="flex flex-col gap-5">
      {/* ---- where you are ---- */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Current plan
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xl font-extrabold tracking-tight dark:text-slate-100">
                  {currentPlan?.name ?? current}
                </span>
                {sub && <Badge tone="slate">Billed {sub.period === 'annual' ? 'annually' : 'monthly'}</Badge>}
              </div>
              {currentPlan && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{currentPlan.tagline}</p>
              )}
            </div>

            {sub && (
              <dl className="text-right text-xs">
                <dt className="font-semibold text-slate-400">
                  {sub.status === 'pending_downgrade' ? 'Runs until' : 'Renews'}
                </dt>
                <dd className="mt-0.5 font-semibold tabular-nums dark:text-slate-200">
                  {formatDate(sub.current_period_end)}
                </dd>
              </dl>
            )}
          </div>

          {/* A scheduled move down is the single most important thing on this
              page when it exists, so it is stated here rather than only shown as
              a badge on a column somebody has to scroll to. */}
          {sub?.status === 'pending_downgrade' && sub.pending_plan && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-3.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <CalendarClock size={15} className="shrink-0" aria-hidden />
              <span className="flex-1">
                Moving to <strong className="font-semibold">
                  {ladderPlans.find((p) => p.tier === sub.pending_plan)?.name ?? sub.pending_plan}
                </strong> on {formatDate(sub.pending_effective_at)}. Everything on your
                current plan works until then.
              </span>
              {state.data.mayBuy && (
                <Button size="sm" variant="outline" onClick={cancelScheduled}>Keep current plan</Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---- what you have used ---- */}
      {state.data.usage.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              What this plan includes
            </h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {state.data.usage.map((m) => <Meter key={m.key} meter={m} />)}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ---- the table ---- */}
      <Card>
        <CardBody>
          <PlanComparison
            plans={ladderPlans}
            current={current}
            limits={plans.data.limits}
            onChoose={choose}
            mayBuy={state.data.mayBuy}
            onRequestUpgrade={requestUpgrade}
            pendingPlan={sub?.pending_plan ?? null}
          />
        </CardBody>
      </Card>

      {/* ---- what you have been billed ---- */}
      {state.data.invoices.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <Receipt size={13} aria-hidden /> Invoices
            </h3>
            <div className="mt-3">
              <Table>
                <THead>
                  <TH>Number</TH>
                  <TH>Issued</TH>
                  <TH>Plan</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Status</TH>
                </THead>
                <tbody>
                  {state.data.invoices.map((inv) => (
                    <TR key={inv.id}>
                      <TD className="font-mono text-xs">{inv.number}</TD>
                      <TD className="text-xs">{formatDate(inv.issued_at)}</TD>
                      <TD className="text-xs capitalize">
                        {ladderPlans.find((p) => p.tier === inv.plan)?.name ?? inv.plan}
                        <span className="text-slate-400"> · {inv.period}</span>
                      </TD>
                      <TD className="text-right text-xs font-semibold tabular-nums">
                        {formatPaise(inv.total_paise)}
                      </TD>
                      <TD>
                        {/* An invoice marked paid against provider 'none' is one
                            no money moved for. Saying so beats a green tick that
                            implies a payment nobody made. */}
                        <Badge tone={inv.provider === 'none' ? 'amber' : 'green'}>
                          {inv.provider === 'none' ? 'Awaiting settlement' : inv.status}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Download size={12} aria-hidden /> PDF invoices arrive with online payment.
            </p>
          </CardBody>
        </Card>
      )}

      {/* ---- how it got here ---- */}
      {state.data.history && state.data.history.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Plan history
            </h3>
            <ul className="mt-3 flex flex-col gap-2.5">
              {state.data.history.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-semibold dark:text-slate-200">
                    {EVENT_LABEL[e.kind] ?? e.kind}
                  </span>
                  {e.from_plan && e.to_plan && e.from_plan !== e.to_plan && (
                    <span className="text-slate-500 dark:text-slate-400">
                      {planName(ladderPlans, e.from_plan)} → {planName(ladderPlans, e.to_plan)}
                    </span>
                  )}
                  <span className="ml-auto tabular-nums text-slate-400">{formatDate(e.created_at)}</span>
                  {e.note && (
                    <span className="w-full text-slate-400">“{e.note}”</span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {checkout && (
        <CheckoutModal
          plan={checkout.plan}
          period={checkout.period}
          ladder={ladder}
          contact={state.data.contact ?? null}
          subscribePath={`${actionPath}/subscribe`}
          contactPath={ladder === 'org' ? `${actionPath}/contact` : undefined}
          onClose={() => setCheckout(null)}
          onDone={() => { setCheckout(null); refreshAll(); }}
        />
      )}
    </div>
  );
}

function planName(plans: PlanView[], tier: Tier): string {
  return plans.find((p) => p.tier === tier)?.name ?? tier;
}

/**
 * One ceiling and how far into it you are.
 *
 * The bar turns amber before it turns full, so somebody with two events left on
 * a plan that includes five finds out from the panel rather than from a refused
 * create - which is the whole difference between a soft limit and a wall.
 */
function Meter({ meter }: { meter: UsageMeter }) {
  const pct = meter.fraction === null ? 0 : Math.round(meter.fraction * 100);
  const tight = meter.fraction !== null && meter.fraction >= 0.8;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{meter.label}</span>
        <span className={cn(
          'text-xs font-semibold tabular-nums',
          meter.ok ? 'text-slate-700 dark:text-slate-200' : 'text-amber-600 dark:text-amber-400',
        )}>
          {meter.current.toLocaleString('en-IN')}
          <span className="font-normal text-slate-400"> / {meter.capLabel}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            !meter.ok ? 'bg-amber-500' : tight ? 'bg-amber-400' : 'bg-brand-500',
          )}
          style={{ width: meter.cap === null ? '100%' : `${Math.min(100, pct)}%` }}
        />
      </div>
      {!meter.ok && (
        <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle size={11} aria-hidden />
          No room for another {meter.unit} on this plan
        </p>
      )}
    </div>
  );
}
