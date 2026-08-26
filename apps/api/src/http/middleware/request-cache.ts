import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

// A memo that lives exactly as long as one request.
//
// `can()` is called several times in a single request - a route guard, then the
// handler asking a second question, then a view deciding what to render - and
// since J6-E2 each call reads `organizations.settings` to run the module
// pre-check. That is the same row, fetched repeatedly, over a pooled connection,
// inside a 15s Lambda ceiling.
//
// Request-scoped is the only cache lifetime that is obviously correct here.
// A process-wide cache would serve an institution its old module settings after
// an admin changed them - for however long the Lambda container happened to live
// - and "why is Reports still hidden?" is a bug nobody would enjoy tracing. One
// request cannot observe its own staleness, because a change made mid-request is
// a change the request has not read yet either.
//
// AsyncLocalStorage rather than threading a cache parameter through every
// signature: `can()` is called from ~40 places, most of which have no idea a
// module system exists, and adding an argument to all of them to serve an
// optimisation would be the wrong trade.

const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Mount once, before any route that resolves permissions. */
export const requestCache: RequestHandler = (_req, _res, next) => {
  store.run(new Map(), () => next());
};

/**
 * Run `fn` once per request per key.
 *
 * OUTSIDE a request - unit tests, scripts, the seeder - there is no store and
 * this is a plain pass-through. That is deliberate: a cache that only works when
 * wired up should not change behaviour when it is not, and a test that gets a
 * cached answer from a previous test would be far worse than a duplicated query.
 *
 * The PROMISE is cached, not the resolved value, so two concurrent callers with
 * the same key share one query rather than racing to start two.
 */
export function cachedForRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cache = store.getStore();
  if (!cache) return fn();
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn().catch((err) => {
    // A failed lookup must not be remembered as the answer for the rest of the
    // request - the next caller should get a fresh attempt, not a cached
    // rejection that outlives whatever transient thing caused it.
    cache.delete(key);
    throw err;
  });
  cache.set(key, p);
  return p;
}
