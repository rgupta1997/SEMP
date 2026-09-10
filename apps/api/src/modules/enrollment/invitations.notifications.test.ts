import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyInvitationSent } = await import('./invitations.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

function fakePrisma(seed: { championshipName?: string; hostName?: string; hostShortName?: string } = {}) {
  return {
    championships: {
      findUnique: async () => ({ name: seed.championshipName ?? 'State Championship', host_organization_id: 'host1' }),
    },
    organizations: {
      findUnique: async () => ({ name: seed.hostName ?? 'Indian Institute of Management Bangalore', short_name: seed.hostShortName ?? 'IIMB' }),
    },
  } as any;
}

describe('notifyInvitationSent', () => {
  it('notifies the invited org\'s admins with the championship and host names', async () => {
    await notifyInvitationSent(fakePrisma(), 'champ1', 'org1', 'actor1');

    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent).toMatchObject({
      type: 'championship_invitation_sent',
      organizationId: 'org1',
      championshipId: 'champ1',
      senderId: 'actor1',
      data: { championshipName: 'State Championship', hostName: 'IIMB' },
    });
  });

  it('falls back to the host\'s full name when it has no short name', async () => {
    await notifyInvitationSent(fakePrisma({ hostShortName: '' }), 'champ1', 'org1', 'actor1');
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.data.hostName).toBe('Indian Institute of Management Bangalore');
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyInvitationSent(fakePrisma(), 'champ1', 'org1', 'actor1')).resolves.toBeUndefined();
  });
});
