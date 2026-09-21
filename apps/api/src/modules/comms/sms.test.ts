import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same shape as mail-client.test.ts: the transport decision is read from env at
// call time, so the module is exercised against a stub rather than the
// developer's .env.
const envStub = {
  NODE_ENV: 'test' as 'development' | 'test' | 'production',
  OTP_SMS_BYPASS: true,
};
vi.mock('../../config/env.js', () => ({ env: envStub }));

const { sendSms, otpSms } = await import('./sms.js');

describe('sendSms with OTP_SMS_BYPASS on', () => {
  let logged: string[];

  beforeEach(() => {
    envStub.OTP_SMS_BYPASS = true;
    logged = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the message as not delivered', async () => {
    await expect(sendSms({ to: '+919999999999', text: 'x' })).resolves.toEqual({ delivered: false });
  });

  // OTP_SMS_BYPASS defaults ON, and otpSms() renders the code as the FIRST token of
  // the message body - so logging `text` put every phone sign-in code into whatever
  // reads stdout. This was the noisiest of the three leak paths, because unlike the
  // email bypass it is still on in the repo's own .env.
  it('never logs the rendered body, so the code cannot reach the log store', async () => {
    const code = '482913';
    await sendSms({ to: '+919999999999', ...otpSms(code, 10) });

    const all = logged.join('\n');
    expect(all).not.toContain(code);
    // The recipient is still there - that is what makes the line useful.
    expect(all).toContain('+919999999999');
  });

  it('logs a length instead, so a truncated template is still debuggable', async () => {
    await sendSms({ to: '+919999999999', ...otpSms('482913', 10) });
    expect(logged.join('\n')).toMatch(/\d+ chars/);
  });
});

describe('sendSms with the bypass off', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    envStub.OTP_SMS_BYPASS = true;
  });

  // No gateway is wired. Asserted so there is no silent-drop path: a caller must
  // see the failure rather than believe a message went out. signin.routes.ts
  // catches this, marks the send undelivered and discards the token.
  it('rejects rather than silently dropping the message', async () => {
    envStub.OTP_SMS_BYPASS = false;
    await expect(sendSms({ to: '+919999999999', text: 'x' })).rejects.toThrow(/not wired/i);
  });
});

describe('otpSms', () => {
  it('renders the code and the TTL', () => {
    expect(otpSms('482913', 10).text).toBe(
      '482913 is your Sportagon sign-in code. It expires in 10 minutes.',
    );
  });

  // The reason the log redaction matters: the secret is the first thing in the
  // string, so any prefix of it leaks the whole code.
  it('puts the code first, which is why the body must never be logged', () => {
    expect(otpSms('482913', 10).text.startsWith('482913')).toBe(true);
  });
});
