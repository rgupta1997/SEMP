import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Node environment, no jsdom, no React - deliberately.
//
// Everything that can actually break in the client half is either pure logic (the
// grant cache, the refresh buffer, the in-flight dedupe, the re-subscribe cycle) or
// it is a real WebSocket handshake against a real Lambda authorizer, which jsdom
// cannot simulate at all. This file covers the first kind. The second belongs in
// apps/web/scripts/, alongside the existing Playwright qa-* harnesses.
//
// The re-subscribe cycle is the reason this file exists. Amplify captures the auth
// token at connect time and AppSync closes the connection when the authorizer's
// cached decision expires, so a connection that outlives its own token reconnects
// with an expired one, is refused, and the bell dies silently. Every manual test
// finishes inside the 15-minute token lifetime, which is exactly why that reaches
// production - so it is pinned here with fake timers instead.

const TTL_MS = 15 * 60 * 1000;
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

let apiMock: ReturnType<typeof vi.fn>;
let tokenPresent = true;
let connectMock: ReturnType<typeof vi.fn>;
let closeSpy: ReturnType<typeof vi.fn>;

vi.mock('./api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  tokenStore: {
    get: () => (tokenPresent ? 'session-token' : null),
    set: () => {},
    clear: () => {},
  },
}));

vi.mock('./realtime-appsync', () => ({
  connectChannel: (...args: unknown[]) => connectMock(...args),
}));

function grant(overrides: Record<string, unknown> = {}) {
  return {
    token: 'realtime-token',
    expires_at: Math.floor((Date.now() + TTL_MS) / 1000),
    endpoint: 'https://abcdefghijklmnopqrstuvwxyz.appsync-api.ap-south-1.amazonaws.com/event',
    region: 'ap-south-1',
    channel: '/notifications/user/u1',
    ...overrides,
  };
}

