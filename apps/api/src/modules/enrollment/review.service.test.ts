import { describe, it, expect, vi, beforeEach } from 'vitest';

// The audit trail and the notification feed are stubbed: what matters here is that a
// decision writes exactly one audit line, tells the right audiences, and that a
// failure on one enrolment leaves the rest of a batch alone.
const auditFn = vi.fn(async () => {});
const notify = vi.fn(async () => ({}));

vi.mock('../iam/audit.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../iam/audit.service.js')>()),
  audit: (...a: any[]) => auditFn(...a as []),
}));
vi.mock('../notifications/audience.js', () => ({ createNotification: (...a: any[]) => notify(...a as []) }));

const { memoizedAuthorizer, reviewEnrollment, reviewEnrollmentsBulk } = await import('./review.service.js');

// ---- test double --------------------------------------------------------

const ENROLLMENT = {
  id: 'e1',
  championship_id: 'champ1',
  organization_id: 'org1',
  status: 'pending',
  rejection_note: null as string | null,
  reviewed_by: null as string | null,
  reviewed_at: null as Date | null,
  organizations: { name: 'IIM Bangalore', short_name: 'IIMB' },
  championships: { name: 'Inter-Programme Meet' },
};

type Overrides = Partial<Record<keyof typeof ENROLLMENT, unknown>>;

// Rows keyed by id so a bulk test can hold several, one of which is missing.
function fakePrisma(rows: Overrides[] = [{}]) {
  const table = new Map<string, any>();
  rows.forEach((o, i) => {
    const id = `e${i + 1}`;
    table.set(id, { ...ENROLLMENT, ...o, id });
  });

  const client = {
    championship_organizations: {
      findUnique: async ({ where }: any) => {
        const row = table.get(where.id);
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: any) => {
        const row = table.get(where.id);
        if (!row) throw new Error('no such enrollment');
        const next = { ...row, ...data };
        table.set(where.id, next);
        return { ...next };
      },
    },
  };

  return {
    ...client,
    get rows() { return table; },
    $transaction: async (fn: any) => fn(client),
  } as any;
}

const REQ: any = { user: { id: 'organiser1', email: 'org@iimb.ac.in' }, ip: '::1' };

beforeEach(() => {
  auditFn.mockReset();
  notify.mockReset();
  auditFn.mockResolvedValue(undefined as never);
  notify.mockResolvedValue({} as never);
});

// ---- tests --------------------------------------------------------------

