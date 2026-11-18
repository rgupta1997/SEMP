import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Button, Field, Input, Modal, Select, Textarea, toast } from './ui';

// Super-admin only: put an organisation, a person or ONE event on any plan.
// Used from the platform Organizations and Users lists, the org's billing panel
// and an event's settings - "from wherever we are driving it".
//
// Org / person: any tier, any direction, takes effect at once, no invoice.
// An optional end date makes it temporary (it drops to Free on that date).
// Event: pins the event to a plan independent of its host, or hands it back.

type Target =
  | { kind: 'org'; id: string; name: string; current?: string | null }
  | { kind: 'user'; id: string; name: string; current?: string | null }
  | { kind: 'event'; id: string; name: string; current?: string | null };

interface CatalogLite {
  tiers: string[];
  tierLabels: { org: Record<string, string>; personal: Record<string, string> };
}

export function PlanChangeDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const { data: cat } = useApi<CatalogLite>('/platform/billing/catalog');
  const labels = target.kind === 'user' ? cat?.tierLabels.personal : cat?.tierLabels.org;
  const tiers = (cat?.tiers ?? ['free', 'starter', 'pro', 'max']).filter((t) => !(target.kind === 'user' && t === 'starter'));

  const [plan, setPlan] = useState<string>(target.current && target.current !== 'legacy' ? target.current : 'pro');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');

  const path = target.kind === 'org'
    ? `/platform/billing/orgs/${target.id}/plan`
    : target.kind === 'user'
      ? `/platform/billing/users/${target.id}/plan`
      : `/platform/billing/championships/${target.id}/plan`;

  const save = useApiMutation(
    (body: Record<string, unknown>) => api('PUT', path, body),
    ['/organizations', '/users', '/me/entitlements', `/championships/${target.id}/plan`, path],
  );

  const submit = (body: Record<string, unknown>, done: string) =>
    save.mutate(body, {
      onSuccess: () => { toast.success(done); onClose(); },
      onError: (e: any) => toast.error('Could not change the plan', e.message),
    });

  const label = (t: string) => labels?.[t] ?? t;

  return (
    <Modal
      title={`Change plan - ${target.name}`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {target.kind === 'event' && (
            <Button variant="ghost" disabled={save.isPending} onClick={() => submit({ plan: null, note: note || null }, 'Event follows its organisation’s plan again')}>
              Follow the organisation’s plan
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={save.isPending}
            onClick={() => submit(
              target.kind === 'event'
                ? { plan, note: note || null }
                : { plan, until: until ? new Date(`${until}T23:59:59`).toISOString() : null, note: note || null },
              `${target.name} is now on ${label(plan)}`,
            )}
          >
            {save.isPending ? 'Saving…' : 'Change plan'}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {target.kind === 'event'
          ? 'Pins this one event to a plan, whatever its organisation is on. It does not lapse with the organisation.'
          : 'Takes effect immediately, up or down. No invoice is raised.'}
        {target.current ? <> Currently <b>{label(target.current)}</b>.</> : null}
      </p>
      <Field label="Plan">
        <Select className="w-full" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {tiers.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </Select>
      </Field>
      {target.kind !== 'event' && plan !== 'free' && (
        <Field label="Until (optional)" hint="Leave empty to keep it until changed. On this date it drops to Free; running events then get the grace period.">
          <Input type="date" value={until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      )}
      <Field label="Note (optional)" hint="Kept in the plan history.">
        <Textarea rows={2} className="w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pilot for the 2026 season" />
      </Field>
    </Modal>
  );
}
