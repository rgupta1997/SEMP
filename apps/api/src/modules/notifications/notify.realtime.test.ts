import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  notify,
  setNotificationPorts,
  type NotificationRealtimePort,
} from '@semp/notifications/server/notify.js';

// The sibling of notify.email.test.ts, and the cases that matter are the same two
// degradation cases plus one ordering guarantee.
//
// Realtime delivery is an enhancement: the notification row is written and the feed
// is authoritative. So a broken transport must never turn "your fixture moved" into
// a failed request for the organiser who moved it - they would see an error, retry,
// and produce a SECOND notification.

type Published = Parameters<NotificationRealtimePort['publish']>[0];

let published: Published[] = [];
let order: string[] = [];

function capturePort(): NotificationRealtimePort {
  return {
    publish: async (input) => {
      published.push(input);
      order.push('realtime');
    },
  };
}

function fakePrisma() {
  return {
    notifications: {
      create: async () => ({ id: 'notif-1' }),
    },
    notification_deliveries: {
      createMany: async ({ data }: any) => {
        order.push('deliveries');
        return { count: data.length };
      },
    },
    users: { findMany: async () => [] },
    // plan_changed resolves to org admins - see Rules.orgAdmins in the registry.
    organization_members: { findMany: async () => [{ user_id: 'u1' }, { user_id: 'u2' }] },
    user_championship_roles: { findMany: async () => [] },
    championship_officials: { findMany: async () => [] },
    championship_organizations: { findMany: async () => [] },
    team_members: { findMany: async () => [] },
    teams: { findMany: async () => [] },
    roles: { findMany: async () => [] },
  } as any;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  published = [];
  order = [];
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  setNotificationPorts({ mail: null, realtime: capturePort() });
});

afterEach(() => {
  errorSpy.mockRestore();
  setNotificationPorts(null);
});

async function run() {
  return notify(fakePrisma(), {
    type: 'plan_changed',
    organizationId: 'org-1',
    data: { to: 'Pro' },
  });
}

describe('realtime fan-out', () => {
  it('publishes once, carrying every resolved recipient', async () => {
    await run();
    expect(published).toHaveLength(1);
    expect(published[0]!.notificationId).toBe('notif-1');
    expect([...published[0]!.userIds].sort()).toEqual(['u1', 'u2']);
    expect(published[0]!.type).toBe('plan_changed');
  });

  // Ordering, not an incidental detail: a ping that overtakes the delivery row it
  // announces produces a refetch that finds nothing, and the badge stays stale until
  // the next poll. Asserted with a shared log rather than call counts so it cannot
  // pass by accident.
  it('publishes only AFTER the delivery rows are written', async () => {
    await run();
    expect(order).toEqual(['deliveries', 'realtime']);
  });

  it('carries no message content - only ids and the type', async () => {
    await run();
    // Asserted as an ABSENCE, with the reasoning in message.ts: the publisher has no
    // database and cannot re-check visibility, so content on the wire turns a
    // mis-resolved audience from a spurious badge into a disclosure.
    expect(Object.keys(published[0]!).sort()).toEqual(['notificationId', 'type', 'userIds']);
  });

  // The direct analogue of notify.email.test.ts's mail-failure case.
  it('never lets a transport failure fail the notification', async () => {
    setNotificationPorts({
      mail: null,
      realtime: { publish: async () => { throw new Error('SQS is having a moment'); } },
    });

    const notification = await run();

    expect(notification).toMatchObject({ id: 'notif-1' });
    // Swallowed, but LOUD: notify() staying quiet is only defensible because the
    // queue-age and DLQ alarms exist. A swallowed error with no alarm anywhere is
    // how the mail port went unnoticed for months.
    expect(errorSpy).toHaveBeenCalled();
  });

  it('works with no realtime port registered at all', async () => {
    setNotificationPorts(null);
    await expect(run()).resolves.toMatchObject({ id: 'notif-1' });
    expect(published).toHaveLength(0);
  });

  it('does not publish when the audience resolves to nobody', async () => {
    const prisma = fakePrisma();
    prisma.organization_members.findMany = async () => [];

    await notify(prisma, { type: 'plan_changed', organizationId: 'org-1', data: { to: 'Pro' } });

    expect(published).toHaveLength(0);
  });
});
