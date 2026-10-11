import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The transport is chosen from env at call time, so the whole module is exercised
// against a stubbed env rather than the developer's .env.
const envStub = {
  // Not read by mail-client.ts today. Present deliberately: the moment someone adds
  // `env.NODE_ENV !== 'production'` to that module, a stub without this field returns
  // undefined, the comparison is true, and any production-gated behaviour quietly
  // turns itself back on while every test still passes.
  NODE_ENV: 'test' as 'development' | 'test' | 'production',
  MAIL_TRANSPORT: 'http' as 'http' | 'console',
  MAIL_API_URL: 'https://mail.test',
  MAIL_API_KEY: 'secret',
  MAIL_TIMEOUT_MS: 5_000,
};
vi.mock('../../config/env.js', () => ({ env: envStub }));

const { sendMail, sendMailBatch, nonEmpty, compact, MailError } = await import('./mail-client.js');

/** Queues the given responses; a thrown value simulates a timeout/connection error. */
function stubFetch(...responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  let i = 0;

  vi.stubGlobal('fetch', async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => r.body ?? null } as any;
  });

  return calls;
}

const otp = {
  to: 'a@iimb.ac.in',
  template: 'otp',
  data: { code: '482913' },
  idempotencyKey: 'otp-sign_in-t1',
};

beforeEach(() => {
  envStub.MAIL_TRANSPORT = 'http';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendMail', () => {
  it('treats 202 as accepted and returns the job id', async () => {
    stubFetch({ status: 202, body: { id: 'job-1', deduplicated: false } });

    await expect(sendMail(otp)).resolves.toEqual({ queued: true, id: 'job-1', deduplicated: false });
  });

  // A replay is a success, not a failure: the service already holds the job, so the
  // caller got what it asked for and must not treat this as "nothing was sent".
  it('treats 200 as an idempotent replay, not an error', async () => {
    stubFetch({ status: 200, body: { id: 'job-1', deduplicated: true } });

    await expect(sendMail(otp)).resolves.toEqual({ queued: true, id: 'job-1', deduplicated: true });
  });

  it('sends the secret alone in x-api-key - a callerName:secret pair is a 401', async () => {
    const calls = stubFetch({ status: 202, body: { id: 'j' } });
    await sendMail(otp);

    expect(calls[0].headers['x-api-key']).toBe('secret');
    expect(calls[0].url).toBe('https://mail.test/mail');
  });

  it('does not retry a 422 - the same bytes fail the same way', async () => {
    const calls = stubFetch({ status: 422, body: { error: { code: 'VALIDATION_ERROR', message: 'bad' } } });

    await expect(sendMail(otp)).rejects.toBeInstanceOf(MailError);
    expect(calls).toHaveLength(1);
  });

  it('surfaces the error envelope so a 422 can be debugged from the log line', async () => {
    stubFetch({ status: 422, body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid data', details: { issues: [] } } } });

    await expect(sendMail(otp)).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
  });

  it('retries a 500 once, reusing the idempotency key so the retry cannot double-send', async () => {
    const calls = stubFetch({ status: 500 }, { status: 202, body: { id: 'job-2' } });

    await expect(sendMail(otp)).resolves.toMatchObject({ queued: true, id: 'job-2' });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.idempotencyKey).toBe(calls[0].body.idempotencyKey);
  });

  it('retries a timeout - a cold Lambda is the normal first request, not an outage', async () => {
    const calls = stubFetch(new Error('The operation was aborted'), { status: 202, body: { id: 'job-3' } });

    await expect(sendMail(otp)).resolves.toMatchObject({ id: 'job-3' });
    expect(calls).toHaveLength(2);
  });

  it('gives up after one retry rather than hanging the caller', async () => {
    const calls = stubFetch({ status: 500 }, { status: 500 });

    await expect(sendMail(otp)).rejects.toBeInstanceOf(MailError);
    expect(calls).toHaveLength(2);
  });

  // Without a key, a retry after a timeout could deliver the message twice: the
  // timeout cannot tell us whether the first attempt was recorded.
  it('does NOT retry when there is no idempotency key to make it safe', async () => {
    const calls = stubFetch({ status: 500 }, { status: 202, body: { id: 'x' } });

    await expect(sendMail({ to: 'a@b.c', subject: 'Hi', text: 'Hi' })).rejects.toBeInstanceOf(MailError);
    expect(calls).toHaveLength(1);
  });

  it('does not let an unparseable 5xx body mask the status', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 503, json: async () => { throw new Error('not json'); } }) as any);

    await expect(sendMail(otp)).rejects.toMatchObject({ status: 503 });
  });

  it('sends nothing over the wire on the console transport', async () => {
    envStub.MAIL_TRANSPORT = 'console';
    const calls = stubFetch({ status: 202, body: { id: 'j' } });

    await expect(sendMail(otp)).resolves.toEqual({ queued: false });
    expect(calls).toHaveLength(0);
  });

  // The console transport is the default (MAIL_TRANSPORT defaults to 'console'), so
  // on any deploy that had not set NODE_ENV this line ran for every OTP mail and put
  // the code into the platform's log store - durable, searchable, and readable by
  // anyone with log access. `data` also carries invite tokens and reset links.
  //
  // Key NAMES are kept: they are what the line was useful for (debugging a 422 over a
  // field the template wanted and we did not send) and they are not secret.
  it('never logs a secret value on the console transport, only key names', async () => {
    envStub.MAIL_TRANSPORT = 'console';
    const logged: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await sendMail(otp);

    const all = logged.join('\n');
    // otp.data.code
    expect(all).not.toContain('482913');
    // ...but the shape is still there to debug with.
    expect(all).toContain('code');
  });

  it('does not log a reset link or invite token on the console transport', async () => {
    envStub.MAIL_TRANSPORT = 'console';
    const logged: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await sendMail({
      to: 'a@iimb.ac.in',
      template: 'invitation',
      data: { inviteUrl: 'https://app.test/invite/PTBHDsr2nJ8kQ1w-secret-token' },
    });

    const all = logged.join('\n');
    expect(all).not.toContain('PTBHDsr2nJ8kQ1w-secret-token');
    expect(all).toContain('inviteUrl');
  });
});

