import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { DomainError } from '../../shared/errors.js';

// The Razorpay edge: four HTTP calls and two signature checks, nothing else.
//
// Uses the Orders API + Checkout (the in-page modal), not Payment Links: the
// buyer is already in the product, so the modal is one click where a link is a
// round trip through WhatsApp. The FMS opens the same modal but WITHOUT a
// server-side order, trusting the payment id the browser reports; here the
// server creates the order for the amount it priced and checks Razorpay's
// signature before granting anything.
//
// Same merchant account as the FMS. The two never see each other's payments:
// the FMS webhook acts only on payment_link.* events, SEMP's only on
// order.paid / payment.captured for orders found in payment_orders.

const API = 'https://api.razorpay.com/v1';

export class PaymentGatewayError extends DomainError {
  constructor(message: string) {
    super('PAYMENT_GATEWAY', message, 502);
  }
}

/** Checkout is on only when both halves of the key are configured. */
export function gatewayEnabled(): boolean {
  return !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export function publicKeyId(): string | null {
  return gatewayEnabled() ? env.RAZORPAY_KEY_ID! : null;
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  // Lambda's synchronous budget is 15s; Razorpay answers in well under one.
  // A hung call must fail the request rather than eat the whole budget.
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  }).catch((e: unknown) => {
    throw new PaymentGatewayError(`Could not reach the payment gateway (${e instanceof Error ? e.message : 'network'}). Please try again.`);
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    const reason = json?.error?.description ?? `HTTP ${res.status}`;
    console.error(`[razorpay] ${method} ${path} failed: ${reason}`);
    throw new PaymentGatewayError(`The payment gateway refused the request: ${reason}`);
  }
  return json as T;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: 'created' | 'attempted' | 'paid';
}

/** `amount` in paise. `receipt` max 40 chars (Razorpay's limit). Notes are shown in the dashboard. */
export function createOrder(input: { amount: number; receipt: string; notes: Record<string, string> }) {
  return call<RazorpayOrder>('POST', '/orders', {
    amount: input.amount,
    currency: 'INR',
    receipt: input.receipt.slice(0, 40),
    notes: input.notes,
  });
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
}

/** Every payment attempt against an order (the reconcile sweep's question). */
export async function paymentsForOrder(orderId: string): Promise<RazorpayPayment[]> {
  const r = await call<{ items: RazorpayPayment[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
  return r.items ?? [];
}

function safeEqualHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The browser callback's proof: HMAC-SHA256(order_id + "|" + payment_id, key secret).
 * Only Razorpay and this server hold the secret, so a valid signature means
 * Razorpay says this payment completed against this order.
 */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** The webhook's proof: HMAC-SHA256 of the RAW body with the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