let mod: typeof import('./realtime');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();

  tokenPresent = true;
  apiMock = vi.fn(async () => grant());
  closeSpy = vi.fn();
  connectMock = vi.fn(async () => ({ close: closeSpy }));

  mod = await import('./realtime');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Lets queued microtasks settle without advancing the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the grant cache', () => {
  it('makes no request at all when nobody is signed in', async () => {
    tokenPresent = false;
    expect(await mod.fetchRealtimeGrant()).toBeNull();
    // A request whose only possible outcome is a 401 in everyone's console.
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('reuses a cached grant rather than refetching', async () => {
    await mod.fetchRealtimeGrant();
    await mod.fetchRealtimeGrant();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent callers into one request', async () => {
    const [a, b, c] = await Promise.all([
      mod.fetchRealtimeGrant(),
      mod.fetchRealtimeGrant(),
      mod.fetchRealtimeGrant(),
    ]);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  // Both sides of the refresh-buffer boundary.
  it('refetches a grant inside the refresh buffer', async () => {
    apiMock = vi.fn(async () => grant({
      expires_at: Math.floor((Date.now() + REFRESH_BUFFER_MS - 1000) / 1000),
    }));
    await mod.fetchRealtimeGrant();
    await mod.fetchRealtimeGrant();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('does not refetch a grant with plenty of life left', async () => {
    await mod.fetchRealtimeGrant();
    vi.setSystemTime(Date.now() + 60_000);
    await mod.fetchRealtimeGrant();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to null when the request fails, and retries next time', async () => {
    apiMock = vi.fn(async () => { throw new Error('offline'); });
    await expect(mod.fetchRealtimeGrant()).resolves.toBeNull();
    // Failure must not poison the cache.
    await mod.fetchRealtimeGrant();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  // Live delivery being OFF server-side is a supported state, not an error.
  it('returns null when the server reports no endpoint', async () => {
    apiMock = vi.fn(async () => grant({ endpoint: undefined, region: undefined }));
    expect(await mod.fetchRealtimeGrant()).toBeNull();
  });

  it('clearRealtimeToken forces a refetch', async () => {
    await mod.fetchRealtimeGrant();
    mod.clearRealtimeToken();
    await mod.fetchRealtimeGrant();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});

describe('realtimeAuthChanged', () => {
  // It sits on an `await` inside the auth provider's mount effect. A rejection there
  // lands in the catch that clears tokenStore and bounces a good session to /login.
  it('never rejects, even when the token request throws', async () => {
    apiMock = vi.fn(async () => { throw new Error('boom'); });
    await expect(mod.realtimeAuthChanged()).resolves.toBeUndefined();
  });

  it('discards the previous session grant and warms the new one', async () => {
    await mod.fetchRealtimeGrant();
    expect(apiMock).toHaveBeenCalledTimes(1);

    await mod.realtimeAuthChanged();
    // Refetched, so the next subscribe cannot present the old user's token.
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});

describe('the subscription session', () => {
  it('connects once, with the server-supplied channel and token', async () => {
    mod.notificationTransport.subscribe({ userId: 'u1', onNotification: () => {} });
    await settle();

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock.mock.calls[0]![0]).toMatchObject({
      channel: '/notifications/user/u1',
      authToken: 'realtime-token',
      region: 'ap-south-1',
    });
  });

  it('forwards deliveries to the callback', async () => {
    const onNotification = vi.fn();
    mod.notificationTransport.subscribe({ userId: 'u1', onNotification });
    await settle();

    connectMock.mock.calls[0]![0].onMessage();
    expect(onNotification).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // THE test. The failure every manual check is too short to find.
  // ---------------------------------------------------------------------------
  it('reconnects before the token expires, not after', async () => {
    mod.notificationTransport.subscribe({ userId: 'u1', onNotification: () => {} });
    await settle();
    expect(connectMock).toHaveBeenCalledTimes(1);

    // One second before the cycle is due: still the original connection.
    await vi.advanceTimersByTimeAsync(TTL_MS - REFRESH_BUFFER_MS - 1000);
    expect(connectMock).toHaveBeenCalledTimes(1);

    // Past it: torn down and rebuilt with a freshly minted token.
    await vi.advanceTimersByTimeAsync(2000);
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('never schedules a reconnect after the token would have expired', async () => {
    mod.notificationTransport.subscribe({ userId: 'u1', onNotification: () => {} });
    await settle();

    await vi.advanceTimersByTimeAsync(TTL_MS);
    // At least one reconnect must already have happened within the token's life.
    expect(connectMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // StrictMode double-invokes effects, so this is the FIRST mount in development,
  // not an edge case. A connection that resolves after teardown and is not closed is
  // a billed, unreachable socket.
  it('closes a connection that opens after teardown', async () => {
    let resolveConnect: (v: unknown) => void = () => {};
    connectMock = vi.fn(() => new Promise((r) => { resolveConnect = r; }));

    const teardown = mod.notificationTransport.subscribe({
      userId: 'u1',
      onNotification: () => {},
    });
    await settle();

    teardown();
    resolveConnect({ close: closeSpy });
    await settle();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on teardown', async () => {
    const teardown = mod.notificationTransport.subscribe({
      userId: 'u1',
      onNotification: () => {},
    });
    await settle();

    expect(() => { teardown(); teardown(); }).not.toThrow();
  });

  it('stops reconnecting once torn down', async () => {
    const teardown = mod.notificationTransport.subscribe({
      userId: 'u1',
      onNotification: () => {},
    });
    await settle();
    teardown();

    await vi.advanceTimersByTimeAsync(TTL_MS * 3);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('does not connect, or retry in a loop, when nobody is signed in', async () => {
    tokenPresent = false;
    mod.notificationTransport.subscribe({ userId: 'u1', onNotification: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(connectMock).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('backs off after a failed connect rather than throwing or spinning', async () => {
    connectMock = vi.fn(async () => { throw new Error('authorizer said no'); });

    const teardown = mod.notificationTransport.subscribe({
      userId: 'u1',
      onNotification: () => {},
    });
    await settle();
    expect(connectMock).toHaveBeenCalledTimes(1);

    // Retries, but not in a tight loop.
    await vi.advanceTimersByTimeAsync(2000);
    const afterFirstBackoff = connectMock.mock.calls.length;
    expect(afterFirstBackoff).toBeGreaterThan(1);
    expect(afterFirstBackoff).toBeLessThan(10);

    teardown();
  });

  it('rebuilds the connection when the transport reports an error', async () => {
    mod.notificationTransport.subscribe({ userId: 'u1', onNotification: () => {} });
    await settle();

    connectMock.mock.calls[0]![0].onError();
    await vi.advanceTimersByTimeAsync(2000);

    expect(connectMock.mock.calls.length).toBeGreaterThan(1);
  });
});
