// AWS Lambda entry point: the notification fan-out publisher.
//
// SQS -> this -> one signed POST per recipient -> AppSync -> WebSocket -> browser.
//
// Why this exists as its own function rather than a few lines inside notify():
// AppSync Events takes ONE channel per publish request, and every user has their own
// channel, so a notification with N recipients is N HTTP requests. A championship-wide
// notification can resolve to thousands. Doing that inline would blow the API's 15s
// timeout and make an organiser wait on it; doing it after res.json() does not work
// either, because Lambda freezes the container when the response returns. A queue is
// the only shape that fits.
//
// ---------------------------------------------------------------------------
// No database, no secrets, no VPC.
// ---------------------------------------------------------------------------
// Authorization to publish is AWS_IAM, satisfied by this function's execution role,
// so there is no token to fetch and no Secrets extension layer - which is also why it
// cold-starts in a fraction of the API's time. It deliberately cannot read
// notification rows: it publishes the recipient list the API already resolved, and
// carries no message content. See message.ts for why that is a disclosure boundary
// rather than a size optimisation.
//
// scripts/build-fn.mjs enforces a bundle budget so that an import which drags in
// config/env.ts or infra/prisma.ts fails the build rather than quietly adding a
// database connection to a function that should never hold one.

import { handleBatch, type BatchResponse } from './modules/realtime/publish.js';
import { createSigner } from './modules/realtime/signer.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set - it is supplied by infra/semp-api.yaml`);
  return v;
}

const endpointHost = required('APPSYNC_EVENTS_HTTP_ENDPOINT').replace(/^https?:\/\//, '');

// AWS_REGION is always set by the Lambda runtime.
const signer = createSigner('appsync', required('AWS_REGION'));

const concurrency = Number(process.env.PUBLISH_CONCURRENCY ?? '20');
const timeoutMs = Number(process.env.PUBLISH_TIMEOUT_MS ?? '2000');

interface SqsEvent {
  Records: Array<{ messageId: string; body: string }>;
}

export async function handler(event: SqsEvent): Promise<BatchResponse> {
  // Returning batchItemFailures requires FunctionResponseTypes:
  // [ReportBatchItemFailures] on the event source mapping. Without it SQS ignores
  // this value and redelivers the ENTIRE batch whenever anything in it failed - a
  // 10x amplification of every transient blip. The two settings only work together.
  return handleBatch(
    { signer, fetchImpl: fetch, endpointHost, concurrency, timeoutMs },
    event.Records ?? [],
  );
}
