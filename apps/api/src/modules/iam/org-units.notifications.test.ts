import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyUnitCreated, notifyUnitAdminAssigned } = await import('./org-units.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

function callOfType(type: string) {
  return notify.mock.calls.find((c: any[]) => c[1]?.type === type)?.[1] as any;
}

describe('notifyUnitCreated', () => {
  it('fires campus_created for a campus', async () => {
    await notifyUnitCreated({} as any, 'org1', { id: 'u1', name: 'Bangalore Campus', type: 'campus' }, 'Acme', 'Campus', 'actor1');
    const sent = callOfType('campus_created');
    expect(sent).toBeDefined();
    expect(sent).toMatchObject({ organizationId: 'org1', senderId: 'actor1' });
    expect(sent.data).toMatchObject({ unitLabel: 'Campus', unitName: 'Bangalore Campus', organizationName: 'Acme' });
  });

  it('does not fire for a department', async () => {
    await notifyUnitCreated({} as any, 'org1', { id: 'u1', name: 'Sales', type: 'department' }, 'Acme', 'Campus', 'actor1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('falls back to a generic organization name when none is on record', async () => {
    await notifyUnitCreated({} as any, 'org1', { id: 'u1', name: 'Campus A', type: 'campus' }, undefined, 'Campus', 'actor1');
    expect(callOfType('campus_created').data.organizationName).toBe('your organization');
  });
});

describe('notifyUnitAdminAssigned', () => {
  const UNIT = { id: 'u1', name: 'Bangalore Campus', type: 'campus' };

  it('fires when a new admin is named on creation (no previous admin)', async () => {
    await notifyUnitAdminAssigned({} as any, UNIT, 'admin1', null, 'Acme', 'Campus', 'actor1');
    const sent = callOfType('campus_admin_assigned');
    expect(sent).toBeDefined();
    expect(sent.userId).toBe('admin1');
  });

  it('fires when the admin actually changes on a PATCH', async () => {
    await notifyUnitAdminAssigned({} as any, UNIT, 'new-admin', 'old-admin', 'Acme', 'Campus', 'actor1');
    expect(callOfType('campus_admin_assigned').userId).toBe('new-admin');
  });

  it('does not fire when the admin is unchanged', async () => {
    await notifyUnitAdminAssigned({} as any, UNIT, 'same-admin', 'same-admin', 'Acme', 'Campus', 'actor1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not fire when the admin is being cleared (set to null)', async () => {
    await notifyUnitAdminAssigned({} as any, UNIT, null, 'old-admin', 'Acme', 'Campus', 'actor1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not fire on creation with no admin at all', async () => {
    await notifyUnitAdminAssigned({} as any, UNIT, undefined, null, 'Acme', 'Campus', 'actor1');
    expect(notify).not.toHaveBeenCalled();
  });
});
