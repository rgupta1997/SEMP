import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/hooks';
import { useEventPlan } from '../lib/eventPlan';
import { PlanChangeDialog } from './PlanChangeDialog';
import { Badge, Button, Card, CardBody, CardHeader, Progress } from './ui';

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
  if (!plan) return null;

  return (
    <Card>
      <CardHeader title="Plan" />
      <CardBody>
        <div className="flex items-center gap-2">
          <span className="text-lg font-extrabold tracking-tight dark:text-slate-100">{plan.source === 'legacy' ? 'Unlimited' : plan.name}</span>
          {plan.locked ? <Badge tone="rose">read-only</Badge> : plan.inGrace ? <Badge tone="amber">grace period</Badge> : null}
        </div>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{SOURCE[plan.source] ?? plan.source}</p>
        {plan.inGrace && plan.graceUntil && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Keeps running as it is until {fmtDate(plan.graceUntil)}.</p>
        )}
        {plan.source !== 'legacy' && (
          <div className="mt-4 space-y-3">
            {plan.limits.map((l) => (
              <div key={l.key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{l.label}</span>
                  <span className="tabular-nums text-slate-500 dark:text-slate-400">{l.current.toLocaleString('en-IN')} / {l.capLabel}</span>
                </div>
                {l.fraction !== null && <Progress value={Math.round(l.fraction * 100)} />}
              </div>
            ))}
          </div>
        )}
        {isSuper && (
          <Button size="sm" variant="outline" className="mt-4 w-full" onClick={() => setChanging(true)}>Change event plan (platform admin)</Button>
        )}
      </CardBody>
      {changing && (
        <PlanChangeDialog target={{ kind: 'event', id: eventId, name, current: plan.source === 'legacy' ? null : plan.tier }} onClose={() => setChanging(false)} />
      )}
    </Card>
  );
}
