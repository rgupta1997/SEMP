// Razorpay Checkout (the in-page payment modal).
//
// The server creates the order and hands over everything needed to open it -
// key id included - so nothing here is configured at build time. The modal
// returns a signed (order, payment, signature) triple which the caller posts
// back to the API; the API checks the signature before granting anything.

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (r: unknown) => void): void };
  }
}

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

let loading: Promise<boolean> | null = null;

function loadScript(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { loading = null; resolve(false); };
    document.body.appendChild(s);
  });
  return loading;
}

export interface RazorpayOrderHandoff {
  keyId: string;
  orderId: string;
  amount: number;
  currency: 'INR';
  description: string;
  prefill: { name: string; email: string; contact: string };
}

export interface RazorpaySuccess {
  orderId: string;
  paymentId: string;
  signature: string;
}

/** Thrown when the buyer closes the modal without paying. */
export class CheckoutCancelled extends Error {
  constructor() { super('cancelled'); }
}

/** Opens the modal. Resolves with the signed result, rejects with CheckoutCancelled or a failure. */
export async function payWithRazorpay(order: RazorpayOrderHandoff): Promise<RazorpaySuccess> {
  if (!(await loadScript()) || !window.Razorpay) {
    throw new Error('Could not load the payment window. Check your connection and try again.');
  }
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'Sportagon',
      description: order.description,
      prefill: order.prefill,
      theme: { color: brand && brand.startsWith('#') ? brand : '#2563eb' },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        resolve({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => reject(new CheckoutCancelled()) },
    });
    // A failed attempt leaves the modal open so the buyer can retry with another
    // method; nothing to do here beyond letting Razorpay show it.
    rzp.open();
  });
}
