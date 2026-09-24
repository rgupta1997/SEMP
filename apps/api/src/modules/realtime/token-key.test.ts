import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  realtimeSigningKey,
  REALTIME_TOKEN_AUDIENCE,
  REALTIME_TOKEN_ISSUER,
} from './token-key.js';

// Proves the security boundary in BOTH directions.
//
// authorize.test.ts asserts one half - a session token is useless to the authorizer.
// This file asserts the half that was the actual defect: a realtime token must be
// useless to parseAuth(). The original design signed realtime tokens with
// env.JWT_SECRET directly, and because parseAuth calls
// `jwt.verify(token, env.JWT_SECRET)` with NO audience option, every token the mint
// endpoint handed out was also a working API session. An `aud` claim does not fix
// that on its own - the verifier has to be told to check it.
//
// The first test below is written to fail loudly if anyone ever "simplifies" the
// derivation away, because the failure it prevents is invisible: nothing errors, a
// leaked realtime token simply becomes a session.

const SECRET = 'a-test-jwt-secret-of-at-least-32-characters';
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function mintRealtimeLike(key: Buffer | string): string {
  return jwt.sign({ sub: USER }, key as jwt.Secret, {
    algorithm: 'HS256',
    audience: REALTIME_TOKEN_AUDIENCE,
    issuer: REALTIME_TOKEN_ISSUER,
    expiresIn: 900,
  });
}

/** Exactly what parseAuth() does in http/middleware/auth.ts - no audience option. */
function verifyAsSession(token: string): unknown {
  return jwt.verify(token, SECRET);
}

describe('realtime tokens are not session tokens', () => {
  it('a realtime token is REJECTED by the session verifier', () => {
    const token = mintRealtimeLike(realtimeSigningKey(SECRET));
    expect(() => verifyAsSession(token)).toThrow(/invalid signature/);
  });

  // The counter-example, kept as evidence rather than prose: signed with the raw
  // secret, the very same token sails through parseAuth. This is the bug.
  it('the same token signed with the raw secret WOULD have been accepted', () => {
    const token = mintRealtimeLike(SECRET);
    expect(verifyAsSession(token)).toMatchObject({ sub: USER });
  });
});

describe('realtimeSigningKey', () => {
  it('is deterministic, so both sides derive the same key', () => {
    expect(realtimeSigningKey(SECRET)).toEqual(realtimeSigningKey(SECRET));
  });

  it('is not the secret itself', () => {
    expect(realtimeSigningKey(SECRET).toString('utf8')).not.toBe(SECRET);
  });

  it('is a 256-bit key', () => {
    expect(realtimeSigningKey(SECRET)).toHaveLength(32);
  });

  it('changes completely when the secret changes', () => {
    expect(realtimeSigningKey(SECRET)).not.toEqual(realtimeSigningKey(`${SECRET}x`));
  });
});
