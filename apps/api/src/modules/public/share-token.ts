import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

// Unguessable, stateless share tokens for public view-only championship links. The
// token is the championship id plus an HMAC over it (keyed by JWT_SECRET), so it
// needs no DB column and can't be forged without the server secret. Rotating
// JWT_SECRET invalidates every share link.
const signature = (id: string) =>
  createHmac('sha256', env.JWT_SECRET).update(`share:${id}`).digest('base64url').slice(0, 24);

export function signShareToken(championshipId: string): string {
  return Buffer.from(`${championshipId}.${signature(championshipId)}`).toString('base64url');
}

// Returns the championship id when the token's signature checks out, else null.
export function verifyShareToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const dot = decoded.lastIndexOf('.');
    if (dot <= 0) return null;
    const id = decoded.slice(0, dot);
    const provided = Buffer.from(decoded.slice(dot + 1));
    const expected = Buffer.from(signature(id));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    return id;
  } catch {
    return null;
  }
}
