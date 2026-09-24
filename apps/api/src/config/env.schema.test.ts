import { describe, it, expect } from 'vitest';

// Imports the SCHEMA, not env.ts - so nothing here touches process.env, loads
// dotenv, or depends on what the developer's .env happens to contain. That is the
// whole reason the schema was split out of env.ts.
import { envSchema } from './env.schema.js';

/** The two genuinely required fields, with a JWT_SECRET strong enough for production. */
const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/semp',
  JWT_SECRET: 'a'.repeat(48),
};

/** A minimal environment that SHOULD boot in production. */
const prodOk = {
  ...base,
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://events.sportagon.in',
  AUTH_EMAIL_BYPASS: 'false',
  OTP_SMS_BYPASS: 'false',
  MAIL_TRANSPORT: 'http',
  MAIL_API_URL: 'https://mail.test',
  MAIL_API_KEY: 'k',
  REALTIME_TRANSPORT: 'appsync',
  APPSYNC_NOTIFICATIONS_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/1/semp-api-realtime',
  APPSYNC_EVENTS_HTTP_ENDPOINT: 'abcdefghijklmnopqrstuvwxyz.appsync-api.ap-south-1.amazonaws.com',
  APPSYNC_EVENTS_REGION: 'ap-south-1',
};

/** The `path` each reported issue was tagged with. */
function failedPaths(input: Record<string, unknown>): string[] {
  const r = envSchema.safeParse(input);
  expect(r.success, `expected parse to FAIL for ${JSON.stringify(input)}`).toBe(false);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

function parsed(input: Record<string, unknown>) {
  const r = envSchema.safeParse(input);
  if (!r.success) {
    throw new Error(`expected parse to SUCCEED, got: ${JSON.stringify(r.error.issues, null, 2)}`);
  }
  return r.data;
}

describe('NODE_ENV is mandatory', () => {
  // THE test. A default on NODE_ENV is what made every production guard in this
  // schema inert on any deploy target that did not set it, which is how an
  // unauthenticated endpoint ended up handing out sign-in codes.
  it('fails when NODE_ENV is absent', () => {
    expect(failedPaths(base)).toContain('NODE_ENV');
  });

  it('fails when NODE_ENV is an empty string', () => {
    // Lambda's `Environment.Variables` can carry an empty string, and so can a
    // shell that exports a variable it never assigned.
    expect(failedPaths({ ...base, NODE_ENV: '' })).toContain('NODE_ENV');
  });

  // A misspelling must be a crash, not a silent non-production boot. Every one of
  // these would previously have passed as "not production" and re-opened the
  // bypasses.
  it.each(['prod', 'Production', 'PRODUCTION', 'staging', 'dev', 'live'])(
    'rejects %o as a NODE_ENV value',
    (value) => {
      expect(failedPaths({ ...base, NODE_ENV: value })).toContain('NODE_ENV');
    },
  );

  it.each(['development', 'test'])('accepts %o', (value) => {
    expect(parsed({ ...base, NODE_ENV: value }).NODE_ENV).toBe(value);
  });

  it('accepts production when the rest of the environment is configured for it', () => {
    expect(parsed(prodOk).NODE_ENV).toBe('production');
  });

  it('names the fix for each context in the error message', () => {
    const r = envSchema.safeParse(base);
    const msg = r.success ? '' : r.error.issues.map((i) => i.message).join('\n');
    // The person who hits this is usually mid-deploy and does not know the schema.
    expect(msg).toMatch(/development/);
    expect(msg).toMatch(/production/);
    expect(msg).toMatch(/apps\/api\/\.env/);
  });
});

describe('production guards', () => {
  // Each of these asserts the guard fires on the DEFAULT, not on an explicit
  // "true". Absence is what actually shipped, so a test that only covered the
  // explicit value would have passed happily while the bug was live.
  it('refuses production when AUTH_EMAIL_BYPASS is left at its default', () => {
    const { AUTH_EMAIL_BYPASS, ...withoutFlag } = prodOk;
    expect(failedPaths(withoutFlag)).toContain('AUTH_EMAIL_BYPASS');
  });

  it('refuses production when OTP_SMS_BYPASS is left at its default', () => {
    const { OTP_SMS_BYPASS, ...withoutFlag } = prodOk;
    expect(failedPaths(withoutFlag)).toContain('OTP_SMS_BYPASS');
  });

  it('refuses production when MAIL_TRANSPORT is left at its default', () => {
    const { MAIL_TRANSPORT, ...withoutTransport } = prodOk;
    expect(failedPaths(withoutTransport)).toContain('MAIL_TRANSPORT');
  });

  it('refuses production with the bypasses explicitly on', () => {
    const paths = failedPaths({ ...prodOk, AUTH_EMAIL_BYPASS: 'true', OTP_SMS_BYPASS: 'yes' });
    expect(paths).toContain('AUTH_EMAIL_BYPASS');
    expect(paths).toContain('OTP_SMS_BYPASS');
  });

  // Deliberately NOT production-gated: a transport with no credentials is broken
  // everywhere, and failing at boot beats failing on the first password reset.
  it('requires MAIL_API_URL and MAIL_API_KEY whenever the transport is http, in development too', () => {
    expect(failedPaths({ ...base, NODE_ENV: 'development', MAIL_TRANSPORT: 'http' }))
      .toContain('MAIL_API_URL');
    expect(failedPaths({ ...base, NODE_ENV: 'development', MAIL_TRANSPORT: 'http', MAIL_API_URL: 'https://m.test' }))
      .toContain('MAIL_API_URL');
  });

  // Regression test for scripts/deploy-lambda.sh, which built its Lambda
  // `Environment.Variables` from exactly these three keys. Adding NODE_ENV to that
  // payload is necessary but NOT sufficient - this asserts the whole remaining
  // misconfiguration is reported in ONE crash, so an operator fixes it in one pass
  // rather than discovering it one cold start at a time.
  //
  // If you are editing that script's env payload, this is the test that tells you
  // what it still has to carry.
  it('reports every problem with the old deploy-lambda.sh payload at once', () => {
    const paths = failedPaths({
      DATABASE_URL: base.DATABASE_URL,
      JWT_SECRET: base.JWT_SECRET,
      WEB_ORIGIN: 'https://events.sportagon.in',
      NODE_ENV: 'production',
    });
    expect(paths).toContain('AUTH_EMAIL_BYPASS');
    expect(paths).toContain('OTP_SMS_BYPASS');
    expect(paths).toContain('MAIL_TRANSPORT');
    expect(paths).toContain('REALTIME_TRANSPORT');
  });
});

describe('realtime transport in production', () => {
  // The same shape as the MAIL_TRANSPORT guard, and for the same reason. 'off' is
  // not a broken product - the bell falls back to a 2-minute poll and everything
  // still works - which is exactly why nobody would report it. A silent degradation
  // has to fail at boot or it ships.
  it('refuses to boot in production with the transport off', () => {
    expect(failedPaths({ ...prodOk, REALTIME_TRANSPORT: 'off' })).toContain('REALTIME_TRANSPORT');
  });

  it('allows the transport off outside production, so a fresh clone runs with no AWS', () => {
    const env = parsed({ ...base, NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:5173' });
    expect(env.REALTIME_TRANSPORT).toBe('off');
  });

  // Turning the real transport on without its endpoints would otherwise mean every
  // notify() logs an enqueue failure all day.
  it.each([
    ['queue url', 'APPSYNC_NOTIFICATIONS_QUEUE_URL'],
    ['http endpoint', 'APPSYNC_EVENTS_HTTP_ENDPOINT'],
    ['region', 'APPSYNC_EVENTS_REGION'],
  ])('rejects appsync with no %s', (_label, key) => {
    const input: Record<string, unknown> = { ...prodOk };
    delete input[key];
    expect(failedPaths(input)).toContain('APPSYNC_NOTIFICATIONS_QUEUE_URL');
  });

  // Defaults that three separately-deployed things depend on agreeing about.
  it('defaults the namespace and TTL to the values the template and client assume', () => {
    const env = parsed(prodOk);
    expect(env.REALTIME_CHANNEL_NAMESPACE).toBe('notifications');
    expect(env.REALTIME_TOKEN_TTL_SECONDS).toBe(900);
  });
});

describe('JWT_SECRET strength in production', () => {
  // This key signs sessions, verification tickets, certificate signatures and
  // public share links. A known value is a forged super-admin JWT on demand - no
  // OTP, no password. Both strings below were sitting in the repo's env files.
  it.each(['dev-secret-change-me', 'change-me-in-production', 'secret', 'changeme', 'password'])(
    'refuses the known-weak value %o in production',
    (weak) => {
      expect(failedPaths({ ...prodOk, JWT_SECRET: weak })).toContain('JWT_SECRET');
    },
  );

  it('refuses a short random value in production', () => {
    expect(failedPaths({ ...prodOk, JWT_SECRET: 'x7Kq2mB9vT4wR1nZ' })).toContain('JWT_SECRET');
  });

  it('accepts 32 characters and rejects 31', () => {
    expect(parsed({ ...prodOk, JWT_SECRET: 'b'.repeat(32) }).JWT_SECRET).toHaveLength(32);
    expect(failedPaths({ ...prodOk, JWT_SECRET: 'b'.repeat(31) })).toContain('JWT_SECRET');
  });

  // The guard must not make local development annoying - a fresh clone runs on
  // .env.example's value and has to keep working.
  it('allows a weak secret outside production', () => {
    expect(parsed({ ...base, NODE_ENV: 'development', JWT_SECRET: 'change-me-in-production' }).JWT_SECRET)
      .toBe('change-me-in-production');
  });
});

describe('development defaults', () => {
  // Locked in ON PURPOSE. The decision was to keep the dev-friendly defaults and
  // make NODE_ENV mandatory instead, so a future "harden the defaults" change is a
  // visible, deliberate edit to this test rather than a silent behaviour change
  // that nobody notices until a local sign-in stops printing its code.
  it('leaves the bypasses on and the transport on console', () => {
    const e = parsed({ ...base, NODE_ENV: 'development' });
    expect(e.AUTH_EMAIL_BYPASS).toBe(true);
    expect(e.OTP_SMS_BYPASS).toBe(true);
    expect(e.MAIL_TRANSPORT).toBe('console');
  });
});

describe('bool() coercion', () => {
  const flag = (value: unknown) =>
    parsed({ ...base, NODE_ENV: 'development', AUTH_EMAIL_BYPASS: value }).AUTH_EMAIL_BYPASS;

  it.each(['true', 'TRUE', '1', 'yes', 'YES'])('reads %o as true', (v) => {
    expect(flag(v)).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'no'])('reads %o as false', (v) => {
    expect(flag(v)).toBe(false);
  });

  // The asymmetry that matters, asserted so it is a decision rather than an
  // accident: a TYPO fails safe (false), but ABSENCE falls back to the default
  // (true, i.e. open). Absence is the case that shipped to production, and the
  // NODE_ENV guard above is the only thing that now catches it.
  it.each(['ture', 'on', 'enabled', 'y'])('reads the typo %o as false, failing safe', (v) => {
    expect(flag(v)).toBe(false);
  });

  it('falls back to the default when absent or empty, failing OPEN', () => {
    expect(flag(undefined)).toBe(true);
    expect(flag('')).toBe(true);
  });
});