describe('reviewEnrollment · approval', () => {
  it('stamps the reviewer and the time', async () => {
    const prisma = fakePrisma();
    const out = await reviewEnrollment(prisma, REQ, 'e1', { status: 'approved' });

    expect(out.status).toBe('approved');
    expect(out.reviewed_by).toBe('organiser1');
    expect(out.reviewed_at).toBeInstanceOf(Date);
    expect(out.rejection_note).toBeNull();
  });

  it('tells the applicant and announces the arrival to the championship', async () => {
    await reviewEnrollment(fakePrisma(), REQ, 'e1', { status: 'approved' });

    expect(notify).toHaveBeenCalledTimes(2);
    const applicant = (notify.mock.calls[0] as any[])[1];
    expect(applicant.audience).toBe('org_admins');
    expect(applicant.organization_id).toBe('org1');
    const announcement = (notify.mock.calls[1] as any[])[1];
    expect(announcement.audience).toBe('all');
    expect(announcement.championship_id).toBe('champ1');
  });

  it('audits the decision with the before and after status', async () => {
    await reviewEnrollment(fakePrisma(), REQ, 'e1', { status: 'approved' });

    expect(auditFn).toHaveBeenCalledOnce();
    const entry = (auditFn.mock.calls[0] as any[])[2];
    expect(entry.action).toBe('registration.approved');
    expect(entry.diff.status).toEqual({ from: 'pending', to: 'approved' });
    expect(entry.target.label).toBe('IIM Bangalore in Inter-Programme Meet');
  });

  it('does not announce a decision that changes nothing', async () => {
    await reviewEnrollment(fakePrisma([{ status: 'approved' }]), REQ, 'e1', { status: 'approved' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('404s on an enrolment that does not exist', async () => {
    await expect(reviewEnrollment(fakePrisma(), REQ, 'nope', { status: 'approved' })).rejects.toThrow(/not found/i);
  });
});

describe('reviewEnrollment · rejection', () => {
  it('demands a note, and writes nothing without one', async () => {
    const prisma = fakePrisma();
    await expect(reviewEnrollment(prisma, REQ, 'e1', { status: 'rejected' })).rejects.toThrow(/reason/i);
    await expect(reviewEnrollment(prisma, REQ, 'e1', { status: 'rejected', rejection_note: '  no ' })).rejects.toThrow(/reason/i);
    expect(prisma.rows.get('e1').status).toBe('pending');
    expect(auditFn).not.toHaveBeenCalled();
  });

  it('stores the trimmed note and puts it in front of the applicant', async () => {
    const prisma = fakePrisma();
    const out = await reviewEnrollment(prisma, REQ, 'e1', { status: 'rejected', rejection_note: '  Entries had already closed  ' });

    expect(out.status).toBe('rejected');
    expect(out.rejection_note).toBe('Entries had already closed');
    // Only the applicant hears about a decline - it is not championship news.
    expect(notify).toHaveBeenCalledOnce();
    const applicant = (notify.mock.calls[0] as any[])[1];
    expect(applicant.audience).toBe('org_admins');
    expect(applicant.body).toContain('Entries had already closed');
  });
});

describe('reviewEnrollment · authority', () => {
  it('refuses an enrolment in a championship the caller does not manage', async () => {
    const prisma = fakePrisma();
    await expect(
      reviewEnrollment(prisma, REQ, 'e1', { status: 'approved' }, async () => false),
    ).rejects.toThrow(/do not manage/i);
    expect(prisma.rows.get('e1').status).toBe('pending');
  });
});

describe('reviewEnrollmentsBulk', () => {
  it('reports per enrolment, and one failure does not stop the rest', async () => {
    const prisma = fakePrisma([{}, {}, {}]);
    const results = await reviewEnrollmentsBulk(prisma, REQ, ['e1', 'missing', 'e3'], { status: 'approved' });

    expect(results).toEqual([
      { enrollment_id: 'e1', ok: true },
      { enrollment_id: 'missing', ok: false, error: expect.stringMatching(/not found/i) },
      { enrollment_id: 'e3', ok: true },
    ]);
    expect(prisma.rows.get('e1').status).toBe('approved');
    expect(prisma.rows.get('e3').status).toBe('approved');
  });

  it('de-duplicates ids so a doubled selection is decided once', async () => {
    const results = await reviewEnrollmentsBulk(fakePrisma(), REQ, ['e1', 'e1'], { status: 'approved' });
    expect(results).toHaveLength(1);
  });

  it('rejects the whole batch when the note is missing, before touching any row', async () => {
    const prisma = fakePrisma([{}, {}]);
    await expect(reviewEnrollmentsBulk(prisma, REQ, ['e1', 'e2'], { status: 'rejected' })).rejects.toThrow(/reason/i);
    expect(prisma.rows.get('e1').status).toBe('pending');
    expect(prisma.rows.get('e2').status).toBe('pending');
  });

  it('turns an unauthorized enrolment into a per-item failure, not a dead batch', async () => {
    const prisma = fakePrisma([{ championship_id: 'champ1' }, { championship_id: 'champ2' }]);
    const authorize = async (id: string) => id === 'champ1';

    const results = await reviewEnrollmentsBulk(prisma, REQ, ['e1', 'e2'], { status: 'approved' }, authorize);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: expect.stringMatching(/do not manage/i) });
  });
});

describe('memoizedAuthorizer', () => {
  it('asks once per championship however many enrolments share it', async () => {
    const check = vi.fn(async () => true);
    const authorize = memoizedAuthorizer(check);

    const prisma = fakePrisma([{}, {}, { championship_id: 'champ2' }]);
    await reviewEnrollmentsBulk(prisma, REQ, ['e1', 'e2', 'e3'], { status: 'approved' }, authorize);

    expect(check).toHaveBeenCalledTimes(2);
  });
});
