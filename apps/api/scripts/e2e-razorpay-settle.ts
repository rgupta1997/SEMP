/**
 * End-to-end proof of Razorpay settlement, against the real database, with NO
 * call to Razorpay: the key/secret/webhook secret are fakes set for this process
 * only, and orders are inserted directly (as `startCheckout` would after
 * Razorpay answered). Everything created is tagged ZZRZP and deleted at the end.
 *
 *   npx tsx scripts/e2e-razorpay-settle.ts
 *
 * Proves:
 *   1. a forged browser signature is refused, a correct one grants the plan
 *   2. browser callback + webhook racing on one order grant exactly once
 *   3. the webhook rejects a bad signature, ignores non-SEMP orders, settles SEMP ones
 *   4. a payment for the wrong amount is not granted (settle_failed)
 *   5. invoice/subscription carry provider 'razorpay' + the payment id and the coupon-free totals
 *   6. with the gateway on, /subscribe refuses a paid plan
 */
import 'dotenv/config';
process.env.RAZORPAY_KEY_ID = 'rzp_test_e2e';
process.env.RAZORPAY_KEY_SECRET = 'e2e_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'e2e_webhook_secret';

import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';

const TAG = 'ZZRZP';
const prisma = new PrismaClient();
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` - ${detail}`}`);
};

const sig = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

async function main() {
  const { buildApp } = await import('../src/http/server.js');
  const { signToken } = await import('../src/http/middleware/auth.js');
  const { withGst, planFor } = await import('@semp/entitlements');

  const org = await prisma.organizations.create({ data: { name: `${TAG} Test Institute`, plan: 'free' } as never });
  const admin = await prisma.users.create({
    data: { name: `${TAG} Owner`, email: `zzrzp-${Date.now()}@example.test` } as never,
  });
  await prisma.organization_members.create({
    data: { organization_id: org.id, user_id: admin.id, role: 'owner', status: 'active' } as never,
  });

  const app = buildApp(prisma as never);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = signToken({ id: admin.id, email: admin.email, isSuperAdmin: false, organizationId: org.id } as never);
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });

  const price = planFor('org', 'pro').price!.monthly!;
  const total = withGst(price).total;
  const mkOrder = (id: string, plan: 'pro' | 'starter' = 'pro') => prisma.payment_orders.create({
    data: {
      provider_order_id: id, ladder: 'org', organization_id: org.id, plan, period: 'monthly',
      list_price_paise: BigInt(price), total_paise: BigInt(total), created_by: admin.id,
    },
  });

  try {
    console.log('\n1. browser callback');
    await mkOrder(`order_${TAG}_A`);
    let r = await call('POST', '/billing/checkout/verify', { orderId: `order_${TAG}_A`, paymentId: `pay_${TAG}_A`, signature: 'forged' });
    check('forged signature refused', r.status === 400, String(r.status));
    check('plan untouched after forgery', (await prisma.organizations.findUnique({ where: { id: org.id } }))!.plan === 'free');

    const good = sig('e2e_key_secret', `order_${TAG}_A|pay_${TAG}_A`);
    // 2. race: browser + webhook at the same moment
    const hookBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_${TAG}_A`, order_id: `order_${TAG}_A`, amount: total, status: 'captured' } } },
    });
    const [b, w] = await Promise.all([
      call('POST', '/billing/checkout/verify', { orderId: `order_${TAG}_A`, paymentId: `pay_${TAG}_A`, signature: good }),
      call('POST', '/webhooks/razorpay', hookBody, { 'x-razorpay-signature': sig('e2e_webhook_secret', hookBody) }),
    ]);
    check('browser verify 200', b.status === 200, `${b.status} ${await b.clone().text()}`);
    check('webhook 200', w.status === 200, String(w.status));
    console.log('\n2. exactly once');
    const orgAfter = await prisma.organizations.findUnique({ where: { id: org.id } });
    check('org now on pro', orgAfter!.plan === 'pro', String(orgAfter!.plan));
    const subs = await prisma.subscriptions.findMany({ where: { organization_id: org.id } });
    const invs = await prisma.invoices.findMany({ where: { organization_id: org.id } });
    check('one subscription', subs.length === 1, String(subs.length));
    check('one invoice', invs.length === 1, String(invs.length));
    console.log('\n5. provider fields');
    check('invoice provider razorpay + payment id', invs[0]?.provider === 'razorpay' && invs[0]?.provider_ref === `pay_${TAG}_A`);
    check('invoice total = charged total', Number(invs[0]?.total_paise) === total, `${invs[0]?.total_paise} vs ${total}`);
    check('subscription provider razorpay', subs[0]?.provider === 'razorpay');
    const ordA = await prisma.payment_orders.findFirst({ where: { provider_order_id: `order_${TAG}_A` } });
    check('order paid + linked', ordA?.status === 'paid' && ordA.subscription_id === subs[0]?.id && ordA.invoice_id === invs[0]?.id);

    r = await call('POST', '/billing/checkout/verify', { orderId: `order_${TAG}_A`, paymentId: `pay_${TAG}_A`, signature: good });
    check('replayed verify is a no-op', r.status === 200 && (await r.json()).state === 'already_paid');

    console.log('\n3. webhook');
    r = await call('POST', '/webhooks/razorpay', hookBody, { 'x-razorpay-signature': 'bad' });
    check('bad webhook signature 400', r.status === 400, String(r.status));
    const foreign = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_fms', order_id: 'order_from_fms', amount: 100 } } } });
    r = await call('POST', '/webhooks/razorpay', foreign, { 'x-razorpay-signature': sig('e2e_webhook_secret', foreign) });
    check('non-SEMP order acknowledged + ignored', r.status === 200);

    console.log('\n4. wrong amount');
    await prisma.organizations.update({ where: { id: org.id }, data: { plan: 'free' } });
    await mkOrder(`order_${TAG}_B`);
    const short = JSON.stringify({ event: 'order.paid', payload: { payment: { entity: { id: `pay_${TAG}_B`, order_id: `order_${TAG}_B`, amount: total - 100 } } } });
    r = await call('POST', '/webhooks/razorpay', short, { 'x-razorpay-signature': sig('e2e_webhook_secret', short) });
    const ordB = await prisma.payment_orders.findFirst({ where: { provider_order_id: `order_${TAG}_B` } });
    check('short payment -> settle_failed, not granted', r.status === 200 && ordB?.status === 'settle_failed'
      && (await prisma.organizations.findUnique({ where: { id: org.id } }))!.plan === 'free', `${ordB?.status}`);

    console.log('\n6. subscribe bypass');
    r = await call('POST', `/billing/org/${org.id}/subscribe`, { plan: 'pro', period: 'monthly' });
    check('/subscribe refuses a paid plan', r.status === 400, `${r.status} ${await r.text()}`);
    r = await call('GET', `/billing/quote?ladder=org&plan=pro&period=monthly`);
    check('quote reports gateway razorpay', (await r.json()).gateway === 'razorpay');
  } finally {
    server.close();
    await prisma.payment_orders.deleteMany({ where: { organization_id: org.id } });
    await prisma.invoices.deleteMany({ where: { organization_id: org.id } });
    const subIds = (await prisma.subscriptions.findMany({ where: { organization_id: org.id }, select: { id: true } })).map((s) => s.id);
    await prisma.subscription_events.deleteMany({ where: { subscription_id: { in: subIds } } });
    await prisma.subscriptions.deleteMany({ where: { organization_id: org.id } });
    await prisma.notification_deliveries?.deleteMany?.({ where: { notifications: { organization_id: org.id } } } as never).catch(() => {});
    await prisma.notifications?.deleteMany?.({ where: { organization_id: org.id } } as never).catch(() => {});
    await prisma.organization_members.deleteMany({ where: { organization_id: org.id } });
    await prisma.organizations.delete({ where: { id: org.id } }).catch((e) => console.error('cleanup org', e.message));
    await prisma.users.delete({ where: { id: admin.id } }).catch((e) => console.error('cleanup user', e.message));
    await prisma.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
