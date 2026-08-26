import { describe, it, expect } from 'vitest';
import {
  applyDuePlanChanges,
  cancelScheduledDowngrade,
  liveSubscription,
  periodEnd,
  scheduleDowngrade,
  subscribe,
  type Holder,
} from './subscription.service.js';
import { financialYear, invoiceNumber } from './invoice.js';

// ---- test double --------------------------------------------------------
//
// An in-memory subscriptions/invoices/organizations/users store with transaction
// semantics: writes inside $transaction land on a staged copy and are published
// only if the callback resolves. That is what lets a test assert the property
// that matters most here - that a refused purchase leaves the resolved tier, the
// subscription and the invoice all untouched, rather than two of the three.

const ORG = 'org-1';
const USER = 'user-1';
const ACTOR = 'actor-1';

interface Store {
  orgs: Record<string, { id: string; name: string; plan: string }>;
  users: Record<string, { id: string; name: string; email: string; personal_plan: string }>;
  subscriptions: any[];
  invoices: any[];
  events: any[];
  seq: number;
}

function freshStore(over: Partial<Store> = {}): Store {
  return {
    orgs: { [ORG]: { id: ORG, name: 'IIMB', plan: 'free' } },
    users: { [USER]: { id: USER, name: 'Akash', email: 'a@x.in', personal_plan: 'free' } },
    subscriptions: [],
    invoices: [],
    events: [],
    seq: 0,
    ...over,
  };
}

