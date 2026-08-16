import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { rateLimit, emailKey } from './rate-limit.js';

// The limiter's whole reason for changing: on Lambda the counters used to live in each
// container's memory, so ten containers meant ten budgets and a cold start meant a
// fresh one. These tests drive the limiter the way Lambda does - through SEPARATE
// instances sharing one store - because a single-instance test passes just as happily
// with the old, broken design.

// A stand-in for the shared table: one atomic counter, exactly like rate_limit_hit.
function fakeStore() {
  const counts = new Map<string, number>();
  return {
    counts,
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, key: string, windowStart: Date) => {
      const k = `${key}|${windowStart.toISOString()}`;
      const next = (counts.get(k) ?? 0) + 1;
      counts.set(k, next);
      return [{ rate_limit_hit: next }];
    }),
  } as any;
}

const brokenStore = () => ({ $queryRaw: vi.fn(async () => { throw new Error('db is down'); }) } as any);

// Runs one request through a limiter and resolves 'allowed' | 'limited'.
function hit(limiter: ReturnType<typeof rateLimit>, email = 'a@example.com', ip = '1.1.1.1') {
  return new Promise<'allowed' | 'limited'>((resolve) => {
    const req = { ip, path: '/login', method: 'POST', body: { email }, socket: {} } as unknown as Request;
    limiter(req, {} as Response, (err?: any) => resolve(err ? 'limited' : 'allowed'));
  });
}

const run = async (limiter: ReturnType<typeof rateLimit>, times: number, email?: string, ip?: string) => {
  const out: string[] = [];
  for (let i = 0; i < times; i += 1) out.push(await hit(limiter, email, ip));
  return out;
};

describe('rate limiter', () => {
  it('allows up to the maximum and refuses the one after', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3, keyOn: emailKey, store: fakeStore() });
    expect(await run(limiter, 4)).toEqual(['allowed', 'allowed', 'allowed', 'limited']);
  });

  // THE POINT. Two limiters = two Lambda containers. Before the shared store, the
  // fourth request landed on a fresh container and sailed through.
  it('counts across containers, not per container', async () => {
    const store = fakeStore();
    const containerA = rateLimit({ windowMs: 60_000, max: 3, keyOn: emailKey, store });
    const containerB = rateLimit({ windowMs: 60_000, max: 3, keyOn: emailKey, store });

    expect(await run(containerA, 2)).toEqual(['allowed', 'allowed']);
    // Same caller, brand-new container - and the budget is already nearly spent.
    expect(await run(containerB, 2)).toEqual(['allowed', 'limited']);
  });

  it('a cold start does not hand out a fresh budget', async () => {
    const store = fakeStore();
    const before = rateLimit({ windowMs: 60_000, max: 2, keyOn: emailKey, store });
    await run(before, 2);
    // The container is recycled; everything in its memory is gone.
    const afterColdStart = rateLimit({ windowMs: 60_000, max: 2, keyOn: emailKey, store });
    expect(await hit(afterColdStart)).toBe('limited');
  });

  it('keys on the address as well as the IP, so one campus NAT is not one budget', async () => {
    const store = fakeStore();
    const limiter = rateLimit({ windowMs: 60_000, max: 2, keyOn: emailKey, store });
    await run(limiter, 2, 'first@example.com');
    expect(await hit(limiter, 'first@example.com')).toBe('limited');
    // Different person behind the same NAT.
    expect(await hit(limiter, 'second@example.com')).toBe('allowed');
  });

  it('separates windows so a limit expires', async () => {
    const store = fakeStore();
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyOn: emailKey, store });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-16T10:00:00Z'));
      expect(await hit(limiter)).toBe('allowed');
      expect(await hit(limiter)).toBe('limited');
      vi.setSystemTime(new Date('2026-08-16T10:01:30Z'));
      expect(await hit(limiter)).toBe('allowed');
    } finally { vi.useRealTimers(); }
  });

  // A limiter that locks everybody out when the database blips is a worse outage than
  // the abuse it prevents. "Fails open" means the SHARED verdict is skipped - the
  // per-container ceiling still applies, which is exactly the old behaviour.
  it('fails open when the shared store is unreachable', async () => {
    const store = brokenStore();
    const limiter = rateLimit({ windowMs: 60_000, max: 1, localMax: 10, keyOn: emailKey, store });
    expect(await run(limiter, 3)).toEqual(['allowed', 'allowed', 'allowed']);
    expect(store.$queryRaw).toHaveBeenCalledTimes(3); // it kept trying, and kept letting them in
  });

  // ...but the local layer still absorbs a hot loop even with the store down, which is
  // what stops "fail open" meaning "no limit at all".
  it('still stops a hot loop within one container when the store is down', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 100, localMax: 2, keyOn: emailKey, store: brokenStore() });
    expect(await run(limiter, 4)).toEqual(['allowed', 'allowed', 'limited', 'limited']);
  });

  it('works with no store at all (local layer only)', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2, keyOn: emailKey });
    expect(await run(limiter, 3)).toEqual(['allowed', 'allowed', 'limited']);
  });

  it('does not touch the store before the local ceiling is a concern', async () => {
    const store = fakeStore();
    const limiter = rateLimit({ windowMs: 60_000, max: 5, keyOn: emailKey, store });
    await run(limiter, 2);
    // One shared increment per request - the local layer is a filter, not a cache.
    expect(store.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

// The session read the web app makes on every page load. It lives under /auth, has no
// email in the body - so its key is the IP alone - and a failure signs the user out.
// Counting it would give one campus NAT a shared 20-a-minute budget for using the
// product at all, which is how this exemption came to exist.
describe('exempt requests', () => {
  const meRequest = () => ({ ip: '1.1.1.1', path: '/me', method: 'GET', body: {}, socket: {} } as unknown as Request);
  const send = (limiter: ReturnType<typeof rateLimit>, req: Request) =>
    new Promise<'allowed' | 'limited'>((resolve) => {
      limiter(req, {} as Response, (err?: any) => resolve(err ? 'limited' : 'allowed'));
    });

  it('never counts a skipped request, however many arrive', async () => {
    const store = fakeStore();
    const limiter = rateLimit({
      windowMs: 60_000, max: 2, keyOn: emailKey, store,
      skip: (req) => req.method === 'GET' && req.path === '/me',
    });
    for (let i = 0; i < 10; i += 1) expect(await send(limiter, meRequest())).toBe('allowed');
    expect(store.$queryRaw).not.toHaveBeenCalled();
  });

  it('still limits everything else on the same router', async () => {
    const limiter = rateLimit({
      windowMs: 60_000, max: 1, keyOn: emailKey, store: fakeStore(),
      skip: (req) => req.method === 'GET' && req.path === '/me',
    });
    await send(limiter, meRequest());
    expect(await run(limiter, 2)).toEqual(['allowed', 'limited']); // POST /login
  });
});

describe('emailKey', () => {
  it('normalises the address so casing cannot buy a second budget', () => {
    expect(emailKey({ body: { email: '  ROHIT@IIMB.ac.in ' } } as Request)).toBe('rohit@iimb.ac.in');
  });

  it('survives a missing or odd payload', () => {
    expect(emailKey({} as Request)).toBeNull();
    expect(emailKey({ body: { email: 42 } } as unknown as Request)).toBeNull();
  });
});
