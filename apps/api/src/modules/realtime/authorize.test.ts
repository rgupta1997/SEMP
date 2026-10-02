import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { notificationChannelPath } from '@semp/notifications/core/channels.js';
import { authorize } from './authorize.js';
import {
  realtimeSigningKey,
  REALTIME_TOKEN_AUDIENCE,
  REALTIME_TOKEN_ISSUER,
} from './token-key.js';

// The test that replaces a row-level-security policy.
//
// Until this migration, "user A cannot read user B's notifications" was enforced by
// Postgres: a SELECT policy on notification_deliveries with `user_id = auth.uid()`.
// After it, the only thing enforcing that is the exact-equality check inside
// authorize(). If that check is wrong, every signed-in user can subscribe to every
// other user's channel and there is NO symptom - no error, no log, no failed
// request, just notifications arriving in the wrong browser.
//
// So the table below is deliberately hostile rather than representative. Most of
// these are not mistakes anyone would make on purpose; they are the strings that
// slip past the checks people write INSTEAD of equality - startsWith, includes, an
// unanchored regex, a decodeURIComponent "to be safe".

const SECRET = 'a-test-jwt-secret-of-at-least-32-characters';
const KEY = realtimeSigningKey(SECRET);
const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OTHER = '11111111-2222-3333-4444-555555555555';
const MY_CHANNEL = notificationChannelPath(ME);
const TTL = 900;

function token(over: Record<string, unknown> = {}, key: Buffer | string = KEY): string {
  const { sub = ME, ...rest } = over;
  return jwt.sign({ sub, ...rest }, key as jwt.Secret, {
    algorithm: 'HS256',
    audience: REALTIME_TOKEN_AUDIENCE,
    issuer: REALTIME_TOKEN_ISSUER,
    expiresIn: TTL,
  });
}

function subscribe(channel: unknown, authorizationToken = token()) {
  return authorize(
    {
      authorizationToken,
      requestContext: { operation: 'EVENT_SUBSCRIBE', channel: channel as string },
    },
    { key: KEY, maxTtlSeconds: TTL },
  );
}

describe('EVENT_SUBSCRIBE - the wildcard defence', () => {
  it("authorizes exactly one channel: the caller's own", () => {
    expect(subscribe(MY_CHANNEL).isAuthorized).toBe(true);
  });

  // Every one of these must be denied. A single `true` here is a cross-user leak.
  it.each([
    ['bare wildcard', '*'],
    ['root wildcard', '/*'],
    ['namespace wildcard', '/notifications/*'],
    ['user-segment wildcard', '/notifications/user/*'],
    ['another user outright', notificationChannelPath(OTHER)],
    ['percent-encoded wildcard', '/notifications/user/%2A'],
    ['percent-encoded, lower case', '/notifications/user/%2a'],
    ['path traversal to another', `/notifications/user/${ME}/../${OTHER}`],
    ['trailing slash', `${MY_CHANNEL}/`],
    ['extra segment beneath mine', `${MY_CHANNEL}/sub`],
    ['id prefix of mine', notificationChannelPath(ME.slice(0, 8))],
    ['my id as a prefix of a longer one', notificationChannelPath(`${ME}extra`)],
    ['different namespace', `/other/user/${ME}`],
    ['case-shifted namespace', `/NOTIFICATIONS/user/${ME}`],
    ['null byte suffix', `${MY_CHANNEL}\u0000`],
    ['leading whitespace', ` ${MY_CHANNEL}`],
    ['trailing whitespace', `${MY_CHANNEL} `],
    ['empty string', ''],
    ['null channel on subscribe', null],
    ['undefined channel', undefined],
    ['empty user segment', '/notifications/user/'],
  ])('denies %s', (_label, channel) => {
    expect(subscribe(channel).isAuthorized).toBe(false);
  });
});

