import jwt from 'jsonwebtoken';

// Short-lived by design (security: small blast radius if ever leaked).
// The frontend's `accessToken` callback (lib/supabase.ts) refetches before
// this expires, so a long-open tab never actually loses its connection -
// see the token-refresh explanation for why this is safe.
const REALTIME_TOKEN_TTL_SECONDS = 15 * 60;

// This token has nothing to do with this app's own auth (jsonwebtoken +
// env.JWT_SECRET, used for normal API calls). It's a separate, purpose-built
// token signed with Supabase's own (still-active) legacy project JWT secret,
// used only so Supabase Realtime's RLS check can resolve auth.uid() for the
// notification_deliveries subscription. `role: 'authenticated'` is required -
// without it Supabase treats the connection as `anon` regardless of `sub`.
export function mintRealtimeToken(userId: string): {
  token: string;
  expires_at: number;
} {
  const secret = process.env.SUPABASE_JWT_SECRET;

  if (!secret) {
    throw new Error('SUPABASE_JWT_SECRET is not configured');
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) + REALTIME_TOKEN_TTL_SECONDS;

  const token = jwt.sign(
    {
      sub: userId,
      role: 'authenticated',
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: REALTIME_TOKEN_TTL_SECONDS,
    },
  );

  return { token, expires_at: expiresAt };
}