import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal localStorage, because vitest runs these in node and the outbox is
// nothing but a localStorage protocol. Installed before the module under test is
// imported, since it reads storage at call time but the import must not throw.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const store = new MemoryStorage();
vi.stubGlobal('localStorage', store);

const patch = vi.fn();
vi.mock('../../lib/api', () => ({
  API_BASE: 'http://test/api',
  api: (...args: unknown[]) => patch(...args),
}));
vi.mock('../../lib/browserStorage', () => ({ authHeader: () => ({ Authorization: 'Bearer t' }) }));

const { acknowledge, enqueue, flushFixture, getStatus, pendingFixtureIds, readOutbox, stage } =
  await import('./liveOutbox');

const FX = 'fixture-1';

beforeEach(() => {
  store.clear();
  patch.mockReset();
  patch.mockResolvedValue({ ok: true });
});

describe('the outbox', () => {
  it('makes a body durable before anything is sent', () => {
    stage(FX, { home_score: 1 });
    // Nothing has been sent, the process could die here, and the tap is still on disk.
    expect(patch).not.toHaveBeenCalled();
    expect(readOutbox(FX)?.body).toEqual({ home_score: 1 });
  });

  it('merges successive saves into one entry rather than queueing snapshots', () => {
    stage(FX, { home_score: 1, live_log: ['a'] });
    stage(FX, { home_score: 2, live_log: ['a', 'b'] });
    // A status-only save (a walkover) must not wipe the score beside it.
    const e = stage(FX, { status: 'walkover' });
    expect(e.body).toEqual({ home_score: 2, live_log: ['a', 'b'], status: 'walkover' });
    expect(e.seq).toBe(3);
  });

  it('clears the entry on acknowledgement', () => {
    const e = stage(FX, { home_score: 1 });
    acknowledge(FX, e.seq);
    expect(readOutbox(FX)).toBeNull();
  });

  it('keeps taps that arrived while a request was in the air', () => {
    const sent = stage(FX, { home_score: 1 });
    stage(FX, { home_score: 2 }); // the official scored again mid-flight
    acknowledge(FX, sent.seq);
    // The older send succeeding must not throw away the newer tap behind it.
    expect(readOutbox(FX)?.body).toEqual({ home_score: 2 });
  });
});

describe('the sender', () => {
  it('sends what is staged and empties the outbox', async () => {
    enqueue(FX, { home_score: 3 });
    await flushFixture(FX);
    expect(patch).toHaveBeenCalledWith('PATCH', `/fixtures/${FX}/live`, { home_score: 3 });
    expect(readOutbox(FX)).toBeNull();
    expect(getStatus(FX).savedAt).not.toBeNull();
  });

  it('KEEPS the entry when the send fails, and reports it unsaved', async () => {
    patch.mockRejectedValueOnce(new Error('offline'));
    const onError = vi.fn();
    enqueue(FX, { home_score: 3 }, { onError });
    await flushFixture(FX);
    expect(readOutbox(FX)?.body).toEqual({ home_score: 3 });
    expect(getStatus(FX).failed).toBe(true);
    expect(getStatus(FX).unsaved).toBe(true);
    expect(onError).toHaveBeenCalled();
  });

  it('lands the whole match on the retry after a failed send', async () => {
    patch.mockRejectedValueOnce(new Error('offline'));
    enqueue(FX, { home_score: 1 });
    await flushFixture(FX);
    // The official keeps scoring into a dead connection.
    stage(FX, { home_score: 2 });
    stage(FX, { home_score: 3 });
    // Connection back: one request carries everything, nothing was lost.
    await flushFixture(FX);
    expect(patch).toHaveBeenLastCalledWith('PATCH', `/fixtures/${FX}/live`, { home_score: 3 });
    expect(readOutbox(FX)).toBeNull();
  });

  it('does not send two overlapping requests for the same fixture', async () => {
    let release: (v: unknown) => void = () => {};
    patch.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    enqueue(FX, { home_score: 1 });
    // A second tap while the first request is still out: it merges in, and the
    // second flush is a no-op rather than a competing write that could land first.
    const second = flushFixture(FX);
    expect(await second).toBe(false);
    expect(patch).toHaveBeenCalledTimes(1);
    release({ ok: true });
  });

  it('sends again for anything that merged in while the request was away', async () => {
    let release: (v: unknown) => void = () => {};
    patch.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = flushFixture(FX);
    enqueue(FX, { home_score: 1 });
    stage(FX, { home_score: 2 });
    release({ ok: true });
    await first;
    await flushFixture(FX);
    expect(patch).toHaveBeenLastCalledWith('PATCH', `/fixtures/${FX}/live`, { home_score: 2 });
    expect(readOutbox(FX)).toBeNull();
  });

  it('settles every waiter on a failure, so no button is left spinning', async () => {
    patch.mockRejectedValue(new Error('offline'));
    const early = vi.fn();
    const late = vi.fn();
    enqueue(FX, { home_score: 1 }, { onError: early });
    stage(FX, { home_score: 2 });
    enqueue(FX, { home_score: 3 }, { onError: late });
    await flushFixture(FX);
    expect(early).toHaveBeenCalled();
    expect(late).toHaveBeenCalled();
  });
});

describe('recovery', () => {
  it('finds a fixture left unsent by a previous visit', () => {
    stage(FX, { live_state: { rally: [{ t: 'clockStart', at: '2026-09-28T10:00:00.000Z' }] } });
    expect(pendingFixtureIds()).toEqual([FX]);
    // The clock event a reload would otherwise have lost is still here to replay.
    expect((readOutbox(FX)!.body.live_state as any).rally).toHaveLength(1);
  });

  it('reports nothing pending once everything has landed', async () => {
    enqueue(FX, { home_score: 1 });
    await flushFixture(FX);
    expect(pendingFixtureIds()).toEqual([]);
  });

  it('discards an entry too old to belong to a live match', () => {
    stage(FX, { home_score: 1 });
    const raw = JSON.parse(store.getItem(`semp.live.outbox:${FX}`)!);
    raw.at = Date.now() - 48 * 60 * 60 * 1000;
    store.setItem(`semp.live.outbox:${FX}`, JSON.stringify(raw));
    expect(readOutbox(FX)).toBeNull();
  });

  it('survives a corrupted entry rather than blocking every later read', () => {
    store.setItem(`semp.live.outbox:${FX}`, '{"seq":1,"at":');
    expect(readOutbox(FX)).toBeNull();
    stage(FX, { home_score: 1 });
    expect(readOutbox(FX)?.body).toEqual({ home_score: 1 });
  });
});