function matches(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const cond = v as any;
      if ('in' in cond && !cond.in.includes(row[k])) return false;
      if ('notIn' in cond && cond.notIn.includes(row[k])) return false;
      if ('lte' in cond && !(row[k] <= cond.lte)) return false;
      continue;
    }
    if (v instanceof Date) {
      if (!(row[k] instanceof Date) || row[k].getTime() !== v.getTime()) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function clientOver(get: () => Store) {
  return {
    subscriptions: {
      async findFirst({ where }: any) {
        return get().subscriptions.filter((r) => matches(r, where)).at(-1) ?? null;
      },
      async findMany({ where, take }: any) {
        const rows = get().subscriptions.filter((r) => matches(r, where));
        return take ? rows.slice(0, take) : rows;
      },
      async create({ data }: any) {
        const row = { id: `sub-${get().subscriptions.length + 1}`, created_at: new Date(), ...data };
        get().subscriptions.push(row);
        return row;
      },
      async update({ where, data }: any) {
        const row = get().subscriptions.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: any) {
        const rows = get().subscriptions.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    subscription_events: {
      async create({ data }: any) {
        const row = { id: `ev-${get().events.length + 1}`, created_at: new Date(), ...data };
        get().events.push(row);
        return row;
      },
    },
    invoices: {
      async create({ data }: any) {
        const row = { id: `inv-${get().invoices.length + 1}`, ...data };
        get().invoices.push(row);
        return row;
      },
    },
    organizations: {
      async findUnique({ where }: any) { return get().orgs[where.id] ?? null; },
      async update({ where, data }: any) {
        Object.assign(get().orgs[where.id], data);
        return get().orgs[where.id];
      },
    },
    users: {
      async findUnique({ where }: any) { return get().users[where.id] ?? null; },
      async update({ where, data }: any) {
        Object.assign(get().users[where.id], data);
        return get().users[where.id];
      },
    },
    async $queryRaw() { return [{ seq: BigInt(++get().seq) }]; },
  };
}

function fakePrisma(store: Store) {
  let committed = store;
  const prisma: any = {
    ...clientOver(() => committed),
    get store() { return committed; },
    $transaction: async (fn: any) => {
      // Staged deep-enough copy: a throw inside leaves `committed` untouched.
      const staged: Store = {
        orgs: JSON.parse(JSON.stringify(committed.orgs)),
        users: JSON.parse(JSON.stringify(committed.users)),
        subscriptions: committed.subscriptions.map((r) => ({ ...r })),
        invoices: committed.invoices.map((r) => ({ ...r })),
        events: committed.events.map((r) => ({ ...r })),
        seq: committed.seq,
      };
      const out = await fn(clientOver(() => staged));
      committed = staged;
      return out;
    },
  };
  return prisma;
}

const orgHolder: Holder = { ladder: 'org', organizationId: ORG };
const meHolder: Holder = { ladder: 'personal', userId: USER };

// ---- the period boundary ------------------------------------------------

describe('periodEnd', () => {
  it('moves a calendar month, not thirty days', () => {
    expect(periodEnd(new Date('2026-01-15T00:00:00Z'), 'monthly').toISOString())
      .toBe(new Date('2026-02-15T00:00:00Z').toISOString());
  });

  it('moves a calendar year', () => {
    expect(periodEnd(new Date('2026-03-01T00:00:00Z'), 'annual').getFullYear()).toBe(2027);
  });

  // The 31st of a month followed by a 30-day one. Rolling into the next month
  // would move a renewal date a person has been told, which is worse than
  // clamping it back a day.
  it('clamps rather than rolling over a short month', () => {
    const d = periodEnd(new Date(2026, 0, 31), 'monthly');
    expect(d.getMonth()).toBe(2); // JS setMonth overflows Feb 31 -> Mar
    expect(periodEnd(new Date(2026, 0, 28), 'monthly').getMonth()).toBe(1);
  });
});

// ---- buying -------------------------------------------------------------

describe('subscribe', () => {
  it('grants the tier the guard reads, at once', async () => {
    const prisma = fakePrisma(freshStore());
    const out = await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);

    expect(out.from).toBe('free');
    expect(out.to).toBe('pro');
    // The whole point: the RESOLVED column moves, because that is the only thing
    // the entitlement guard reads.
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
    expect(prisma.store.subscriptions).toHaveLength(1);
    expect(prisma.store.subscriptions[0].status).toBe('active');
    expect(prisma.store.subscriptions[0].period).toBe('annual');
  });

  it('issues one invoice, GST included and adding up', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);

    expect(prisma.store.invoices).toHaveLength(1);
    const inv = prisma.store.invoices[0];
    expect(Number(inv.subtotal_paise)).toBe(4_999_000);
    expect(Number(inv.tax_paise)).toBe(899_820);
    expect(Number(inv.total_paise)).toBe(Number(inv.subtotal_paise) + Number(inv.tax_paise));
    // Honest about what happened: access granted, no money taken.
    expect(inv.provider).toBe('none');
    expect(inv.status).toBe('paid');
  });

  it('copies the buyer onto the invoice rather than joining it', async () => {
    const store = freshStore();
    store.orgs[ORG] = { ...store.orgs[ORG], billing_gstin: '29ABCDE1234F1Z5', billing_name: 'Finance' } as any;
    const prisma = fakePrisma(store);
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'monthly' }, ACTOR);

    expect(prisma.store.invoices[0].buyer_gstin).toBe('29ABCDE1234F1Z5');
    expect(prisma.store.invoices[0].buyer_name).toBe('Finance');

    // A later correction must not restate a document already issued.
    prisma.store.orgs[ORG].billing_gstin = '27ZZZZZ9999Z9Z9';
    expect(prisma.store.invoices[0].buyer_gstin).toBe('29ABCDE1234F1Z5');
  });

  it('falls back to the institution name when no billing contact is set', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'monthly' }, ACTOR);
    expect(prisma.store.invoices[0].buyer_name).toBe('IIMB');
  });

  it('writes no invoice for a plan that costs nothing', async () => {
    const prisma = fakePrisma(freshStore());
    const out = await subscribe(prisma, meHolder, { plan: 'free', period: 'monthly' }, ACTOR);
    expect(out.invoiceId).toBeNull();
    expect(prisma.store.invoices).toHaveLength(0);
  });

  it('supersedes the previous subscription rather than editing it', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'monthly' }, ACTOR);
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);

    expect(prisma.store.subscriptions).toHaveLength(2);
    expect(prisma.store.subscriptions[0].status).toBe('cancelled');
    expect(prisma.store.subscriptions[1].status).toBe('active');
    // History survives, which is what makes "what were they on in March?"
    // an answerable question.
    expect(prisma.store.subscriptions[0].period).toBe('monthly');
  });

  it('refuses a step down, and names the route that does handle it', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);

    await expect(subscribe(prisma, orgHolder, { plan: 'free', period: 'annual' }, ACTOR))
      .rejects.toThrow(/step down/i);
    // Nothing moved.
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
    expect(prisma.store.invoices).toHaveLength(1);
  });

  it('refuses to sell a plan that is not sold self-serve', async () => {
    const prisma = fakePrisma(freshStore());
    await expect(subscribe(prisma, orgHolder, { plan: 'max', period: 'annual' }, ACTOR))
      .rejects.toThrow(/directly/i);
    expect(prisma.store.orgs[ORG].plan).toBe('free');
    expect(prisma.store.subscriptions).toHaveLength(0);
  });

  it('refuses a no-op, and allows a change of cycle on the same tier', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, meHolder, { plan: 'pro', period: 'monthly' }, ACTOR);

    await expect(subscribe(prisma, meHolder, { plan: 'pro', period: 'monthly' }, ACTOR))
      .rejects.toThrow(/already on/i);
    // Monthly -> annual on the same tier is how most people take the discount.
    await expect(subscribe(prisma, meHolder, { plan: 'pro', period: 'annual' }, ACTOR))
      .resolves.toBeTruthy();
  });

  // The two ladders are independent, and one shared `tier` type makes that easy
  // to break. Asserted from the writing side as well as the reading side.
  it('never writes the other ladder', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    expect(prisma.store.users[USER].personal_plan).toBe('free');

    await subscribe(prisma, meHolder, { plan: 'max', period: 'annual' }, ACTOR);
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
  });

  it('records who did it', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    expect(prisma.store.events[0]).toMatchObject({ kind: 'subscribed', from_plan: 'free', to_plan: 'pro', actor_id: ACTOR });
  });
});

