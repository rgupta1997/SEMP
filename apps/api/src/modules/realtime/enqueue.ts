import {
  SQS_BATCH_SIZE,
  type RealtimeFanoutMessage,
} from './message.js';
import { createSigner, type Signer } from './signer.js';

/**
 * SendMessageBatch against SQS, signed by hand.
 *
 * Runs INSIDE the HTTP request that triggered the notification, against a 15s
 * function timeout, so every cost here is paid by a user waiting for a response.
 * That is the entire justification for the queue: the worst realistic case is 5,000
 * recipients, which chunks to 25 messages and therefore 3 batch calls - roughly
 * 60-100ms. Publishing to AppSync inline instead would be 5,000 signed requests.
 *
 * No @aws-sdk/client-sqs: one signed POST does not need a service client, and
 * lambda.ts:15-20 sets out the policy on keeping megabytes of SDK off the cold-start
 * path. See signer.ts.
 */

export interface EnqueueResult {
  /** Entry ids SQS rejected. A 200 with a non-empty Failed array is still a failure. */
  failed: string[];
  sent: number;
}

export interface EnqueueDeps {
  signer: Signer;
  fetchImpl: typeof fetch;
  queueUrl: string;
  timeoutMs: number;
}

/** SQS's query protocol wants form-encoded entries, not JSON. */
function encodeBatch(messages: readonly RealtimeFanoutMessage[]): URLSearchParams {
  const params = new URLSearchParams({
    Action: 'SendMessageBatch',
    Version: '2012-11-05',
  });

  messages.forEach((message, i) => {
    const n = i + 1; // SQS entry indices are 1-based
    params.set(`SendMessageBatchRequestEntry.${n}.Id`, `m${n}`);
    params.set(`SendMessageBatchRequestEntry.${n}.MessageBody`, JSON.stringify(message));
  });

  return params;
}

/**
 * A single batch call. Returns the entry ids SQS rejected.
 *
 * SQS answers 200 with a per-entry `Failed` list, so silence on a partial failure
 * reads as success - the same trap the mail adapter documents about its own 202.
 */
async function sendOneBatch(
  deps: EnqueueDeps,
  messages: readonly RealtimeFanoutMessage[],
): Promise<string[]> {
  const url = new URL(deps.queueUrl);
  const body = encodeBatch(messages).toString();

  const headers = await deps.signer.sign({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const res = await deps.fetchImpl(deps.queueUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(deps.timeoutMs),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`SQS SendMessageBatch returned ${res.status}: ${text.slice(0, 200)}`);
  }

  // Parsed with a regex rather than an XML library on purpose: the only thing this
  // needs from the response is which entry ids failed, and adding an XML parser to
  // the API bundle for one field is the kind of dependency this module exists to
  // avoid. A shape change would surface as "no failures reported", which the
  // queue-age alarm catches.
  return [...text.matchAll(/<BatchResultErrorEntry>[\s\S]*?<Id>([^<]+)<\/Id>/g)].map((m) => m[1]!);
}

/**
 * Enqueue every chunk of one notification's fan-out.
 *
 * Batches are sent SEQUENTIALLY. 25 calls at ~3ms each is well inside the request
 * budget, and doing them concurrently would trade that for a burst against SQS from
 * inside a request that is already holding a database connection.
 */
export async function enqueueFanout(
  deps: EnqueueDeps,
  messages: readonly RealtimeFanoutMessage[],
): Promise<EnqueueResult> {
  const failed: string[] = [];
  let sent = 0;

  for (let i = 0; i < messages.length; i += SQS_BATCH_SIZE) {
    const batch = messages.slice(i, i + SQS_BATCH_SIZE);
    failed.push(...(await sendOneBatch(deps, batch)));
    sent += batch.length;
  }

  return { failed, sent };
}

/**
 * Lazily constructed, once per container.
 *
 * NOT at module scope: lambda.ts fetches secrets and assigns process.env only AFTER
 * its own imports have evaluated, and it reaches this module through the app's
 * import graph. A signer built at module load would capture the pre-secret
 * environment. (In practice the AWS credential variables are set by the runtime
 * before any of this, but relying on that distinction is exactly the sort of thing
 * that breaks silently the day the module graph shifts.)
 */
let cachedSigner: Signer | null = null;

export function sqsSigner(region: string): Signer {
  cachedSigner ??= createSigner('sqs', region);
  return cachedSigner;
}
