import { describe, it, expect } from 'vitest';
import { getNotificationPorts } from '@semp/notifications/server/notify.js';
import { buildApp } from './server.js';
import { notificationMailPort } from '../modules/comms/notification-mail.js';
import { notificationRealtimePort } from '../modules/realtime/notification-realtime.js';

// Does buildApp actually REGISTER the notification transports?
//
// The sibling of entitlement-mounts.test.ts, and it exists for the same reason.
// notify.email.test.ts already proves the mail port WORKS - and it proved that for
// months while nothing in production ever registered one: server.ts imported
// setNotificationMailPort and the real port beside it, and used neither. A correct
// port nobody registered is indistinguishable from no port at all, and only this
// test tells them apart.
//
// What made that gap invisible is deliberate and is not going away: notify() treats
// an unregistered port as a silent no-op, precisely so a mail service having a bad
// afternoon cannot fail the request that triggered the notification. That same
// silence means a missing registration produces no error, no log line and no other
// failing test - just notifications that quietly never arrive. tsconfig has no
// noUnusedLocals either, so `tsc --noEmit` was happy with the dead imports.
//
// getNotificationPorts() exists for this file. The lesson of the bug is that a port
// you cannot read back is a port no test can prove was wired.

// buildApp only stores the client; nothing touches the database at construction
// (the same premise entitlement-mounts.test.ts relies on).
buildApp({} as any);
const ports = getNotificationPorts();

describe('buildApp registers its notification transports', () => {
  it('registers the mail port', () => {
    expect(ports.mail).not.toBeNull();
  });

  // Not merely "something was registered" - the REAL adapter. A stub would satisfy
  // the assertion above while delivering exactly as much mail as registering nothing.
  it('registers the real mail adapter, not a placeholder', () => {
    expect(ports.mail).toBe(notificationMailPort);
  });

  // The one that catches transport #3.
  //
  // NotificationPorts has required keys, so a new channel is already a compile error
  // at the registration site. This is the runtime half of the same guarantee: it
  // fails when someone adds a key and satisfies the compiler by wiring it to null,
  // which is how the original bug would have been re-introduced.
  it('accounts for every channel notify() knows about', () => {
    expect(Object.keys(ports).sort()).toEqual(['mail', 'realtime']);
  });

  it('registers the realtime port', () => {
    expect(ports.realtime).toBe(notificationRealtimePort);
  });
});
