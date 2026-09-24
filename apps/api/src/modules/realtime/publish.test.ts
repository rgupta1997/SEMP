import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleBatch, type PublishDeps, type SqsRecordLike } from './publish.js';
import {
  buildFanoutMessages,
  REALTIME_MESSAGE_VERSION,
  RECIPIENTS_PER_MESSAGE,
} from './message.js';
import { notificationChannelPath } from '@semp/notifications/core/channels.js';

// Every dependency is injected, so these run with no AWS, no network and no timers.
// What is actually under test is the failure behaviour - retry policy, concurrency
// bound, and which SQS messages get redriven - because that is the part that only
// misbehaves under conditions production will find and a smoke test will not.

type FetchCall = { url: string; body: any; headers: any };

function stubFetch(responses: Array<{ status: number } | Error>) {
  const calls: FetchCall[] = [];
  let i = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const fetchImpl = (async (url: string, init: any) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    // Yield, so concurrent callers genuinely overlap and maxInFlight is meaningful.
    await new Promise((r) => setImmediate(r));
    inFlight--;

    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status } as any;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, get maxInFlight() { return maxInFlight; } };
}

function deps(over: Partial<PublishDeps> = {}): PublishDeps {
  const { fetchImpl } = stubFetch([{ status: 200 }]);
  return {
    signer: { sign: async (req) => ({ ...req.headers, authorization: 'AWS4-HMAC-SHA256 ...' }) },
    fetchImpl,
    endpointHost: 'abc123.appsync-api.ap-south-1.amazonaws.com',
    concurrency: 20,
    timeoutMs: 2000,
    sleep: async () => {}, // never actually wait in tests
    ...over,
  };
}

function record(userIds: string[], messageId = 'm1'): SqsRecordLike {
  const [message] = buildFanoutMessages({ notificationId: 'n1', type: 'team_created', recipientIds: userIds });
  return { messageId, body: JSON.stringify(message) };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

describe('one signed POST per recipient', () => {
  it('publishes to each user on their own channel', async () => {
    const f = stubFetch([{ status: 200 }]);
    const res = await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1', 'u2', 'u3'])]);

    expect(res.batchItemFailures).toEqual([]);
    expect(f.calls).toHaveLength(3);
    expect(f.calls.map((c) => c.body.channel)).toEqual([
      notificationChannelPath('u1'),
      notificationChannelPath('u2'),
      notificationChannelPath('u3'),
    ]);
  });

  it('hits the /event path on the configured host', async () => {
    const f = stubFetch([{ status: 200 }]);
    await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls[0]!.url).toBe('https://abc123.appsync-api.ap-south-1.amazonaws.com/event');
  });

  it('sends the signature headers the signer produced', async () => {
    const f = stubFetch([{ status: 200 }]);
    await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls[0]!.headers.authorization).toMatch(/^AWS4-HMAC-SHA256/);
  });

  // AppSync rejects objects here; `events` must be an array of JSON STRINGS, and the
  // mistake surfaces as a generic 400 that says nothing about why.
  it('encodes events as JSON strings, not objects', async () => {
    const f = stubFetch([{ status: 200 }]);
    await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    const { events } = f.calls[0]!.body;
    expect(Array.isArray(events)).toBe(true);
    expect(typeof events[0]).toBe('string');
    expect(JSON.parse(events[0])).toMatchObject({ kind: 'notification', notificationId: 'n1' });
  });

  // The whole reason this path is asynchronous: one channel per request means the
  // 5-events-per-publish allowance cannot be used to batch across users.
  it('never puts more than one channel in a request', async () => {
    const f = stubFetch([{ status: 200 }]);
    await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1', 'u2'])]);
    for (const c of f.calls) {
      expect(typeof c.body.channel).toBe('string');
      expect(c.body.events).toHaveLength(1);
    }
  });
});

describe('concurrency is bounded', () => {
  it('never exceeds the configured limit', async () => {
    const f = stubFetch([{ status: 200 }]);
    const users = Array.from({ length: 50 }, (_, i) => `u${i}`);
    await handleBatch(deps({ fetchImpl: f.fetchImpl, concurrency: 5 }), [record(users)]);

    expect(f.calls).toHaveLength(50);
    expect(f.maxInFlight).toBeLessThanOrEqual(5);
    expect(f.maxInFlight).toBeGreaterThan(1); // and it really is concurrent
  });
});

