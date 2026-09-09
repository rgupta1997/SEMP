import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyApplicationReceived, notifyEnrollmentApproved, notifyRegistrationRejected } = await import('./enrollment.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

function callsOfType(type: string) {
  return notify.mock.calls.filter((c: any[]) => c[1]?.type === type).map((c: any[]) => c[1]);
}

describe('notifyApplicationReceived', () => {
  it('confirms the applicant AND pings the organiser queue', async () => {
    await notifyApplicationReceived({} as any, 'champ1', 'State Championship', 'user1', 'IIMB', 'user1');

    const submitted = callsOfType('registration_submitted');
    expect(submitted).toEqual([expect.objectContaining({ championshipId: 'champ1', userId: 'user1' })]);

    const pending = callsOfType('participant_approval_pending');
    expect(pending).toEqual([expect.objectContaining({ championshipId: 'champ1', data: { orgName: 'IIMB', championshipName: 'State Championship' } })]);
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyApplicationReceived({} as any, 'champ1', 'x', 'user1', 'IIMB', 'user1')).resolves.toBeUndefined();
  });
});

describe('notifyEnrollmentApproved', () => {
  const ENROLLMENT = {
    id: 'enr1', championship_id: 'champ1', organization_id: 'org1',
    organizations: { name: 'Indian Institute of Management Bangalore', short_name: 'IIMB' },
    championships: { name: 'State Championship' },
  };

  it('broadcasts to the room AND confirms directly to the applicant', async () => {
    await notifyEnrollmentApproved({} as any, ENROLLMENT, 'actor1');

    const broadcast = callsOfType('enrollment_approved');
    expect(broadcast).toEqual([expect.objectContaining({
      championshipId: 'champ1',
      data: { orgName: 'IIMB', bodyOrgName: 'Indian Institute of Management Bangalore', championshipName: 'State Championship' },
    })]);

    const direct = callsOfType('registration_approved');
    expect(direct).toEqual([expect.objectContaining({ organizationId: 'org1', data: { championshipName: 'State Championship' } })]);
  });

  // The gap this guards: enrollment_approved used to have no try/catch of its own -
  // a failure there would abort the whole request AND skip registration_approved
  // entirely. Each must be independent.
  it('the broadcast failing does not prevent the direct confirmation from firing', async () => {
    notify.mockRejectedValueOnce(new Error('broadcast down') as never);
    await notifyEnrollmentApproved({} as any, ENROLLMENT, 'actor1');
    expect(callsOfType('registration_approved')).toHaveLength(1);
  });

  it('the direct confirmation failing does not undo the broadcast having fired', async () => {
    notify.mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('direct down') as never);
    await expect(notifyEnrollmentApproved({} as any, ENROLLMENT, 'actor1')).resolves.toBeUndefined();
    expect(callsOfType('enrollment_approved')).toHaveLength(1);
  });

  it('falls back to a generic org name when neither name nor short_name is set', async () => {
    await notifyEnrollmentApproved({} as any, { ...ENROLLMENT, organizations: { name: null, short_name: null } }, 'actor1');
    expect(callsOfType('enrollment_approved')[0].data.orgName).toBe('An organization');
  });
});

describe('notifyRegistrationRejected', () => {
  it('sends the reason to the applicant org', async () => {
    await notifyRegistrationRejected({} as any, 'org1', 'State Championship', 'Squad list incomplete', 'enr1', 'actor1');
    const sent = callsOfType('registration_rejected');
    expect(sent).toEqual([expect.objectContaining({
      organizationId: 'org1',
      data: { reason: 'Squad list incomplete', championshipName: 'State Championship' },
    })]);
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyRegistrationRejected({} as any, 'org1', 'x', null, 'enr1', 'actor1')).resolves.toBeUndefined();
  });
});