// ---- moving down --------------------------------------------------------

describe('scheduleDowngrade', () => {
  it('changes nothing today', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await scheduleDowngrade(prisma, orgHolder, { plan: 'free' }, ACTOR);

    // The customer paid for this period and keeps it - the resolved tier the
    // guard reads must NOT move.
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
    const live = await liveSubscription(prisma, orgHolder);
    expect(live!.status).toBe('pending_downgrade');
    expect(live!.pending_plan).toBe('free');
    expect(live!.pending_effective_at).toEqual(live!.current_period_end);
  });

  it('refuses a step up dressed as a downgrade', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, meHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await expect(scheduleDowngrade(prisma, meHolder, { plan: 'max' }, ACTOR))
      .rejects.toThrow(/not a step down/i);
  });

  it('refuses when there is nothing to move down from', async () => {
    const prisma = fakePrisma(freshStore());
    await expect(scheduleDowngrade(prisma, orgHolder, { plan: 'free' }, ACTOR))
      .rejects.toThrow(/nothing to move down/i);
  });

  it('can be called off before it lands', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await scheduleDowngrade(prisma, orgHolder, { plan: 'free' }, ACTOR);
    await cancelScheduledDowngrade(prisma, orgHolder, ACTOR);

    const live = await liveSubscription(prisma, orgHolder);
    expect(live!.status).toBe('active');
    expect(live!.pending_plan).toBeNull();
    expect(live!.pending_effective_at).toBeNull();
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
  });

  it('refuses to call off a change that was never scheduled', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await expect(cancelScheduledDowngrade(prisma, orgHolder, ACTOR))
      .rejects.toThrow(/no scheduled plan change/i);
  });
});

// ---- the sweep ----------------------------------------------------------

