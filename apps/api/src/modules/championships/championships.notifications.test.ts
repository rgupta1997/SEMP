import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Rules } from '@semp/notifications/core/rules.js';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyStatusChanged, notifyChampionshipPublished } = await import('./championships.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

describe('notifyStatusChanged', () => {
  it('fires event_lifecycle with the default (poc/captain) audience', async () => {
    await notifyStatusChanged({} as any, 'champ1', 'registration_open', 'actor1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.type).toBe('event_lifecycle');
    expect(sent.championshipId).toBe('champ1');
    expect(sent.data.status).toBe('registration_open');
    // No explicit audience override here - unlike notifyChampionshipPublished,
    // this leaves the registry's own default (poc + captain) to resolve it.
    expect(sent.audience).toBeUndefined();
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyStatusChanged({} as any, 'champ1', 'ongoing', 'actor1')).resolves.toBeUndefined();
  });
});

describe('notifyChampionshipPublished', () => {
  it('fires event_lifecycle to the organiser only, not the default audience', async () => {
    await notifyChampionshipPublished({} as any, 'champ1', 'actor1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.type).toBe('event_lifecycle');
    expect(sent.data.visibility).toBe('public');
    expect(sent.audience).toEqual(Rules.role('organiser', 'champ1'));
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyChampionshipPublished({} as any, 'champ1', 'actor1')).resolves.toBeUndefined();
  });
});