// Every template string prop is minLength: 1, so "" is a 422 rather than an omission.
// Our own data is full of `a || b || ''` fallbacks, and one reaching a template would
// fail an entire send over a field nobody needed.
describe('nonEmpty', () => {
  it('turns blank and whitespace-only into undefined', () => {
    expect(nonEmpty('')).toBeUndefined();
    expect(nonEmpty('   ')).toBeUndefined();
    expect(nonEmpty(null)).toBeUndefined();
    expect(nonEmpty(undefined)).toBeUndefined();
  });

  it('keeps real values, trimmed', () => {
    expect(nonEmpty('  Akash ')).toBe('Akash');
  });
});

describe('compact', () => {
  it('drops undefined and null so `data` never carries an explicit null', () => {
    expect(compact({ a: 1, b: undefined, c: null, d: 'x' })).toEqual({ a: 1, d: 'x' });
  });
});

describe('sendMailBatch', () => {
  it('chunks past the 500-per-request cap', async () => {
    const calls = stubFetch({ status: 202, body: { acceptedCount: 500, rejectedCount: 0, rejected: [] } });
    const messages = Array.from({ length: 1200 }, (_, i) => ({
      to: `p${i}@x.com`, template: 'generic-notification', data: {}, idempotencyKey: `n-${i}`,
    }));

    await sendMailBatch(messages);

    expect(calls).toHaveLength(3);
    expect(calls[0].body.messages).toHaveLength(500);
    expect(calls[2].body.messages).toHaveLength(200);
  });

  // A 202 does not mean every message was accepted - individual ones can be rejected
  // without failing the batch, and swallowing that would read as success.
  it('reports per-message rejections rather than swallowing them', async () => {
    stubFetch({ status: 202, body: { acceptedCount: 1, rejectedCount: 1, rejected: [{ to: 'bad' }] } });

    const res = await sendMailBatch([
      { to: 'a@b.c', template: 'x', data: {} },
      { to: 'bad', template: 'x', data: {} },
    ]);

    expect(res).toEqual({ accepted: 1, rejected: [{ to: 'bad' }] });
  });

  it('does not call the service for an empty list', async () => {
    const calls = stubFetch({ status: 202, body: {} });
    await expect(sendMailBatch([])).resolves.toEqual({ accepted: 0, rejected: [] });
    expect(calls).toHaveLength(0);
  });
});
