import { withGst, type BillingPeriod, type Tier } from '@semp/entitlements';
import type { Holder } from './subscription.service.js';

// Issuing the document.
//
// No money moves yet, and the invoice says so: `provider` is 'none' and the row
// records what WOULD have been charged. That is deliberately not the same as
// recording nothing. When a gateway is wired the only change is who calls this -
// a webhook rather than the subscribe route - and the numbering, the GST split
// and the copied buyer details are already the shape an accountant expects.
//
// Every buyer field is COPIED onto the row rather than joined at read time. An
// invoice is a document as it was issued; a join would let a later correction to
// the organisation silently restate a figure somebody has already paid against.

/**
 * The Indian financial year, April to March, as it prints on an invoice.
 * April 2026 through March 2027 is "2026-27".
 */
export function financialYear(at: Date): string {
  const y = at.getFullYear();
  const startYear = at.getMonth() >= 3 ? y : y - 1; // months are 0-based; 3 is April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * SPG/2026-27/000123.
 *
 * The tail comes from a Postgres sequence rather than from a count of existing
 * rows: a count is a race, and two invoices sharing a number is the one defect in
 * this file that cannot be fixed after the fact, because both have been sent.
 */
export function invoiceNumber(fy: string, seq: bigint | number): string {
  return `SPG/${fy}/${String(seq).padStart(6, '0')}`;
}

/** Everything the routes hand in. The amount is the list price, before GST. */
export interface IssueInvoiceInput {
  subscriptionId: string;
  holder: Holder;
  plan: Tier;
  period: BillingPeriod;
  /** List price in paise, exclusive of tax. */
  amount: number;
}

/** Prisma client or transaction client - whichever the caller is holding. */
type Db = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  organizations: { findUnique: Function };
  users: { findUnique: Function };
  invoices: { create: Function };
};

export async function issueInvoice(db: Db, input: IssueInvoiceInput): Promise<{ id: string; number: string }> {
  const now = new Date();
  const taxed = withGst(input.amount);

  // The buyer, as they are right now. Read once and copied.
  const buyer = input.holder.ladder === 'org'
    ? await readOrgBuyer(db, input.holder.organizationId)
    : await readUserBuyer(db, input.holder.userId);

  const rows = (await db.$queryRaw`select nextval('invoice_number_seq') as seq`) as Array<{ seq: bigint }>;
  const number = invoiceNumber(financialYear(now), rows[0].seq);

  const created = await db.invoices.create({
    data: {
      subscription_id: input.subscriptionId,
      number,
      ladder: input.holder.ladder,
      organization_id: input.holder.ladder === 'org' ? input.holder.organizationId : null,
      user_id: input.holder.ladder === 'personal' ? input.holder.userId : null,
      plan: input.plan,
      period: input.period,
      currency: 'INR',
      subtotal_paise: BigInt(taxed.subtotal),
      tax_rate_bp: taxed.taxRateBp,
      tax_paise: BigInt(taxed.tax),
      total_paise: BigInt(taxed.total),
      ...buyer,
      // Marked paid with provider 'none': access was granted, and the row is
      // honest that no payment was taken for it. A reconciliation later can find
      // every one of these with a single predicate.
      status: 'paid',
      provider: 'none',
      issued_at: now,
      paid_at: now,
    },
  });

  return { id: created.id as string, number };
}

interface BuyerFields {
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_address: string | null;
  buyer_gstin: string | null;
  place_of_supply: string | null;
}

async function readOrgBuyer(db: Db, organizationId: string): Promise<BuyerFields> {
  const o = await db.organizations.findUnique({
    where: { id: organizationId },
    select: {
      name: true, billing_name: true, billing_email: true,
      billing_address: true, billing_gstin: true, billing_state_code: true,
    },
  });
  return {
    // The billing contact if one has been set, the institution's own name if not -
    // an invoice with no name on it is not a document anybody can file.
    buyer_name: o?.billing_name ?? o?.name ?? null,
    buyer_email: o?.billing_email ?? null,
    buyer_address: o?.billing_address ?? null,
    buyer_gstin: o?.billing_gstin ?? null,
    place_of_supply: o?.billing_state_code ?? null,
  };
}

async function readUserBuyer(db: Db, userId: string): Promise<BuyerFields> {
  const u = await db.users.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return {
    buyer_name: u?.name ?? null,
    buyer_email: u?.email ?? null,
    // A player buying a personal plan is a consumer: no GSTIN, and the place of
    // supply is their state, which the product does not hold. Left null rather
    // than guessed - a wrong state code on a tax document is worse than a blank.
    buyer_address: null,
    buyer_gstin: null,
    place_of_supply: null,
  };
}

/**
 * Paise are held as bigint in the database and JSON cannot carry one. Narrowed to
 * Number on the way out, which is exact here: the largest invoice this product
 * could issue is many orders of magnitude below 2^53 paise.
 */
export function serialiseInvoice<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row };
  for (const k of ['subtotal_paise', 'tax_paise', 'total_paise']) {
    if (typeof out[k] === 'bigint') out[k] = Number(out[k] as bigint);
  }
  return out;
}
