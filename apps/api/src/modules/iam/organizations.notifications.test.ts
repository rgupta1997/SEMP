import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const {
  notifyOrganizationCreated, notifyJoinRequested, notifyJoinApproved, notifyJoinDeclined,
  newlyAddedMembers, notifyNewOrgMembers,
} = await import('./organizations.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

function callOfType(type: string) {
  return notify.mock.calls.find((c: any[]) => c[1]?.type === type)?.[1] as any;
}

describe('one-shot notifiers', () => {
  it('notifyOrganizationCreated', async () => {
    await notifyOrganizationCreated({} as any, 'org1', 'Acme', 'actor1');
    expect(callOfType('organization_created')).toMatchObject({ userId: 'actor1', senderId: 'actor1', data: { organizationName: 'Acme' } });
  });

  it('notifyJoinRequested', async () => {
    await notifyJoinRequested({} as any, 'org1', 'Acme', 'user1', 'Priya');
    expect(callOfType('org_join_request')).toMatchObject({ organizationId: 'org1', senderId: 'user1', data: { who: 'Priya', organizationName: 'Acme' } });
  });

  it('notifyJoinApproved', async () => {
    await notifyJoinApproved({} as any, 'user1', 'Acme', 'actor1');
    expect(callOfType('org_join_approved')).toMatchObject({ userId: 'user1', senderId: 'actor1', data: { organizationName: 'Acme' } });
  });

  it('notifyJoinDeclined', async () => {
    await notifyJoinDeclined({} as any, 'user1', 'Acme', 'actor1');
    expect(callOfType('org_join_declined')).toMatchObject({ userId: 'user1', senderId: 'actor1', data: { organizationName: 'Acme' } });
  });

  // These three used to call notify() with no try/catch at all, so a notification
  // hiccup failed the entire approve/decline/join-request request with a 500 -
  // every other notification in the codebase is best-effort. Pinned here so that
  // stays true.
  it.each([
    ['notifyJoinRequested', () => notifyJoinRequested({} as any, 'org1', 'Acme', 'user1', 'Priya')],
    ['notifyJoinApproved', () => notifyJoinApproved({} as any, 'user1', 'Acme', 'actor1')],
    ['notifyJoinDeclined', () => notifyJoinDeclined({} as any, 'user1', 'Acme', 'actor1')],
  ])('%s swallows a notify() failure rather than throwing', async (_name, run) => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(run()).resolves.toBeUndefined();
  });
});

describe('newlyAddedMembers', () => {
  it('excludes ids that are already active members of the org', async () => {
    const prisma = {
      organization_members: {
        findMany: async () => [{ user_id: 'priya' }],
      },
    } as any;
    const result = await newlyAddedMembers(prisma, 'org1', ['priya', 'newguy']);
    expect(result).toEqual(['newguy']);
  });
});

describe('notifyNewOrgMembers', () => {
  function fakePrisma(orgName = 'Acme') {
    return { organizations: { findUnique: async () => ({ name: orgName }) } } as any;
  }

  it('does nothing when there is nobody newly added', async () => {
    await notifyNewOrgMembers(fakePrisma(), 'org1', [], 'actor1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies each newly-added member with the organization name', async () => {
    await notifyNewOrgMembers(fakePrisma(), 'org1', ['u1', 'u2'], 'actor1');
    const calls = notify.mock.calls.map((c: any[]) => c[1]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c: any) => c.type === 'org_member_added' && c.data.organizationName === 'Acme')).toBe(true);
  });

  // The exact regression this guards: one recipient's notify() throwing must not
  // swallow every notification queued after it in the same batch.
  it('one recipient failing does not block the rest of the batch', async () => {
    notify
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('down') as never)
      .mockResolvedValueOnce({} as never);

    await notifyNewOrgMembers(fakePrisma(), 'org1', ['u1', 'u2', 'u3'], 'actor1');

    const recipients = notify.mock.calls.map((c: any[]) => c[1].userId);
    expect(recipients).toEqual(['u1', 'u2', 'u3']);
  });
});
