import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyUsageLimitReached } = await import('./error.notifications.js');

// notifyUsageLimitReached is fire-and-forget (void, not async) - it kicks off
// notify() without awaiting it, matching errorHandler's own synchronous Express
// signature. Flushing the microtask queue is how a test observes what its
// un-awaited .catch()/.then() chain did.
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

describe('notifyUsageLimitReached', () => {
  it('notifies the org with the limit-error message', async () => {
    notifyUsageLimitReached({} as any, { organizationId: 'org1', message: 'You have reached your plan limit for teams (10/10).' });
    await flush();

    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent).toMatchObject({
      type: 'usage_limit_reached',
      organizationId: 'org1',
      senderId: null,
      data: { message: 'You have reached your plan limit for teams (10/10).' },
    });
  });

  it('does nothing when the error has no organizationId (the personal ladder)', async () => {
    notifyUsageLimitReached({} as any, { organizationId: undefined, message: 'x' });
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not throw when notify() rejects - fire-and-forget must not surface a failure', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => notifyUsageLimitReached({} as any, { organizationId: 'org1', message: 'x' })).not.toThrow();
    await flush();

    expect(errorSpy).toHaveBeenCalledWith('[billing] usage_limit_reached notification failed:', expect.any(Error));
    errorSpy.mockRestore();
  });
});
