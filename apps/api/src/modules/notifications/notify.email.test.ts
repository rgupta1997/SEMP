import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notify, setNotificationPorts, type NotificationMailPort } from '@semp/notifications/server/notify.js';

// Lives here rather than in packages/notifications because that package has no test
// runner of its own - apps/api's vitest is where this monorepo's tests actually run.
//
// A prisma stand-in covering only what notify() touches. `users` is the addition the
// email channel needs; everything else is enough to let the fan-out run.
function fakePrisma(users: Array<{ id: string; email: string | null; email_verified_at: Date | null }>) {
  const deliveries: Array<{ notification_id: string; user_id: string }> = [];

  return {
    deliveries,
    notifications: { create: async () => ({ id: 'n1' }) },
    notification_deliveries: {
      createMany: async ({ data }: any) => { deliveries.push(...data); return {}; },
    },
    users: {
      findMany: async ({ where }: any) => users.filter((u) => where.id.in.includes(u.id)),
    },
    organization_members: {
      findMany: async () => users.map((u) => ({ user_id: u.id })),
    },
    user_championship_roles: { findMany: async () => [] },
    championship_officials: { findMany: async () => [] },
    championship_organizations: { findMany: async () => [] },
    team_members: { findMany: async () => [] },
    teams: { findMany: async () => [] },
    roles: { findMany: async () => [] },
  } as any;
}

const verified = (id: string, email: string) => ({ id, email, email_verified_at: new Date() });
const unverified = (id: string, email: string) => ({ id, email, email_verified_at: null });

let sent: Parameters<NotificationMailPort['send']>[0][];

function capturePort(): NotificationMailPort {
  return { send: async (input) => { sent.push(input); } };
}

beforeEach(() => {
  sent = [];
  setNotificationPorts({ mail: capturePort(), realtime: null });
});

describe('notify() email fan-out', () => {
  it('emails a type that opts in', async () => {
    const prisma = fakePrisma([verified('u1', 'a@iimb.ac.in')]);

    await notify(prisma, {
      type: 'plan_changed',
      organizationId: 'org-1',
      data: { organizationName: 'IIMB', from: 'Free', to: 'Pro' },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].content.subject).toContain('Pro');
    expect(sent[0].recipients).toEqual([{ userId: 'u1', email: 'a@iimb.ac.in' }]);
  });

  // Types without an `email` block reach the feed only. That is the default because
  // every type fires today without anybody having agreed to be emailed about it.
  it('stays silent for a type that has not opted in', async () => {
    const prisma = fakePrisma([verified('u1', 'a@iimb.ac.in')]);

    await notify(prisma, {
      type: 'org_join_request',
      organizationId: 'org-1',
      data: { who: 'Akash', organizationName: 'IIMB' },
    });

    expect(sent).toHaveLength(0);
  });

  // One message per recipient, never one message addressed to all of them: a
  // championship-wide notification would otherwise hand every recipient a roster of
  // everybody else's address.
  it('keeps recipients separate rather than putting them all on one message', async () => {
    const prisma = fakePrisma([verified('u1', 'a@x.com'), verified('u2', 'b@x.com')]);

    await notify(prisma, {
      type: 'plan_changed',
      organizationId: 'org-1',
      data: { organizationName: 'IIMB', to: 'Pro' },
    });

    expect(sent[0].recipients).toHaveLength(2);
    // The port contract is a list of recipients, each of which the transport sends
    // its own message to - not a single `to` array.
    expect(sent[0]).not.toHaveProperty('to');
  });

  it('skips unverified addresses - an unverified claim must not start mail flowing', async () => {
    const prisma = fakePrisma([verified('u1', 'a@x.com'), unverified('u2', 'b@x.com')]);

    await notify(prisma, {
      type: 'plan_changed',
      organizationId: 'org-1',
      data: { organizationName: 'IIMB', to: 'Pro' },
    });

    expect(sent[0].recipients.map((r) => r.userId)).toEqual(['u1']);
  });

  it('sends nothing when nobody has a usable address', async () => {
    const prisma = fakePrisma([unverified('u1', 'a@x.com'), { id: 'u2', email: null, email_verified_at: null }]);

    await notify(prisma, { type: 'plan_changed', organizationId: 'org-1', data: { to: 'Pro' } });

    expect(sent).toHaveLength(0);
  });

  it('keys idempotency on the notification, so a replay cannot mail everyone twice', async () => {
    const prisma = fakePrisma([verified('u1', 'a@x.com')]);

    await notify(prisma, { type: 'plan_changed', organizationId: 'org-1', data: { to: 'Pro' } });

    expect(sent[0].idempotencyPrefix).toBe('notif-n1');
  });

  // The feed row is the primary channel and is already written by this point.
  it('never lets a mail failure fail the notification', async () => {
    setNotificationPorts({ mail: { send: async () => { throw new Error('mail service down'); } }, realtime: null });
    const prisma = fakePrisma([verified('u1', 'a@x.com')]);

    await expect(
      notify(prisma, { type: 'plan_changed', organizationId: 'org-1', data: { to: 'Pro' } }),
    ).resolves.toMatchObject({ id: 'n1' });

    expect(prisma.deliveries).toHaveLength(1);
  });

  it('works with no port registered at all', async () => {
    setNotificationPorts(null);
    const prisma = fakePrisma([verified('u1', 'a@x.com')]);

    await expect(
      notify(prisma, { type: 'plan_changed', organizationId: 'org-1', data: { to: 'Pro' } }),
    ).resolves.toMatchObject({ id: 'n1' });
  });

  // Only this layer knows where the web app lives, so the registry deals in paths.
  it('hands the transport a relative path, not an absolute URL', async () => {
    const prisma = fakePrisma([verified('u1', 'a@x.com')]);

    await notify(prisma, {
      type: 'plan_changed',
      organizationId: 'org-1',
      data: { organizationName: 'IIMB', to: 'Pro' },
    });

    expect(sent[0].content.ctaPath).toBe('/organizations/org-1/admin');
    expect(sent[0].content.ctaPath).not.toMatch(/^https?:/);
  });
});
