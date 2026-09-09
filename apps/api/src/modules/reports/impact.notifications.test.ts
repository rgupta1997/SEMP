import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyReportGenerated } = await import('./impact.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

describe('notifyReportGenerated', () => {
  it('tells the requester their report is ready', async () => {
    await notifyReportGenerated({} as any, 'job1', 'user1', '2025-26', 'org1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent).toMatchObject({
      type: 'event_report_generated', organizationId: 'org1', userId: 'user1', senderId: null,
      data: { label: 'Sports Impact', seasonLabel: '2025-26' },
    });
  });

  it('does nothing when the job has no requester on record', async () => {
    await notifyReportGenerated({} as any, 'job1', null, '2025-26', 'org1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyReportGenerated({} as any, 'job1', 'user1', '2025-26', 'org1')).resolves.toBeUndefined();
  });
});
