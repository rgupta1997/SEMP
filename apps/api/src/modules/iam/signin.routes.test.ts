import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';

// The env is read at call time inside the handler, so the whole module is
// exercised against a stub. Same pattern as mail-client.test.ts.
//
// `isProduction` is a SEPARATE export of config/env.js, so the stub has to provide
// it explicitly - a stub that only supplied `env` would leave it undefined, which
// is falsy, and every "production" assertion below would pass for the wrong reason.
const envStub = {
  NODE_ENV: 'development' as 'development' | 'test' | 'production',
  AUTH_EMAIL_BYPASS: true,
  OTP_SMS_BYPASS: true,
  OTP_TTL_MIN: 10,
  OTP_MAX_ATTEMPTS: 5,
  MAX_ACCOUNTS_PER_PHONE: 3,
  JWT_SECRET: 'x'.repeat(48),
};
vi.mock('../../config/env.js', () => ({
  env: envStub,
  get isProduction() { return envStub.NODE_ENV === 'production'; },
}));

// One account for any subject, so /otp/send reaches the delivery + response path
// rather than the "no account" early return.
vi.mock('./accounts.service.js', () => ({
  accountsForSubject: async () => [{ id: 'u1', name: 'Asha', email: 'asha@iimb.ac.in' }],
  accountsMatchingPassword: async () => [],
  phoneHasCapacity: async () => true,
}));

// normalizeEmail / normalizePhone stay real - the handler passes their output to
// the delivery mocks, and a stubbed identity would hide a normalisation bug.
vi.mock('./auth-tokens.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth-tokens.service.js')>()),
  issueToken: async () => ({ id: 't1', code: '482913', expires_at: new Date('2030-01-01T00:00:00Z') }),
  recentTokenCount: async () => 0,
  discardToken: async () => undefined,
}));

const deliveries: string[] = [];
let deliveryThrows = false;
vi.mock('../comms/email.js', () => ({
  sendOtpEmail: async (addr: string) => {
    if (deliveryThrows) throw new Error('mail service unreachable');
    deliveries.push(`email:${addr}`);
  },
  sendWelcomeEmail: async () => undefined,
}));
vi.mock('../comms/sms.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../comms/sms.js')>()),
  sendSms: async (m: { to: string }) => {
    if (deliveryThrows) throw new Error('no gateway');
    deliveries.push(`sms:${m.to}`);
  },
}));

const express = (await import('express')).default;
const { makeSignInRouter } = await import('./signin.routes.js');

// A real HTTP round trip rather than a mocked req/res, so validateBody, asyncHandler
// and the JSON serialisation are all in the path - the response body asserted here
// is the one a client would actually receive.
const app = express();
app.use(express.json());
app.use('/auth', makeSignInRouter({} as never));
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;

afterAll(() => { server.close(); });

async function otpSend(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/auth/otp/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ purpose: 'sign_in', ...body }),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

beforeEach(() => {
  envStub.NODE_ENV = 'development';
  envStub.AUTH_EMAIL_BYPASS = true;
  envStub.OTP_SMS_BYPASS = true;
  deliveries.length = 0;
  deliveryThrows = false;
});

describe('POST /auth/otp/send never returns the code in production', () => {
  // The state this asserts - production WITH a bypass on - is one that
  // env.schema.ts now refuses to boot. That is exactly why the assertion belongs
  // here: it is the state any future deploy target that forgets NODE_ENV lands in,
  // and it pins the emission gate independently of the boot gate. Two conditions,
  // neither one the other's proof.
  it('withholds dev_code for an email subject even with AUTH_EMAIL_BYPASS on', async () => {
    envStub.NODE_ENV = 'production';
    envStub.AUTH_EMAIL_BYPASS = true;

    const { body } = await otpSend({ email: 'asha@iimb.ac.in' });

    expect(body.sent).toBe(true);
    expect(body).not.toHaveProperty('dev_code');
    expect(body).not.toHaveProperty('bypass');
  });

  it('withholds dev_code for a phone subject even with OTP_SMS_BYPASS on', async () => {
    envStub.NODE_ENV = 'production';
    envStub.OTP_SMS_BYPASS = true;

    const { body } = await otpSend({ phone: '+919999999999' });

    expect(body.sent).toBe(true);
    expect(body).not.toHaveProperty('dev_code');
    expect(body).not.toHaveProperty('bypass');
  });

  it('leaks the code in no field of the response, whatever it is named', async () => {
    envStub.NODE_ENV = 'production';

    const { body } = await otpSend({ email: 'asha@iimb.ac.in' });

    // Guards against the fix being undone by renaming the field rather than
    // removing it.
    expect(JSON.stringify(body)).not.toContain('482913');
  });
});

describe('the development affordance still works', () => {
  // Locked in deliberately. This is the mechanism that lets a developer with no
  // mail account and no SMS gateway run the whole sign-in flow, and it is what
  // makes redacting the mail/sms logs harmless. Someone "tidying up" the bypass
  // should have to delete this test on purpose.
  it('returns dev_code outside production when the bypass is on', async () => {
    envStub.NODE_ENV = 'development';
    envStub.AUTH_EMAIL_BYPASS = true;

    const { body } = await otpSend({ email: 'asha@iimb.ac.in' });

    expect(body.dev_code).toBe('482913');
    expect(body.bypass).toBe(true);
  });

  it('withholds dev_code outside production when the bypass is off', async () => {
    // Matches the repo's own apps/api/.env, which has AUTH_EMAIL_BYPASS=false.
    envStub.NODE_ENV = 'development';
    envStub.AUTH_EMAIL_BYPASS = false;

    const { body } = await otpSend({ email: 'asha@iimb.ac.in' });

    expect(body.sent).toBe(true);
    expect(body).not.toHaveProperty('dev_code');
  });

  it('withholds dev_code when delivery failed, even in development', async () => {
    // `delivered` gates the emission too: a discarded token has no code worth
    // handing back, and the caller must not be able to distinguish a mail outage
    // from a successful send.
    envStub.NODE_ENV = 'development';
    deliveryThrows = true;

    const { body } = await otpSend({ email: 'asha@iimb.ac.in' });

    expect(body.sent).toBe(true);
    expect(body).not.toHaveProperty('dev_code');
    expect(body).not.toHaveProperty('expires_at');
  });
});

describe('the route is unauthenticated', () => {
  // Trivially true, asserted on purpose: it is the fact that makes everything
  // above load-bearing. /auth is mounted BEFORE requireAuth in http/server.ts, so
  // anything this endpoint returns is world-readable. If someone later moves that
  // mount, this test is where they find out the threat model changed.
  it('answers with no Authorization header at all', async () => {
    envStub.NODE_ENV = 'production';

    const { status, body } = await otpSend({ email: 'asha@iimb.ac.in' });

    expect(status).toBe(200);
    expect(body.sent).toBe(true);
  });
});
