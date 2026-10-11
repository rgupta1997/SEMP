import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = 'a-test-jwt-secret-of-at-least-32-characters';
const HOST = 'abcdefghijklmnopqrstuvwxyz.appsync-api.ap-south-1.amazonaws.com';

vi.mock('../../config/env.js', () => ({
  env: {
    JWT_SECRET: SECRET,
    REALTIME_TOKEN_TTL_SECONDS: 900,
    REALTIME_CHANNEL_NAMESPACE: 'notifications',
    APPSYNC_EVENTS_HTTP_ENDPOINT: HOST,
    APPSYNC_EVENTS_REGION: 'ap-south-1',
  },
}));

const { mintRealtimeToken } = await import('./realtime-token.js');
const { realtimeSigningKey, REALTIME_TOKEN_AUDIENCE, REALTIME_TOKEN_ISSUER } =
  await import('../realtime/token-key.js');

const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('the minted token', () => {
  it('verifies with the derived key and carries the expected claims', () => {
    const { token } = mintRealtimeToken(USER);
    const claims = jwt.verify(token, realtimeSigningKey(SECRET), {
      algorithms: ['HS256'],
      audience: REALTIME_TOKEN_AUDIENCE,
      issuer: REALTIME_TOKEN_ISSUER,
    }) as jwt.JwtPayload;

    expect(claims.sub).toBe(USER);
  });

  it('is NOT verifiable as a session token', () => {
    const { token } = mintRealtimeToken(USER);
    expect(() => jwt.verify(token, SECRET)).toThrow(/invalid signature/);
  });

  it('reports an expiry consistent with the configured TTL', () => {
    const { expires_at } = mintRealtimeToken(USER);
    const now = Math.floor(Date.now() / 1000);
    expect(expires_at).toBeGreaterThan(now + 880);
    expect(expires_at).toBeLessThanOrEqual(now + 900);
  });
});

describe('the connection details handed to the browser', () => {
  it('names the caller\'s own channel', () => {
    expect(mintRealtimeToken(USER).channel).toBe(`/notifications/user/${USER}`);
  });

  it('passes the region through for the client\'s Amplify config', () => {
    expect(mintRealtimeToken(USER).region).toBe('ap-south-1');
  });

  // ---------------------------------------------------------------------------
  // THE endpoint-shape test. Pinned against Amplify's own regex, copied verbatim.
  // ---------------------------------------------------------------------------
  // @aws-amplify/api-graphql's getRealtimeEndpointUrl() matches the configured
  // endpoint against this pattern, and ONLY on a match does it rewrite `appsync-api`
  // to `appsync-realtime-api` and append `/realtime` to build the WebSocket URL. On
  // a miss it silently treats the value as a custom domain, appends `/realtime` to
  // whatever it was handed, and the connection fails with nothing anywhere saying
  // why the endpoint was wrong.
  //
  // So "browser connects over WebSockets, therefore configure the realtime endpoint"
  // is the intuitive answer and it is wrong. This test is here because that mistake
  // produces no error message, and because the regex demands a precise shape - the
  // scheme, the /event path, and a 26-character API id - that a well-meaning
  // refactor of the string concatenation would break.
  const AMPLIFY_EVENT_DOMAIN_PATTERN =
    /^https:\/\/\w{26}\.\w+-api\.\w{2}(?:(?:-\w{2,})+)-\d\.amazonaws.com(?:\.cn)?\/event$/i;

  it('is a URL Amplify will actually recognise as an Event API endpoint', () => {
    const { endpoint } = mintRealtimeToken(USER);
    expect(endpoint).toBe(`https://${HOST}/event`);
    expect(endpoint).toMatch(AMPLIFY_EVENT_DOMAIN_PATTERN);
  });

  // The failure this test exists to prevent, stated as evidence rather than prose.
  it('would NOT be recognised if the realtime hostname were used instead', () => {
    const realtimeHost = HOST.replace('appsync-api', 'appsync-realtime-api');
    expect(`https://${realtimeHost}/event`).not.toMatch(AMPLIFY_EVENT_DOMAIN_PATTERN);
    expect(realtimeHost).not.toMatch(AMPLIFY_EVENT_DOMAIN_PATTERN);
  });
});

describe('when live delivery is off', () => {
  it('still mints a token but reports no endpoint, so the client degrades quietly', async () => {
    vi.resetModules();
    vi.doMock('../../config/env.js', () => ({
      env: {
        JWT_SECRET: SECRET,
        REALTIME_TOKEN_TTL_SECONDS: 900,
        REALTIME_CHANNEL_NAMESPACE: 'notifications',
        APPSYNC_EVENTS_HTTP_ENDPOINT: undefined,
        APPSYNC_EVENTS_REGION: undefined,
      },
    }));

    const { mintRealtimeToken: mint } = await import('./realtime-token.js');
    const result = mint(USER);

    expect(result.endpoint).toBeUndefined();
    expect(result.token).toBeTruthy();
  });
});
