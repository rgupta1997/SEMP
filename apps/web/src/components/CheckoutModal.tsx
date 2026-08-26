import { useState } from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import {
  formatPaise,
  type BillingContact,
  type BillingPeriod,
  type PlanView,
  type Quote,
} from '../lib/billing';
import { Button, Field, Input, Modal, Spinner, toast } from './ui';

// Checkout.
//
// There is no payment step, and the screen says so rather than miming one. A
// fake card form would teach people that the controls in this product are
// decorative, which is expensive to unlearn - and it would be the second time,
// because the billing panel it replaces already had a Change plan button with
// nothing behind it.
//
// Everything else is real: the total is quoted by the server, the GST is the
// GST that will appear on the invoice, and the buyer details are the ones it
// will be issued to. When a gateway is wired, the confirm button gains a
// redirect and this screen does not otherwise change.

export interface CheckoutModalProps {
  plan: PlanView;
  period: BillingPeriod;
  ladder: 'org' | 'personal';
  /** Present on the org ladder: the billing contact the invoice is issued to. */
  contact?: BillingContact | null;
  /** Where to POST. The two ladders differ only in this. */
  subscribePath: string;
  /** Where to PATCH the billing contact, when it can be edited from here. */
  contactPath?: string;
  onClose: () => void;
  onDone: () => void;
}

export function CheckoutModal({
  plan, period, ladder, contact, subscribePath, contactPath, onClose, onDone,
}: CheckoutModalProps) {
  // The total comes from the server. The client never computes a price - see the
  // note in lib/billing.ts for why that is not merely tidiness.
  const quote = useApi<{ quote: Quote | null }>(
    `/billing/quote?ladder=${ladder}&plan=${plan.tier}&period=${period}`,
  );

  const [gstin, setGstin] = useState(contact?.billing_gstin ?? '');
  const [billingName, setBillingName] = useState(contact?.billing_name ?? '');
  const [billingEmail, setBillingEmail] = useState(contact?.billing_email ?? '');
  const [busy, setBusy] = useState(false);

  const q = quote.data?.quote ?? null;

  async function confirm() {
    setBusy(true);
    try {
      // The contact is saved BEFORE the subscription, so the invoice this
      // purchase issues carries the details just typed. Saved after, it would
      // apply from the next invoice onward and the first one would be wrong -
      // which is the one somebody actually looks at.
      if (contactPath && ladder === 'org') {
        const changed: Record<string, string | null> = {};
        if (billingName !== (contact?.billing_name ?? '')) changed.billing_name = billingName || null;
        if (billingEmail !== (contact?.billing_email ?? '')) changed.billing_email = billingEmail || null;
        if (gstin !== (contact?.billing_gstin ?? '')) changed.billing_gstin = gstin || null;
        if (Object.keys(changed).length > 0) await api('PATCH', contactPath, changed);
      }

      await api('POST', subscribePath, { plan: plan.tier, period });
      toast.success(`You are on ${plan.name}`, 'Everything the plan includes is available now.');
      onDone();
    } catch (e: any) {
      toast.error('That did not go through', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Subscribe to ${plan.name}`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {q ? `${formatPaise(q.total)} including GST` : ' '}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={confirm} disabled={busy || quote.isLoading || !q}>
              {busy ? 'Activating…' : 'Confirm & activate'}
            </Button>
          </div>
        </div>
      }
    >
      {quote.isLoading ? <Spinner label="Pricing…" /> : (
        <div className="flex flex-col gap-5">
          {/* What is being bought, and for how long. */}
          <div className="rounded-xl border border-eos-line p-4 dark:border-slate-800">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-sm font-bold dark:text-slate-100">{plan.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Billed {period === 'annual' ? 'once a year' : 'every month'}
                </div>
              </div>
              <div className="text-right text-sm font-semibold tabular-nums dark:text-slate-100">
                {q ? formatPaise(q.subtotal) : '—'}
              </div>
            </div>

            {q && (
              <dl className="mt-3 border-t border-eos-line pt-3 text-xs dark:border-slate-800">
                <Row label="Subtotal" value={formatPaise(q.subtotal)} />
                <Row label={`GST (${(q.taxRateBp / 100).toFixed(0)}%)`} value={formatPaise(q.tax)} />
                <div className="mt-2 flex items-center justify-between border-t border-eos-line pt-2 text-sm font-bold dark:border-slate-800 dark:text-slate-100">
                  <span>Total</span>
                  <span className="tabular-nums">{formatPaise(q.total)}</span>
                </div>
              </dl>
            )}
          </div>

          {/* The invoice is issued to these. Editable here because the moment
              somebody is buying is the moment they have their GSTIN to hand. */}
          {ladder === 'org' && contactPath && (
            <div className="flex flex-col gap-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Invoice details
              </h4>
              <Field label="Billed to" hint="Leave blank to use the institution's name">
                <Input value={billingName} onChange={(e) => setBillingName(e.target.value)} placeholder="Finance office" />
              </Field>
              <Field label="Billing email">
                <Input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="accounts@institution.edu" />
              </Field>
              <Field label="GSTIN" hint="Optional. Needed to claim input credit on this invoice.">
                <Input
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  placeholder="29ABCDE1234F1Z5"
                  maxLength={15}
                  className="font-mono uppercase"
                />
              </Field>
            </div>
          )}

          {/* Said plainly. Somebody agreeing to this should know exactly what
              they are agreeing to, and "no card is charged" is the thing they
              would most want to have been told. */}
          <div className="flex gap-2.5 rounded-xl bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <strong className="font-semibold">No payment is taken.</strong> Online
              payment is not connected yet. Confirming activates the plan immediately and
              records an invoice for {q ? formatPaise(q.total) : 'the amount above'}, which
              our team will settle with you directly.
            </div>
          </div>

          <p className="flex gap-2 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              You can move to a lower plan whenever you like. It takes effect at the end of
              the period you have paid for, and nothing you have created is deleted.
            </span>
          </p>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-slate-600 dark:text-slate-300">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