describe('token validation', () => {
  const connect = (authorizationToken?: string) =>
    authorize(
      { authorizationToken, requestContext: { operation: 'EVENT_CONNECT', channel: null } },
      { key: KEY, maxTtlSeconds: TTL },
    );

  it('authorizes a connect with a valid token and reports the user', () => {
    const r = connect(token());
    expect(r.isAuthorized).toBe(true);
    expect(r.handlerContext).toEqual({ userId: ME });
  });

  it('denies a missing token', () => expect(connect(undefined).isAuthorized).toBe(false));
  it('denies a malformed token', () => expect(connect('not-a-jwt').isAuthorized).toBe(false));

  // THE assertion that justifies the derived key. A real session token from
  // signToken() must be useless here, or the two token types are interchangeable.
  it('denies a session token signed with the raw JWT_SECRET', () => {
    const session = jwt.sign(
      { sub: ME, email: 'a@b.c', isSuperAdmin: true, organizationId: null },
      SECRET,
      { expiresIn: '7d' },
    );
    expect(connect(session).isAuthorized).toBe(false);
    expect(subscribe(MY_CHANNEL, session).isAuthorized).toBe(false);
  });

  it('denies a token signed with the right claims but the wrong key', () => {
    expect(connect(token({}, 'some-other-secret')).isAuthorized).toBe(false);
  });

  // THE test that makes `algorithms: ['HS256']` load-bearing.
  //
  // Verified by mutation: remove the pin and this token is ACCEPTED, because
  // jsonwebtoken will otherwise honour whatever algorithm the token's own header
  // asks for. Nothing else in this file catches that - the whole suite passed with
  // the pin deleted until this case existed.
  it('denies a token signed HS512 with the very same key', () => {
    const t = jwt.sign({ sub: ME }, KEY, {
      algorithm: 'HS512',
      audience: REALTIME_TOKEN_AUDIENCE,
      issuer: REALTIME_TOKEN_ISSUER,
      expiresIn: TTL,
    });
    expect(connect(t).isAuthorized).toBe(false);
  });

  // Kept deliberately, though it is NOT what the algorithms pin buys: jsonwebtoken
  // v9 rejects an unsigned token on its own ("jwt signature is required"), so this
  // passes with or without the pin. It guards the day that library behaviour changes
  // or someone pins an older major - not today's configuration.
  it('denies alg:none', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: ME,
        aud: REALTIME_TOKEN_AUDIENCE,
        iss: REALTIME_TOKEN_ISSUER,
        exp: Math.floor(Date.now() / 1000) + TTL,
      }),
    ).toString('base64url');
    expect(connect(`${header}.${body}.`).isAuthorized).toBe(false);
  });

  it('denies a wrong audience', () => {
    const t = jwt.sign({ sub: ME }, KEY, {
      algorithm: 'HS256',
      audience: 'something-else',
      issuer: REALTIME_TOKEN_ISSUER,
      expiresIn: TTL,
    });
    expect(connect(t).isAuthorized).toBe(false);
  });

  it('denies a wrong issuer', () => {
    const t = jwt.sign({ sub: ME }, KEY, {
      algorithm: 'HS256',
      audience: REALTIME_TOKEN_AUDIENCE,
      issuer: 'somebody-else',
      expiresIn: TTL,
    });
    expect(connect(t).isAuthorized).toBe(false);
  });

  it('denies a token with no sub', () => {
    const t = jwt.sign({}, KEY, {
      algorithm: 'HS256',
      audience: REALTIME_TOKEN_AUDIENCE,
      issuer: REALTIME_TOKEN_ISSUER,
      expiresIn: TTL,
    });
    expect(connect(t).isAuthorized).toBe(false);
  });

  it('denies an expired token', () => {
    const t = jwt.sign({ sub: ME }, KEY, {
      algorithm: 'HS256',
      audience: REALTIME_TOKEN_AUDIENCE,
      issuer: REALTIME_TOKEN_ISSUER,
      expiresIn: -10,
    });
    expect(connect(t).isAuthorized).toBe(false);
  });
});

describe('ttlOverride never outlives the token', () => {
  // AppSync caches the result on (apiId, channel, operation, token). A TTL longer
  // than the token's remaining life keeps an EXPIRED token working for the rest of
  // the window - the cache becomes the vulnerability.
  it("is clamped to the token's remaining lifetime", () => {
    const t = token();
    const exp = (jwt.decode(t) as jwt.JwtPayload).exp!;
    const almostExpired = exp - 30;
    const r = authorize(
      { authorizationToken: t, requestContext: { operation: 'EVENT_CONNECT', channel: null } },
      { key: KEY, maxTtlSeconds: TTL, nowSeconds: almostExpired },
    );
    expect(r.ttlOverride).toBe(30);
  });

  it('is clamped to maxTtlSeconds when the token outlives it', () => {
    const r = authorize(
      { authorizationToken: token(), requestContext: { operation: 'EVENT_CONNECT', channel: null } },
      { key: KEY, maxTtlSeconds: 60 },
    );
    expect(r.ttlOverride).toBe(60);
  });
});

describe('operations other than connect and subscribe', () => {
  // Publish is AWS_IAM-only on the API, so this should be unreachable. Asserting it
  // means a template drift to AWS_LAMBDA fails closed rather than letting any
  // signed-in browser forge a ping to anyone.
  it('denies EVENT_PUBLISH even with a perfect token', () => {
    expect(
      authorize(
        {
          authorizationToken: token(),
          requestContext: { operation: 'EVENT_PUBLISH', channel: MY_CHANNEL },
        },
        { key: KEY, maxTtlSeconds: TTL },
      ).isAuthorized,
    ).toBe(false);
  });

  it('denies an unknown operation', () => {
    expect(
      authorize(
        {
          authorizationToken: token(),
          requestContext: { operation: 'EVENT_FUTURE', channel: MY_CHANNEL },
        },
        { key: KEY, maxTtlSeconds: TTL },
      ).isAuthorized,
    ).toBe(false);
  });

  it('denies a missing requestContext', () => {
    expect(
      authorize({ authorizationToken: token() }, { key: KEY, maxTtlSeconds: TTL }).isAuthorized,
    ).toBe(false);
  });
});
