import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyCertificateGenerated, notifyCertificateRevoked } = await import('./certificates.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

describe('notifyCertificateGenerated', () => {
  it('notifies the recipient when the certificate has a linked account', async () => {
    await notifyCertificateGenerated({} as any, 'cert1', 'user1', 'Champion 2026', 'issuer1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent).toMatchObject({ type: 'certificate_generated', userId: 'user1', senderId: 'issuer1', data: { title: 'Champion 2026' } });
  });

  it('does nothing when the certificate has no linked account', async () => {
    await notifyCertificateGenerated({} as any, 'cert1', null, 'Champion 2026', 'issuer1');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('notifyCertificateRevoked', () => {
  it('notifies the holder with the reason when there is a linked account', async () => {
    await notifyCertificateRevoked({} as any, 'cert1', 'user1', 'champ1', 'Champion 2026', 'SPT-001', 'Duplicate issue', 'issuer1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent).toMatchObject({
      type: 'certificate_validation_issue', championshipId: 'champ1', userId: 'user1',
      data: { title: 'Champion 2026', serial: 'SPT-001', reason: 'Duplicate issue' },
    });
  });

  it('does nothing when the certificate has no linked account', async () => {
    await notifyCertificateRevoked({} as any, 'cert1', null, 'champ1', 'x', 'y', 'reason', 'issuer1');
    expect(notify).not.toHaveBeenCalled();
  });
});
