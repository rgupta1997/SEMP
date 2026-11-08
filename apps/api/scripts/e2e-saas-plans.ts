/**
 * End-to-end proof of the SaaS plans (20261108000000_saas_plans.sql), against the
 * real database, through the real HTTP app - in process.
 *
 *   npx tsx scripts/e2e-saas-plans.ts
 *
 * SAFE ON THE SHARED (local + beta) DATABASE:
 *   - plan enforcement is forced ON for THIS PROCESS ONLY, by a Prisma proxy that
 *     answers the `plans_enforced` read. The platform switch itself is never
 *     touched, so beta keeps running with plans off.
 *   - everything it creates is tagged ZZSAAS and deleted at the end, pass or fail;
 *   - it never writes the 'starter' tier to any row (code built before the
 *     migration cannot read that value - see the migration's header).
 */
import 'dotenv/config';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/http/server.js';
import { signToken } from '../src/http/middleware/auth.js';

const TAG = 'ZZSAAS';
const real = new PrismaClient();

// Plans ON, for this process only - on the client AND on every transaction
// client it hands out (a gate inside a transaction reads through the tx).
function enforced<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, recv) {
      if (prop === 'platform_settings') {
        const ps = (target as any).platform_settings;
        return new Proxy(ps, {
          get(t, p) {
            if (p === 'findUnique') {
              return async (args: any) => (args?.where?.key === 'plans_enforced' ? { value: true } : t.findUnique(args));
            }
            return (t as any)[p];
          },
        });
      }
      if (prop === '$transaction') {
        const tx = (target as any).$transaction.bind(target);
        return (arg: any, opts?: any) => (typeof arg === 'function' ? tx((c: any) => arg(enforced(c)), opts) : tx(arg, opts));
      }
      return Reflect.get(target, prop, recv);
    },
  });
}
const prisma = enforced(real);

let pass = 0;
let fail = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); }
};

