import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/hooks';
import type { BillingContact, BillingState } from '../../../lib/billing';
import { PlanSurface } from '../../../components/PlanSurface';
import { Button, Card, CardBody, Field, Input, Modal, Textarea, toast } from '../../../components/ui';

// Admin > Billing & Subscription (PG-28e).
//
// Replaces the read-only placeholder that stood here, which said "checkout is not
// wired yet" and offered an email address. The plan can now be bought; what is
// still absent is the payment, and the checkout screen says so in those words
// rather than by having no button.
//
// Everything about the plan itself is PlanSurface, shared with the personal
// ladder. What is specific to an institution is the billing contact - the details
// each invoice is issued to - and that is all this file adds.

export function BillingPanel({ orgId }: { orgId: string }) {
  const [editing, setEditing] = useState(false);
  const statePath = `/billing/org/${orgId}`;
  const state = useApi<BillingState>(statePath);

  return (
    <div className="flex flex-col gap-5">
      <PlanSurface ladder="org" statePath={statePath} actionPath={statePath} />

      {state.data?.contact && (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Billing contact
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Where invoices are addressed. Changing this affects invoices issued
                  from now on, not ones already sent.
                </p>
              </div>
              {state.data.mayBuy && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Edit
                </Button>
              )}
            </div>

            <dl className="mt-4">
              <Row label="Billed to" value={state.data.contact.billing_name} />
              <Row label="Billing email" value={state.data.contact.billing_email} />
              <Row label="Phone" value={state.data.contact.billing_phone} />
              <Row label="GSTIN" value={state.data.contact.billing_gstin} mono />
              <Row label="Address" value={state.data.contact.billing_address} />
            </dl>
          </CardBody>
        </Card>
      )}

      {editing && state.data?.contact && (
        <ContactModal
          orgId={orgId}
          statePath={statePath}
          contact={state.data.contact}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-t border-eos-line py-2.5 text-sm first:border-t-0 dark:border-slate-800">
      <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
      <dd className={`text-right ${value ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'} ${mono ? 'font-mono text-xs' : ''}`}>
        {value || 'Not set'}
      </dd>
    </div>
  );
}

function ContactModal({
  orgId, statePath, contact, onClose,
}: { orgId: string; statePath: string; contact: BillingContact; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(contact);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof BillingContact) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      // Only what changed. Sending the whole form would rewrite fields somebody
      // did not open the dialog to touch, and the GSTIN validator would then
      // reject a save because of a value that was already stored.
      const patch: Record<string, string | null> = {};
      for (const k of Object.keys(form) as (keyof BillingContact)[]) {
        if (form[k] !== contact[k]) patch[k] = form[k] || null;
      }
      if (Object.keys(patch).length === 0) { onClose(); return; }

      await api('PATCH', `/billing/org/${orgId}/contact`, patch);
      qc.invalidateQueries({ queryKey: [statePath] });
      toast.success('Saved');
      onClose();
    } catch (e: any) {
      toast.error('Could not save that', e?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Billing contact"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Billed to" hint="Leave blank to use the institution's own name">
          <Input value={form.billing_name ?? ''} onChange={(e) => set('billing_name')(e.target.value)} />
        </Field>
        <Field label="Billing email">
          <Input type="email" value={form.billing_email ?? ''} onChange={(e) => set('billing_email')(e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={form.billing_phone ?? ''} onChange={(e) => set('billing_phone')(e.target.value)} />
        </Field>
        <Field label="GSTIN" hint="Optional. Needed to claim input credit on these invoices.">
          <Input
            value={form.billing_gstin ?? ''}
            onChange={(e) => set('billing_gstin')(e.target.value.toUpperCase())}
            placeholder="29ABCDE1234F1Z5"
            maxLength={15}
            className="font-mono uppercase"
          />
        </Field>
        <Field label="State code" hint="Two digits, from the GSTIN. Decides which GST applies.">
          <Input
            value={form.billing_state_code ?? ''}
            onChange={(e) => set('billing_state_code')(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="29"
            className="font-mono"
          />
        </Field>
        <Field label="Address">
          <Textarea
            rows={3}
            value={form.billing_address ?? ''}
            onChange={(e) => set('billing_address')(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
