/**
 * How a live notification reaches this browser tab.
 *
 * An interface, not an implementation - the client-side mirror of
 * NotificationMailPort in server/notify.ts, and for the same reason: this package
 * must not know whether live delivery is a database replication stream, a hosted
 * pub/sub service, or nothing at all. The web app satisfies it; `aws-amplify` is
 * never imported here.
 *
 * The event payload is deliberately absent from this interface. Delivery is a PING:
 * the handler re-fetches, and the feed's own visibility check stays the single place
 * audience rules are enforced. Putting notification content on the wire would mean
 * re-deriving that rule inside a transport with no business knowing it - see
 * apps/api/src/modules/realtime/message.ts for why that is a disclosure boundary.
 */

export interface NotificationRealtimeOptions {
  userId: string;
  /** Called on every delivery. Must be cheap - it may fire in bursts. */
  onNotification: () => void;
}

/**
 * Stops the subscription.
 *
 * Contract, and it is load-bearing: this must be **idempotent** and **safe to call
 * before the underlying connection has finished opening**. React effect cleanups are
 * synchronous while opening a WebSocket is not, and StrictMode double-invokes every
 * effect - so the very first mount in development calls this against a connection
 * that is still a pending promise. An implementation that ignores that leaks a
 * socket per mount, which is billed per connection-minute and is invisible until
 * someone reads a graph.
 */
export type NotificationRealtimeTeardown = () => void;

export interface NotificationRealtimeTransport {
  /**
   * Synchronous, returning the teardown directly.
   *
   * Not `Promise<teardown>`, on purpose. Connecting IS asynchronous, but a promise
   * here would push the unmount-before-connect problem onto every consumer, and one
   * of them would get it wrong. Keeping the signature synchronous confines the whole
   * async lifecycle to the adapter - which is the file that talks to the transport
   * anyway - and leaves useNotificationRealtime structurally unchanged.
   */
  subscribe(options: NotificationRealtimeOptions): NotificationRealtimeTeardown;
}