async function main() {
  const superUser = await real.users.findFirst({ where: { is_super_admin: true, is_active: true }, select: { id: true, email: true } });
  // A plain user whose primary org is already set, so creating an org changes nothing on their row.
  const plain = await real.users.findFirst({
    where: { is_super_admin: false, is_active: true, organization_id: { not: null }, email: { endsWith: '@bench.test' } },
    select: { id: true, email: true, organization_id: true },
  });
  if (!superUser || !plain) throw new Error('need a super admin and a bench user with an organisation');

  const knockout = await real.tournament_formats.findFirst({ where: { name: { equals: 'Knockout', mode: 'insensitive' } } });
  const league = await real.tournament_formats.findFirst({ where: { name: { equals: 'League', mode: 'insensitive' } } });
  const sportRow = await real.$queryRaw<Array<{ sport_id: string }>>`
    select sport_id from disciplines where championship_id is null group by sport_id having count(*) >= 2 limit 1`;
  const sportId = sportRow[0]?.sport_id;
  const discs = await real.disciplines.findMany({ where: { sport_id: sportId, championship_id: null }, take: 2, select: { id: true } });
  if (!knockout || !league || !sportId || discs.length < 2) throw new Error('catalogue lacks Knockout/League or a sport with 2 disciplines');

  const app = buildApp(prisma as any);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tokenFor = (u: { id: string; email: string }, sa: boolean, org: string | null) =>
    signToken({ id: u.id, email: u.email, isSuperAdmin: sa, organizationId: org });
  const SA = tokenFor(superUser, true, null);
  const U = tokenFor(plain, false, plain.organization_id);
  const call = async (token: string | null, method: string, url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  let orgId: string | null = null;
  let champId: string | null = null;
  const couponCode = `${TAG}10`;
  try {
    console.log('catalogue');
    const cat = await call(SA, 'GET', '/platform/billing/catalog');
    ok(cat.status === 200 && cat.body.org.length === 4, 'console catalogue has four org slots', cat.body?.org?.map((p: any) => p.tier));
    const pub = await call(null, 'GET', '/public/plans');
    ok(pub.status === 200 && pub.body.org.map((p: any) => p.tier).join() === 'free,starter,pro,max', 'public catalogue lists Free/Starter/Pro/Enterprise');
    ok(pub.body.addons.some((a: any) => a.key === 'whatsapp_notifications' && a.status === 'coming_soon'), 'WhatsApp add-on is listed as coming soon');

    console.log('a new organisation starts on Pro');
    const org = await call(U, 'POST', '/organizations', { name: `${TAG} Institute`, short_name: TAG, city: 'Bengaluru' });
    ok(org.status === 201, 'organisation created', org.body);
    orgId = org.body?.id ?? org.body?.organization?.id ?? null;
    const orgRow = orgId ? await real.organizations.findUnique({ where: { id: orgId }, select: { plan: true } }) : null;
    ok(orgRow?.plan === 'pro', 'its plan is pro', orgRow);
    const sub = orgId ? await real.subscriptions.findFirst({ where: { organization_id: orgId } }) : null;
    ok(sub?.provider === 'admin' && sub?.status === 'active', 'as a complimentary admin subscription');

    console.log('super admin moves it to Free');
    const toFree = await call(SA, 'PUT', `/platform/billing/orgs/${orgId}/plan`, { plan: 'free', note: TAG });
    ok(toFree.status === 200 && toFree.body.to === 'free', 'set to free', toFree.body);

    console.log('event creation on Free');
    const mk = (n: number) => ({
      name: `${TAG} Cup ${n}`, slug: `${TAG.toLowerCase()}-cup-${n}-${Date.now()}`,
      start_date: '2026-12-01', end_date: '2026-12-02', host_cities: ['Bengaluru'], host_organization_id: orgId,
    });
    const c1 = await call(U, 'POST', '/championships', mk(1));
    ok(c1.status === 201 && c1.body.plan_tier === 'free' && c1.body.plan_source === 'org', 'first event created, stamped free/org', c1.body?.plan_tier ?? c1.body);
    champId = c1.body?.id ?? null;
    const c2 = await call(U, 'POST', '/championships', mk(2));
    ok(c2.status === 402 && c2.body?.error?.code === 'PLAN_LIMIT_REACHED', 'second running event refused 402', c2.body);
    const intra = await call(U, 'POST', '/championships', { ...mk(3), entry_level: 'department' });
    ok(intra.status === 403 || intra.status === 402, 'department event refused on free', intra.status);

    const plan = await call(U, 'GET', `/championships/${champId}/plan`);
    ok(plan.body.tier === 'free' && !plan.body.capabilities.includes('manual_schedule'), 'event plan view: free, no manual schedule');
    ok(plan.body.limits.find((l: any) => l.key === 'teams_per_event')?.cap === 8, 'teams per event capped at 8');

    console.log('setup gates on Free');
    const tournament = await real.tournaments.findFirst({ where: { championship_id: champId! }, select: { id: true } });
    const tsLeague = await call(U, 'POST', '/tournament-sports', { tournament_id: tournament!.id, sport_id: sportId, format_id: league.id });
    ok(tsLeague.status === 403 && tsLeague.body?.error?.details?.capability === 'advanced_formats', 'League format refused 403 advanced_formats', tsLeague.body);
    const ts = await call(U, 'POST', '/tournament-sports', { tournament_id: tournament!.id, sport_id: sportId, format_id: knockout.id });
    ok(ts.status === 201, 'Knockout format accepted', ts.body);
    const d1 = await call(U, 'POST', '/tournament-disciplines', { tournament_sport_id: ts.body.id, discipline_id: discs[0].id });
    ok(d1.status === 201, 'first discipline accepted', d1.body);
    const d2 = await call(U, 'POST', '/tournament-disciplines', { tournament_sport_id: ts.body.id, discipline_id: discs[1].id });
    ok(d2.status === 402 && d2.body?.error?.details?.limit === 'disciplines_per_sport', 'second discipline in the sport refused 402', d2.body);
    const custom = await call(U, 'PUT', `/championships/${champId}/standings-rules`, { scope_type: 'championship', config: { scheme: 'custom', participation: 0 } });
    ok(custom.status === 403 && custom.body?.error?.details?.capability === 'custom_points', 'custom points refused 403', custom.body);
    const share = await call(U, 'GET', `/championships/${champId}/share-link`);
    ok(share.status === 403, 'public share link refused on free', share.status);

    console.log('upgrade to Pro ratchets the running event');
    await call(SA, 'PUT', `/platform/billing/orgs/${orgId}/plan`, { plan: 'pro' });
    const afterUp = await real.championships.findUnique({ where: { id: champId! }, select: { plan_tier: true, plan_grace_until: true } });
    ok(afterUp?.plan_tier === 'pro' && afterUp.plan_grace_until === null, 'event booked up to pro', afterUp);
    const custom2 = await call(U, 'PUT', `/championships/${champId}/standings-rules`, { scope_type: 'championship', config: { scheme: 'custom', participation: 0 } });
    ok(custom2.status === 200, 'custom points now allowed', custom2.body);

    console.log('downgrade starts the grace window');
    await call(SA, 'PUT', `/platform/billing/orgs/${orgId}/plan`, { plan: 'free' });
    const grace = await call(U, 'GET', `/championships/${champId}/plan`);
    ok(grace.body.inGrace === true && grace.body.tier === 'pro', 'event in grace, still on pro', grace.body);
    const days = grace.body.graceUntil ? (new Date(grace.body.graceUntil).getTime() - Date.now()) / 864e5 : 0;
    ok(days > 2.9 && days < 3.1, 'grace is three days', days);

    console.log('grace runs out: read-only');
    await real.championships.update({ where: { id: champId! }, data: { plan_grace_until: new Date(Date.now() - 1000) } });
    const write = await call(U, 'PATCH', `/championships/${champId}`, { description: 'should be refused' });
    ok(write.status === 402 && write.body?.error?.code === 'PLAN_LAPSED', 'writes refused 402 PLAN_LAPSED', write.body);
    const read = await call(U, 'GET', `/championships/${champId}/plan`);
    ok(read.status === 200 && read.body.locked === true, 'reads still work, reported locked');

    console.log('super admin pins the event to a plan');
    const pin = await call(SA, 'PUT', `/platform/billing/championships/${champId}/plan`, { plan: 'pro' });
    ok(pin.status === 200 && pin.body.source === 'admin' && pin.body.locked === false, 'pinned to pro, unlocked', pin.body);
    const write2 = await call(U, 'PATCH', `/championships/${champId}`, { description: `${TAG} ok` });
    ok(write2.status === 200, 'writes work again');

    console.log('coupons');
    const cp = await call(SA, 'POST', '/platform/billing/coupons', { code: couponCode, kind: 'percent', value: 1000, tiers: ['pro'], periods: ['annual'] });
    ok(cp.status === 201, 'coupon created', cp.body);
    const q = await call(U, 'GET', `/billing/quote?ladder=org&plan=pro&period=annual&coupon=${couponCode.toLowerCase()}`);
    ok(q.body.coupon?.discount === 499_900 && !q.body.coupon.error, 'quote takes 10% off the annual Pro price', q.body.coupon);
    const qBad = await call(U, 'GET', `/billing/quote?ladder=org&plan=pro&period=monthly&coupon=${couponCode}`);
    ok(!!qBad.body.coupon?.error, 'refused for monthly, with a reason', qBad.body.coupon);

    console.log('catalogue edit reaches the public page');
    const ed = await call(SA, 'PUT', '/platform/billing/catalog/plans/org/free', { limits: { teams_per_event: 12 } });
    ok(ed.status === 200, 'free plan edited');
    const pub2 = await call(null, 'GET', '/public/plans');
    ok(pub2.body.org[0].limits.teams_per_event === 12, 'public catalogue shows the new ceiling at once (same instance)');
    await call(SA, 'DELETE', '/platform/billing/catalog/plans/org/free');
    const pub3 = await call(null, 'GET', '/public/plans');
    ok(pub3.body.org[0].limits.teams_per_event === 8, 'reset restores the default');
  } finally {
    // ---- cleanup, pass or fail ----
    const del = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { console.log(`  ! cleanup ${label}: ${(e as Error).message.slice(0, 200)}`); } };
    await del('catalog', () => real.plan_catalog.deleteMany({ where: { ladder: 'org', tier: 'free' } }));
    await del('coupon', () => real.coupons.deleteMany({ where: { code: couponCode } }));
    const champs = await real.championships.findMany({
      where: { OR: [{ name: { startsWith: TAG } }, ...(orgId ? [{ host_organization_id: orgId }] : [])] },
      select: { id: true },
    });
    for (const c of champs) {
      await del('championship', async () => {
        const ts = await real.tournaments.findMany({ where: { championship_id: c.id }, select: { id: true } });
        const tsp = await real.tournament_sports.findMany({ where: { tournament_id: { in: ts.map((t) => t.id) } }, select: { id: true } });
        await real.tournament_disciplines.deleteMany({ where: { tournament_sport_id: { in: tsp.map((t) => t.id) } } });
        await real.tournament_sports.deleteMany({ where: { id: { in: tsp.map((t) => t.id) } } });
        await real.standings_rules.deleteMany({ where: { championship_id: c.id } });
        await real.standings.deleteMany({ where: { championship_id: c.id } });
        await real.tournaments.deleteMany({ where: { championship_id: c.id } });
        await real.venues.deleteMany({ where: { championship_id: c.id } });
        await real.user_championship_roles.deleteMany({ where: { championship_id: c.id } });
        await real.championship_organizations.deleteMany({ where: { championship_id: c.id } });
        await real.notifications.deleteMany({ where: { championship_id: c.id } });
        await real.audit_log.deleteMany({ where: { championship_id: c.id } }).catch(() => undefined);
        await real.championships.delete({ where: { id: c.id } });
      });
    }
    if (orgId) {
      await del('org', async () => {
        await real.invoices.deleteMany({ where: { organization_id: orgId! } });
        await real.subscriptions.deleteMany({ where: { organization_id: orgId! } });
        await real.organization_members.deleteMany({ where: { organization_id: orgId! } });
        await real.notifications.deleteMany({ where: { organization_id: orgId! } });
        await real.audit_log.deleteMany({ where: { organization_id: orgId! } }).catch(() => undefined);
        await real.organizations.delete({ where: { id: orgId! } });
      });
    }
    const left = await real.organizations.count({ where: { name: { startsWith: TAG } } })
      + await real.championships.count({ where: { name: { startsWith: TAG } } });
    console.log(left === 0 ? '\ncleanup: nothing left behind' : `\ncleanup: ${left} ${TAG} row(s) LEFT - remove by hand`);
    await new Promise<void>((r) => server.close(() => r()));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await real.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await real.$disconnect(); process.exit(1); });