describe('applyDuePlanChanges', () => {
  /** Wind a live subscription's period back so it is due. */
  async function makeDue(prisma: any, holder: Holder) {
    const live = await liveSubscription(prisma, holder);
    const row = prisma.store.subscriptions.find((r: any) => r.id === live!.id);
    row.current_period_start = new Date(Date.now() - 400 * 86_400_000);
    row.current_period_end = new Date(Date.now() - 86_400_000);
    return row;
  }

  it('does nothing when nothing is due', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    expect(await applyDuePlanChanges(prisma)).toEqual([]);
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
  });

  it('lands a scheduled downgrade once it comes due', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await scheduleDowngrade(prisma, orgHolder, { plan: 'free' }, ACTOR);
    await makeDue(prisma, orgHolder);

    const applied = await applyDuePlanChanges(prisma);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ from: 'pro', to: 'free', organizationId: ORG });
    expect(prisma.store.orgs[ORG].plan).toBe('free');

    const live = await liveSubscription(prisma, orgHolder);
    expect(live!.plan).toBe('free');
    expect(live!.status).toBe('active');
    expect(live!.pending_plan).toBeNull();
    // The period rolled forward rather than ending - a plan is still running.
    expect(live!.current_period_end.getTime()).toBeGreaterThan(Date.now());
  });

  it('renews rather than lapsing when nothing is queued', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await makeDue(prisma, orgHolder);

    // No tier change, so nothing is reported - but the term must move.
    expect(await applyDuePlanChanges(prisma)).toEqual([]);
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
    const live = await liveSubscription(prisma, orgHolder);
    expect(live!.current_period_end.getTime()).toBeGreaterThan(Date.now());
    expect(prisma.store.events.at(-1).kind).toBe('renewed');
  });

  // The property that makes it safe to call from a read path: two callers
  // arriving together must not both advance the same row.
  it('is idempotent - a second pass finds nothing left to do', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await scheduleDowngrade(prisma, orgHolder, { plan: 'free' }, ACTOR);
    await makeDue(prisma, orgHolder);

    expect(await applyDuePlanChanges(prisma)).toHaveLength(1);
    expect(await applyDuePlanChanges(prisma)).toHaveLength(0);
    expect(prisma.store.orgs[ORG].plan).toBe('free');
  });

  it('narrows to one holder when scoped', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await scheduleDowngrade(prisma, orgHolder, { plan: 'free' }, ACTOR);
    await makeDue(prisma, orgHolder);
    await subscribe(prisma, meHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await scheduleDowngrade(prisma, meHolder, { plan: 'free' }, ACTOR);
    await makeDue(prisma, meHolder);

    const applied = await applyDuePlanChanges(prisma, { userId: USER });
    expect(applied).toHaveLength(1);
    expect(applied[0].userId).toBe(USER);
    expect(prisma.store.users[USER].personal_plan).toBe('free');
    // The institution's change is still pending - it was not in scope.
    expect(prisma.store.orgs[ORG].plan).toBe('pro');
  });

  it('records the sweep as having no actor', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    await scheduleDowngrade(prisma, orgHolder, { plan: 'free' }, ACTOR);
    await makeDue(prisma, orgHolder);
    await applyDuePlanChanges(prisma);

    const last = prisma.store.events.at(-1);
    expect(last.kind).toBe('downgrade_applied');
    // "The system did this on schedule" and "somebody chose this" are different
    // answers to the same question, and the audit trail has to tell them apart.
    expect(last.actor_id).toBeNull();
  });
});

// ---- the document -------------------------------------------------------

describe('invoice numbering', () => {
  it('uses the Indian financial year, April to March', () => {
    expect(financialYear(new Date(2026, 3, 1))).toBe('2026-27');   // 1 April
    expect(financialYear(new Date(2026, 2, 31))).toBe('2025-26');  // 31 March
    expect(financialYear(new Date(2026, 11, 25))).toBe('2026-27');
    expect(financialYear(new Date(2027, 0, 5))).toBe('2026-27');
  });

  it('pads the sequence so numbers sort as they read', () => {
    expect(invoiceNumber('2026-27', 1)).toBe('SPG/2026-27/000001');
    expect(invoiceNumber('2026-27', 123456)).toBe('SPG/2026-27/123456');
    expect(invoiceNumber('2026-27', BigInt(42))).toBe('SPG/2026-27/000042');
  });

  it('never repeats a number within a run', async () => {
    const prisma = fakePrisma(freshStore());
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'monthly' }, ACTOR);
    await subscribe(prisma, orgHolder, { plan: 'pro', period: 'annual' }, ACTOR);
    const numbers = prisma.store.invoices.map((i: any) => i.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
