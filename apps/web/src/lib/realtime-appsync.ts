import { Amplify } from 'aws-amplify';
import { events } from 'aws-amplify/data';

// The ONLY file in this repo that imports aws-amplify.
//
// Two reasons it is isolated here, and both are enforced rather than hoped for:
//
//  1. It is reached exclusively through `await import('./realtime-appsync')` in
//     lib/realtime.ts, so Rollup gives it its own chunk. Amplify's events client is
//     a few hundred KB, and the login page and first paint should not pay for a
//     feature that only matters once you are signed in. lib/architecture.test.ts
//     fails if any other file imports it.
//  2. packages/notifications must stay transport-agnostic - see the port interface
//     in its client/realtime.ts, which is the reason this adapter exists at all.
//
// NEVER import the `aws-amplify` barrel (`import { ... } from 'aws-amplify'` for
// anything other than Amplify itself): that pulls in Auth, Storage, Analytics and
// friends, roughly 1.5 MB, and would roughly double the application bundle.

interface ConnectInput {
  /** `https://<host>/event` - see the endpoint-shape note below. */
  endpoint: string;
  region: string;
  /** Server-supplied, already canonical. Never built here. */
  channel: string;
  authToken: string;
  onMessage: () => void;
  onError: () => void;
}

export interface OpenChannel {
  close(): void;
}

// Amplify.configure is global and idempotent-unfriendly: calling it repeatedly with
// the same values is wasteful and has been a source of odd behaviour. The endpoint
// can only change if the stack is replaced, in which case a reload is expected, so
// caching on the endpoint string is enough.
let configuredFor: string | null = null;

function configure(endpoint: string, region: string): void {
  if (configuredFor === endpoint) return;

  // ---------------------------------------------------------------------------
  // `endpoint` MUST be the HTTP endpoint with an /event path, not the WebSocket one.
  // ---------------------------------------------------------------------------
  // Amplify derives the wss:// URL itself. getRealtimeEndpointUrl() in
  // @aws-amplify/api-graphql tests the configured value against
  //   ^https://\w{26}\.\w+-api\.<region>\.amazonaws\.com/event$
  // and only on a match rewrites `appsync-api` to `appsync-realtime-api` and appends
  // `/realtime`. On a miss it assumes a custom domain, appends `/realtime` to
  // whatever it was given, and the connection fails with nothing explaining why.
  //
  // The server assembles this string (modules/notifications/realtime-token.ts) and
  // realtime-token.test.ts pins it against that same regex, copied verbatim.
  Amplify.configure({
    API: {
      Events: {
        endpoint,
        region,
        defaultAuthMode: 'lambda',
      },
    },
  });

  configuredFor = endpoint;
}

/**
 * Open one channel and start listening.
 *
 * Resolves once AppSync has ACKed the subscription, not merely once the socket is
 * open. Amplify's EventsSubscription exposes a one-shot `ready` promise for exactly
 * this, and awaiting it is what makes a rejected subscribe - the authorizer refusing
 * the channel - surface as a connect failure the caller can back off from, rather
 * than as a subscription that silently never delivers.
 *
 * `ready` has no built-in timeout, so it is raced against one here. Without that, a
 * server that accepts the socket and then never answers leaves the caller's session
 * awaiting forever with no connection and no retry.
 */
export async function connectChannel(input: ConnectInput): Promise<OpenChannel> {
  configure(input.endpoint, input.region);

  // The channel is passed through EXACTLY as the server gave it. Amplify's
  // `events.connect` does not normalise it (unlike `events.post`, which prepends a
  // leading slash - which is how we know the slash-prefixed form is canonical), so
  // whatever is handed over goes on the wire verbatim and is what the Lambda
  // authorizer compares against. Trimming or rebuilding it here would be a silent
  // mismatch: the publish succeeds, nobody is subscribed, nothing errors.
  const channel = await events.connect(input.channel, {
    authMode: 'lambda',
    authToken: input.authToken,
  });

  const subscription = channel.subscribe({
    // The payload is deliberately ignored - delivery is a ping and the feed re-fetch
    // does the real work, including its own visibility check.
    next: () => input.onMessage(),
    error: () => input.onError(),
  });

  try {
    await Promise.race([
      subscription.ready,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('subscribe ACK timed out')), 10_000),
      ),
    ]);
  } catch (err) {
    // Never leave a half-open channel behind on a failed subscribe.
    channel.close();
    throw err;
  }

  return {
    close: () => channel.close(),
  };
}
