import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { DomainError } from '../../shared/errors.js';

// A fixed-window limiter for the pre-auth routes.
//
// Two layers, because they fail differently:
//
//   1. IN MEMORY - per container, free, and gone the moment the container is recycled.
//      Catches a hot loop without touching the database.
//   2. IN THE DATABASE - shared by every container, which is what makes it a real
//      limit. The API runs on Lambda at reserved concurrency 10, so the in-memory
//      counter alone gave a caller up to 10x the nominal budget and reset for free on
//      every cold start. Against password guessing on /auth/login that was close to no
//      limit at all.
//
// The shared counter is one atomic upsert (rate_limit_hit) returning the count
// including this request - no read-then-write, so two containers racing on the same key
// cannot both see "4 of 5".
//
// FAILURE POLICY: if the database cannot be reached, requests are ALLOWED. A limiter
// that locks everybody out when the DB blips is a worse outage than the abuse it
// prevents - and a request that needs the DB anyway will fail on its own merits two
// lines later.
//
// Applied at the router level rather than per handler, so a new /auth route is covered
// the moment it is mounted.

class TooManyRequestsError extends DomainError {
  constructor(message = 'Too many requests. Try again in a minute.') {
    super('RATE_LIMITED', message, 429);
  }
}

interface Window { count: number; resetAt: number }

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Extra key material, e.g. the email in the body, so one IP can't burn one address. */
  keyOn?: (req: Request) => string | null;
  /**
   * Omit to get the in-memory layer only. Every mounted limiter should pass this;
   * the parameter is optional so tests can exercise the local layer alone.
   */
  store?: Prisma;
  /**
   * Per-container allowance before the shared counter is consulted at all. Keeps the
   * common case (one or two requests) off the database entirely.
   */
  localMax?: number;
  /**
   * Requests this limiter must not count. For session reads rather than credential
   * attempts - see the note on the /auth mount in server.ts.
   */
  skip?: (req: Request) => boolean;
}

export function rateLimit({ windowMs, max, keyOn, store, localMax, skip }: RateLimitOptions) {
  const windows = new Map<string, Window>();
  // The local layer is deliberately looser than the shared one: it exists to absorb a
  // hot loop, not to be the limit. The shared counter decides.
  const localCeiling = localMax ?? max;

  return function rateLimiter(req: Request, _res: Response, next: NextFunction): void {
    if (skip?.(req)) { next(); return; }
    const now = Date.now();

    // Opportunistic sweep - the map would otherwise grow for the life of the
    // container. Cheap because it only runs when the map is already sizeable.
    if (windows.size > 5_000) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const extra = keyOn?.(req) ?? '';
    const key = `${req.method}:${req.path}:${ip}:${extra}`;

    const existing = windows.get(key);
    if (!existing || existing.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      existing.count += 1;
      if (existing.count > localCeiling) { next(new TooManyRequestsError()); return; }
    }

    if (!store) { next(); return; }

    // The window start is derived from the clock rather than stored, so every
    // container agrees on which row it is incrementing without coordinating.
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    void sweepRateLimits(store); // no-op on ~199 of every 200 requests
    void sharedCount(store, key, windowStart)
      .then((count) => {
        if (count !== null && count > max) next(new TooManyRequestsError());
        else next();
      })
      // Unreachable in practice - sharedCount already swallows - but an unhandled
      // rejection here would hang the request rather than fail it.
      .catch(() => next());
  };
}

async function sharedCount(store: Prisma, key: string, windowStart: Date): Promise<number | null> {
  try {
    const rows = await store.$queryRaw<{ rate_limit_hit: number }[]>`
      select rate_limit_hit(${key}, ${windowStart}::timestamptz)
    `;
    return Number(rows[0]?.rate_limit_hit ?? 0);
  } catch {
    return null; // fail open - see FAILURE POLICY above
  }
}

// Old windows are dead weight. There is no scheduler on Lambda that this could hang
// off, so roughly 1 request in 200 pays for the housekeeping - the table only ever
// holds a few minutes of pre-auth traffic, so that is ample.
export async function sweepRateLimits(store: Prisma, olderThanMs = 3_600_000): Promise<void> {
  if (Math.random() > 0.005) return;
  try {
    await store.rate_limits.deleteMany({ where: { window_start: { lt: new Date(Date.now() - olderThanMs) } } });
  } catch { /* housekeeping must never fail a request */ }
}

// Reads the email out of the body without letting a missing/odd payload throw -
// validation happens later in the chain.
export const emailKey = (req: Request): string | null => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
};
