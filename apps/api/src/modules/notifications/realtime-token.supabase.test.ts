import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// REALTIME_TRANSPORT=supabase (beta): the token is for Supabase Realtime's RLS check.
const SECRET = 'a-test-jwt-secret-of-at-least-32-characters';
const SUPABASE_SECRET = 'a-different-supabase-project-jwt-secret';

vi.mock('../../config/env.js', () => ({
  env: {
    JWT_SECRET: SECRET,
    REALTIME_TRANSPORT: 'supabase',
    REALTIME_TOKEN_TTL_SECONDS: 900,
    REALTIME_CHANNEL_NAMESPACE: 'notifications',
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    SUPABASE_JWT_SECRET: SUPABASE_SECRET,
  },
}));

const { mintRealtimeToken } = await import('./realtime-token.js');
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('the Supabase realtime grant', () => {
  it('names the transport and hands over the public project details', () => {
    expect(mintRealtimeToken(USER)).toMatchObject({
      transport: 'supabase', url: 'https://proj.supabase.co', key: 'sb_publishable_x', channel: USER,
    });
  });

  it('is signed with the Supabase secret as an authenticated user, so RLS resolves auth.uid()', () => {
    const claims = jwt.verify(mintRealtimeToken(USER).token, SUPABASE_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    expect(claims).toMatchObject({ sub: USER, role: 'authenticated' });
  });

  it('is NOT verifiable as a session token', () => {
    expect(() => jwt.verify(mintRealtimeToken(USER).token, SECRET)).toThrow(/invalid signature/);
  });
});
