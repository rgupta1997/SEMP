// AWS Lambda entry point: the AppSync Events authorizer.
//
// AppSync calls this before every connect, subscribe and publish on the Event API,
// and its answer is the only thing keeping one user's notifications out of another
// user's browser - it is what replaced the Postgres RLS policy on
// notification_deliveries. The decision itself lives in modules/realtime/authorize.ts
// as a pure function so it can be tested exhaustively; this file is only the shell
// that fetches the secret and adapts the event shape.
//
// ---------------------------------------------------------------------------
// This file must stay TINY. Import nothing from config/, infra/ or http/.
// ---------------------------------------------------------------------------
// It sits on the connect path, where AWS asks for sub-1s execution, and it is
// invoked on every subscribe. Reaching config/env.ts would drag in the whole env
// schema; reaching infra/prisma.ts would drag in a 20 MB query engine and a database
// connection this function has no business holding. scripts/build-fn.mjs enforces a
// bundle-size budget precisely so that an innocent-looking shared import fails the
// BUILD rather than quietly adding half a second to every connection.
//
// Secrets come from the Parameters and Secrets Lambda Extension over plain fetch,
// not the AWS SDK - same reasoning as lambda.ts, which explains it at length: one
// cached loopback call per cold start instead of megabytes of SDK parsed every time.
// getSecret is duplicated here rather than imported from lambda.ts on purpose;
// importing it would pull in that module's database-URL assembly and its top-level
// secret fetch.

import {
  authorize,
  type AppSyncAuthorizerEvent,
  type AppSyncAuthorizerResult,
} from './modules/realtime/authorize.js';
import { realtimeSigningKey } from './modules/realtime/token-key.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set - it is supplied by infra/semp-api.yaml`);
  return v;
}

/** One secret, as the JSON object it stores. */
async function getSecret(arn: string): Promise<Record<string, string>> {
  const token = process.env.AWS_SESSION_TOKEN;
  if (!token) {
    throw new Error(
      'AWS_SESSION_TOKEN is missing - the Parameters and Secrets extension refuses ' +
        'requests without it. This module only runs on Lambda.',
    );
  }

  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const res = await fetch(
    `http://localhost:${port}/secretsmanager/get?secretId=${encodeURIComponent(arn)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );

  if (!res.ok) {
    throw new Error(`Secrets extension returned ${res.status} for ${arn}`);
  }

  const body = (await res.json()) as { SecretString?: string };
  return JSON.parse(body.SecretString ?? '{}');
}

// Top-level await, so the key is derived once per container rather than per
// invocation. HKDF is cheap, but the secret fetch behind it is not, and the
// authorizer is invoked on a latency-sensitive path.
const app = await getSecret(required('APP_SECRET_ARN'));
const key = realtimeSigningKey(app.JWT_SECRET);

// Must not exceed the TTL the API mints tokens with, or AppSync caches an
// authorization for longer than the token backing it is valid - see authorize.ts.
const maxTtlSeconds = Number(process.env.REALTIME_TOKEN_TTL_SECONDS ?? '900');

export async function handler(
  event: AppSyncAuthorizerEvent,
): Promise<AppSyncAuthorizerResult> {
  // Never throw. A thrown authorizer surfaces as a 500 that reads like an AppSync
  // outage; a returned `false` is an ordinary, diagnosable denial. The reason goes
  // to CloudWatch, never to the caller - an authorizer that explains itself is an
  // oracle.
  try {
    const result = authorize(event, { key, maxTtlSeconds });

    if (!result.isAuthorized) {
      console.warn(
        '[realtime-authorizer] denied',
        JSON.stringify({
          operation: event.requestContext?.operation ?? null,
          channel: event.requestContext?.channel ?? null,
        }),
      );
    }

    return result;
  } catch (err) {
    console.error('[realtime-authorizer] unexpected failure:', err);
    return { isAuthorized: false };
  }
}
