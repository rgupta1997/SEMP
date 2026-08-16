import { describe, it, expect, vi } from 'vitest';
import { cachedForRequest, requestCache } from './request-cache.js';

// The memo has to be invisible: same answers, fewer queries, and no leakage
// between requests. Everything below is about that boundary rather than the
// caching itself.

/** Run `fn` as if inside one request. */
const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    requestCache({} as any, {} as any, () => { fn().then(resolve, reject); });
  });

describe('cachedForRequest', () => {
  it('runs the work once per key within a request', async () => {
    const load = vi.fn(async () => 'settings');
    const out = await inRequest(async () => {
      const a = await cachedForRequest('k', load);
      const b = await cachedForRequest('k', load);
      return [a, b];
    });
    expect(out).toEqual(['settings', 'settings']);
    expect(load).toHaveBeenCalledOnce();
  });

  it('keeps different keys apart', async () => {
    const out = await inRequest(async () => [
      await cachedForRequest('a', async () => 1),
      await cachedForRequest('b', async () => 2),
    ]);
    expect(out).toEqual([1, 2]);
  });

  // The property that makes request-scope the right lifetime: a change made
  // between requests is visible to the next one.
  it('does not leak between requests', async () => {
    let value = 'before';
    const load = vi.fn(async () => value);

    expect(await inRequest(() => cachedForRequest('k', load))).toBe('before');
    value = 'after';
    expect(await inRequest(() => cachedForRequest('k', load))).toBe('after');
    expect(load).toHaveBeenCalledTimes(2);
  });

  // Two guards resolving the same permission concurrently must share one query,
  // not race to start two.
  it('shares one in-flight query between concurrent callers', async () => {
    const load = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return 'x'; });
    const out = await inRequest(() => Promise.all([
      cachedForRequest('k', load),
      cachedForRequest('k', load),
      cachedForRequest('k', load),
    ]));
    expect(out).toEqual(['x', 'x', 'x']);
    expect(load).toHaveBeenCalledOnce();
  });

  // A transient failure must not become the answer for the rest of the request.
  it('does not remember a rejection', async () => {
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('connection reset');
      return 'recovered';
    });
    const out = await inRequest(async () => {
      await expect(cachedForRequest('k', load)).rejects.toThrow(/connection reset/);
      return cachedForRequest('k', load);
    });
    expect(out).toBe('recovered');
  });

  // Unit tests, scripts and the seeder call straight through with no store.
  // A cache that changed behaviour when unmounted would be a trap.
  it('is a pass-through outside a request', async () => {
    const load = vi.fn(async () => 'direct');
    expect(await cachedForRequest('k', load)).toBe('direct');
    expect(await cachedForRequest('k', load)).toBe('direct');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
