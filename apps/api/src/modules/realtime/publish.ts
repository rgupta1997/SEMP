import {
  buildPublishBody,
  parseFanoutMessage,
  type NotificationPing,
} from './message.js';
import type { Signer } from './signer.js';

/**
 * The publisher's fan-out loop, with every dependency injected so the retry,
 * concurrency and partial-failure behaviour can be tested without AWS or a network.
 *
 * One signed POST per recipient, because AppSync Events takes one channel per
 * publish request and every user has their own channel - see message.ts.
 */

export interface PublishDeps {
  signer: Signer;
  fetchImpl: typeof fetch;
  /** The Api's Dns.Http output, e.g. abc123.appsync-api.ap-south-1.amazonaws.com */
  endpointHost: string;
  concurrency: number;
  timeoutMs: number;
  /** Injectable so the retry test does not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SqsRecordLike {
  messageId: string;
  body: string;
}

export interface BatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Publish one event to one user.
 *
 * Returns true on success. Retries ONCE on 429 or 5xx or a network error, and never
 * on any other 4xx: a 403 here means the signature or the IAM policy is wrong, and
 * retrying a misconfiguration five times into the DLQ only delays the diagnosis.
 *
 * The 429 case is real rather than theoretical - Event APIs allow 2,000 request
 * tokens per second per account per region, and a championship-wide notification
 * fanned out at concurrency can reach it.
 */
async function publishOne(
  deps: PublishDeps,
  userId: string,
  event: NotificationPing,
): Promise<boolean> {
  const body = buildPublishBody(userId, event);
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      // Jittered, so a throttled batch does not re-arrive as a synchronised burst.
      await sleep(100 + Math.floor(Math.random() * 100));
    }

    try {
      const headers = await deps.signer.sign({
        method: 'POST',
        hostname: deps.endpointHost,
        path: '/event',
        headers: { 'content-type': 'application/json' },
        body,
      });

      const res = await deps.fetchImpl(`https://${deps.endpointHost}/event`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(deps.timeoutMs),
      });

      if (res.ok) return true;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        console.error(
          `[realtime-publisher] ${res.status} publishing to user ${userId} - not retrying`,
        );
        return false;
      }
    } catch (err) {
      // Network error or timeout. Retryable on the first attempt only.
      if (attempt === 1) {
        console.error(`[realtime-publisher] publish to user ${userId} failed:`, err);
        return false;
      }
    }
  }

  return false;
}

/**
 * A bounded worker pool.
 *
 * Hand-rolled rather than a p-limit dependency because it is fifteen lines and this
 * function is deliberately kept off the SDK diet. Unbounded Promise.all over 200 ids
 * would hit AppSync throttling and exhaust the connection pool at the same time.
 */
async function pooled<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<boolean>,
): Promise<boolean> {
  let index = 0;
  let allOk = true;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      const ok = await worker(items[i]!);
      if (!ok) allOk = false;
    }
  });

  await Promise.all(runners);
  return allOk;
}

/**
 * Handle one SQS batch.
 *
 * Reports per-message failures so SQS redrives ONLY those. Without
 * ReportBatchItemFailures, one bad recipient in a batch of ten messages redelivers
 * all ten - a 10x amplification of every transient blip.
 *
 * The granularity ceiling is the message, not the user: if 3 of 200 recipients in a
 * message fail, all 200 are published again on redelivery. That is safe only because
 * the ping is idempotent, and it is why RECIPIENTS_PER_MESSAGE is 200.
 */
export async function handleBatch(
  deps: PublishDeps,
  records: readonly SqsRecordLike[],
): Promise<BatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of records) {
    const message = parseFanoutMessage(record.body);

    if (!message) {
      // Poison: unparseable or a version this code cannot handle. Succeed rather
      // than retry - no number of attempts will make it readable, and cycling it
      // through the DLQ only delays noticing. The log line is the signal.
      console.error(
        `[realtime-publisher] discarding unreadable message ${record.messageId}`,
      );
      continue;
    }

    const ok = await pooled(message.userIds, deps.concurrency, (userId) =>
      publishOne(deps, userId, message.event),
    );

    if (!ok) batchItemFailures.push({ itemIdentifier: record.messageId });
  }

  return { batchItemFailures };
}
