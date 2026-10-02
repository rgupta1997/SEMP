import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// The second fence from realtime-token.ts, as an executable assertion.
//
// The realtime token is already unusable here because it is signed with a derived
// key. This file asserts that even if that derivation were removed - which is a
// plausible "simplification", since reusing JWT_SECRET looks harmless - parseAuth
// still refuses a token carrying an audience. Without both fences, the mint endpoint
// hands out working API sessions and nothing anywhere reports it.

const SECRET = 'a-test-jwt-secret-of-at-least-32-characters';
vi.mock('../../config/env.js', () => ({ env: { JWT_SECRET: SECRET } }));

const { parseAuth } = await import('./auth.js');

function run(token: string) {
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  const next = vi.fn();
  parseAuth(req, {} as any, next);
  expect(next).toHaveBeenCalled();
  return req.user;
}

describe('parseAuth rejects non-session tokens', () => {
  it('accepts an ordinary session token', () => {
    const t = jwt.sign(
      { sub: 'u1', email: 'a@b.c', isSuperAdmin: false, organizationId: null },
      SECRET,
      { expiresIn: '7d' },
    );
    expect(run(t)).toMatchObject({ id: 'u1', email: 'a@b.c' });
  });

  // THE assertion. Signed with the RAW secret and therefore verifying correctly -
  // this is exactly the token the original design would have minted.
  it('refuses a token with an audience, even though it verifies', () => {
    const t = jwt.sign({ sub: 'u1' }, SECRET, {
      audience: 'appsync-events',
      issuer: 'semp-api',
      expiresIn: 900,
    });
    expect(run(t)).toBeUndefined();
  });

  it('refuses any audience, not just the realtime one', () => {
    const t = jwt.sign({ sub: 'u1' }, SECRET, { audience: 'anything-at-all', expiresIn: 900 });
    expect(run(t)).toBeUndefined();
  });

  it('still treats a garbage token as anonymous', () => {
    expect(run('not-a-jwt')).toBeUndefined();
  });
});