describe('retry policy', () => {
  it('retries a 429 once and succeeds', async () => {
    const f = stubFetch([{ status: 429 }, { status: 200 }]);
    const res = await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls).toHaveLength(2);
    expect(res.batchItemFailures).toEqual([]);
  });

  it('retries a 500 once', async () => {
    const f = stubFetch([{ status: 500 }, { status: 200 }]);
    await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls).toHaveLength(2);
  });

  it('retries a network error once', async () => {
    const f = stubFetch([new Error('ECONNRESET'), { status: 200 }]);
    await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls).toHaveLength(2);
  });

  // A 403 is a signing or IAM problem. Retrying a misconfiguration five times into
  // the DLQ only delays finding it.
  it('does NOT retry a 403', async () => {
    const f = stubFetch([{ status: 403 }]);
    const res = await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls).toHaveLength(1);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });

  it('does NOT retry a 400', async () => {
    const f = stubFetch([{ status: 400 }]);
    await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls).toHaveLength(1);
  });

  it('gives up after one retry', async () => {
    const f = stubFetch([{ status: 429 }]);
    const res = await handleBatch(deps({ fetchImpl: f.fetchImpl }), [record(['u1'])]);
    expect(f.calls).toHaveLength(2);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });
});

describe('partial batch failure', () => {
  // Without ReportBatchItemFailures, one bad recipient redelivers the whole batch -
  // a 10x amplification of every transient blip.
  it('redrives only the messages that failed', async () => {
    let call = 0;
    const fetchImpl = (async (_url: string, init: any) => {
      const { channel } = JSON.parse(init.body);
      call++;
      // Fail only the user inside message m2.
      return { ok: !channel.endsWith('/bad'), status: channel.endsWith('/bad') ? 403 : 200 } as any;
    }) as unknown as typeof fetch;

    const res = await handleBatch(deps({ fetchImpl }), [
      record(['ok1'], 'm1'),
      record(['bad'], 'm2'),
      record(['ok2'], 'm3'),
    ]);

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm2' }]);
    expect(call).toBe(3);
  });

  it('reports no failures when everything succeeds', async () => {
    const f = stubFetch([{ status: 200 }]);
    const res = await handleBatch(deps({ fetchImpl: f.fetchImpl }), [
      record(['a'], 'm1'), record(['b'], 'm2'),
    ]);
    expect(res.batchItemFailures).toEqual([]);
  });
});

describe('poison messages', () => {
  // Discarded, NOT retried: no number of attempts makes an unreadable message
  // readable, and cycling it to the DLQ only delays noticing. Reported as success so
  // SQS deletes it; the console.error is the signal.
  it.each([
    ['unparseable JSON', 'not json at all'],
    ['a future version', JSON.stringify({ v: REALTIME_MESSAGE_VERSION + 1, notificationId: 'n', userIds: ['u'], event: {} })],
    ['a missing event', JSON.stringify({ v: REALTIME_MESSAGE_VERSION, notificationId: 'n', userIds: ['u'] })],
    ['missing userIds', JSON.stringify({ v: REALTIME_MESSAGE_VERSION, notificationId: 'n', event: { kind: 'notification' } })],
  ])('discards %s without retrying or publishing', async (_label, body) => {
    const f = stubFetch([{ status: 200 }]);
    const res = await handleBatch(deps({ fetchImpl: f.fetchImpl }), [{ messageId: 'm1', body }]);

    expect(f.calls).toHaveLength(0);
    expect(res.batchItemFailures).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('chunking', () => {
  it('splits recipients at the message boundary', () => {
    const ids = Array.from({ length: RECIPIENTS_PER_MESSAGE * 2 + 1 }, (_, i) => `u${i}`);
    const messages = buildFanoutMessages({ notificationId: 'n1', type: 't', recipientIds: ids });

    expect(messages).toHaveLength(3);
    expect(messages[0]!.userIds).toHaveLength(RECIPIENTS_PER_MESSAGE);
    expect(messages[1]!.userIds).toHaveLength(RECIPIENTS_PER_MESSAGE);
    expect(messages[2]!.userIds).toHaveLength(1);
    // No recipient lost or duplicated at the seams.
    expect(messages.flatMap((m) => m.userIds)).toEqual(ids);
  });

  it('produces no messages for no recipients', () => {
    expect(buildFanoutMessages({ notificationId: 'n', type: 't', recipientIds: [] })).toEqual([]);
  });

  // The SQS message cap is 256 KB and a batch is 256 KB in total. Asserted rather
  // than assumed, because exceeding it fails the whole SendMessageBatch.
  it('keeps a full message well inside the 256 KB SQS limit', () => {
    const ids = Array.from({ length: RECIPIENTS_PER_MESSAGE }, () => '7c9e6679-7425-40de-944b-e07fc1f90ae7');
    const [m] = buildFanoutMessages({ notificationId: 'n1', type: 'championship_published', recipientIds: ids });
    const bytes = Buffer.byteLength(JSON.stringify(m), 'utf8');

    expect(bytes).toBeLessThan(10 * 1024);
    // And ten of them in one batch stay inside the batch limit too.
    expect(bytes * 10).toBeLessThan(256 * 1024);
  });
});
