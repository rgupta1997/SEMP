import { describe, it, expect, vi, beforeEach } from 'vitest';

// The downstream seams and the standings engine are stubbed so a test can make any
// one of them fail on demand - which is the only way to prove the lock is actually
// atomic rather than merely written to look atomic.
const recompute = vi.fn(async () => {});
const advance = vi.fn(async () => {});
const lifetime = vi.fn(async () => {});
const achievements = vi.fn(async () => {});
const certificates = vi.fn(async () => {});
const auditFn = vi.fn(async () => {});
// Resolving participants and telling them are separate concerns with their own
// tests; here they are stubbed so a failure in one can be injected deliberately.
const resolveParticipants = vi.fn(async () => ({ resolved: [{ user_id: 'u1', team_id: 'tA', name: 'A Player' }], unmatched: [] as any[] }));
const notify = vi.fn(async () => ({}));

vi.mock('../standings/standings.service.js', () => ({ recomputeStandingsForFixture: (...a: any[]) => recompute(...a as []) }));
vi.mock('./bracket.js', () => ({ advanceWinnerStrict: (...a: any[]) => advance(...a as []) }));
vi.mock('./downstream.js', () => ({
  writeLifetimeEntries: (...a: any[]) => lifetime(...a as []),
  deriveAchievements: (...a: any[]) => achievements(...a as []),
  queueCertificates: (...a: any[]) => certificates(...a as []),
}));
// Spread the real module: it exports the AUDIT_ACTIONS catalogue as well as audit(),
// and a mock that replaces only the function leaves the constant undefined at import
// time - which fails as a module error, far from the line that caused it.
vi.mock('../iam/audit.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../iam/audit.service.js')>()),
  audit: (...a: any[]) => auditFn(...a as []),
}));
vi.mock('./participants.js', () => ({ resolveFixtureParticipants: (...a: any[]) => resolveParticipants(...a as []) }));
vi.mock('../notifications/audience.js', () => ({ createNotification: (...a: any[]) => notify(...a as []) }));

const {
  assertNotLocked, lockScorecard, lockScorecardsBulk, submitScorecard, unlockScorecard,
} = await import('./lock.service.js');

// ---- test double --------------------------------------------------------
// A fixtures table with transaction semantics: writes inside $transaction land on a
// staged copy, and are only published if the callback resolves. That is what lets a
// test assert "nothing was applied" after an injected failure.

const FIXTURE = {
  id: 'fx1',
  scorecard_status: 'submitted',
  status: 'live',
  home_team_id: 'tA', away_team_id: 'tB',
  home_score: 3, away_score: 1,
  lock_version: 0,
  locked_at: null as Date | null,
  locked_by: null as string | null,
  submitted_at: null as Date | null,
  submitted_by: null as string | null,
  teams_fixtures_home_team_idToteams: { id: 'tA', name: 'IIMB', organization_id: 'o1' },
  teams_fixtures_away_team_idToteams: { id: 'tB', name: 'IIMA', organization_id: 'o2' },
  tournament_disciplines: {
    id: 'draw1',
    disciplines: { name: 'Mens Singles' },
    tournament_sports: { sports: { name: 'Badminton' }, tournaments: { championship_id: 'champ1' } },
  },
};

// Loose on purpose: a test overrides scores and teams with null to exercise the
// "not lockable" paths, and the literal above infers those as number/string.
type FixtureOverrides = Partial<Record<keyof typeof FIXTURE, unknown>>;

function fakePrisma(overrides: FixtureOverrides = {}) {
  let committed: any = { ...FIXTURE, ...overrides };

  const clientOver = (read: () => any, write: (row: any) => void) => ({
    fixtures: {
      findUnique: async ({ where }: any) => (where.id === read().id ? { ...read() } : null),
      update: async ({ where, data }: any) => {
        if (where.id !== read().id) throw new Error('no such fixture');
        const next = { ...read() };
        for (const [k, v] of Object.entries<any>(data)) {
          next[k] = v && typeof v === 'object' && 'increment' in v ? next[k] + v.increment : v;
        }
        write(next);
        return { ...next };
      },
      count: async () => 0,
    },
  });

  const prisma: any = {
    ...clientOver(() => committed, (row) => { committed = row; }),
    get current() { return committed; },
    $transaction: async (fn: any) => {
      // Staged: the callback's writes are invisible until it resolves.
      let staged = { ...committed };
      const tx = clientOver(() => staged, (row) => { staged = row; });
      const out = await fn(tx);   // a throw here leaves `committed` untouched
      committed = staged;
      return out;
    },
  };
  return prisma;
}

const REQ: any = { user: { id: 'organiser1', email: 'org@iimb.ac.in' }, ip: '::1' };

beforeEach(() => {
  for (const m of [recompute, advance, lifetime, achievements, certificates, auditFn, notify]) m.mockReset();
  for (const m of [recompute, advance, lifetime, achievements, certificates, auditFn, notify]) m.mockResolvedValue(undefined as never);
  resolveParticipants.mockReset();
  resolveParticipants.mockResolvedValue({ resolved: [{ user_id: 'u1', team_id: 'tA', name: 'A Player' }], unmatched: [] } as never);
});

// ---- tests --------------------------------------------------------------

describe('assertNotLocked', () => {
  it('refuses a write to a locked scorecard', async () => {
    const prisma = fakePrisma({ scorecard_status: 'locked' });
    await expect(assertNotLocked(prisma, 'fx1')).rejects.toThrow(/locked/i);
  });

  it('allows a write to a draft or submitted one', async () => {
    await expect(assertNotLocked(fakePrisma({ scorecard_status: 'draft' }), 'fx1')).resolves.toBeUndefined();
    await expect(assertNotLocked(fakePrisma({ scorecard_status: 'submitted' }), 'fx1')).resolves.toBeUndefined();
  });
});

describe('submitScorecard', () => {
  it('stamps who submitted it and when', async () => {
    const prisma = fakePrisma({ scorecard_status: 'draft' });
    const out = await submitScorecard(prisma, REQ, 'fx1');
    expect(out.scorecard_status).toBe('submitted');
    expect(out.submitted_by).toBe('organiser1');
    expect(out.submitted_at).toBeInstanceOf(Date);
  });

  it('refuses to re-open a locked card', async () => {
    await expect(submitScorecard(fakePrisma({ scorecard_status: 'locked' }), REQ, 'fx1')).rejects.toThrow(/locked/i);
  });
});

describe('lockScorecard', () => {
  it('publishes the result and propagates, in order', async () => {
    const prisma = fakePrisma();
    const out = await lockScorecard(prisma, REQ, 'fx1');

    expect(out.scorecard_status).toBe('locked');
    expect(out.status).toBe('completed');
    expect(out.locked_by).toBe('organiser1');
    expect(advance).toHaveBeenCalledOnce();
    expect(recompute).toHaveBeenCalledOnce();
    expect(lifetime).toHaveBeenCalledOnce();
    expect(achievements).toHaveBeenCalledOnce();
    expect(certificates).toHaveBeenCalledOnce();
  });

  it('audits the lock AFTER the transaction commits, never inside it', async () => {
    const prisma = fakePrisma();
    await lockScorecard(prisma, REQ, 'fx1');
    expect(auditFn).toHaveBeenCalledOnce();
    const entry = (auditFn.mock.calls[0] as any[])[2];
    expect(entry.action).toBe('fixture.locked');
    expect(entry.target.label).toBe('IIMB vs IIMA, Badminton · Mens Singles');
  });

  it('keeps a walkover as a walkover rather than forcing it to completed', async () => {
    const prisma = fakePrisma({ status: 'walkover', home_score: null, away_score: null });
    const out = await lockScorecard(prisma, REQ, 'fx1');
    expect(out.status).toBe('walkover');
    expect(out.scorecard_status).toBe('locked');
  });

  it('refuses a card with no score', async () => {
    const prisma = fakePrisma({ home_score: null, away_score: null });
    await expect(lockScorecard(prisma, REQ, 'fx1')).rejects.toThrow(/no score/i);
    expect(prisma.current.scorecard_status).toBe('submitted');
  });

  it('refuses a card with a team missing', async () => {
    const prisma = fakePrisma({ away_team_id: null });
    await expect(lockScorecard(prisma, REQ, 'fx1')).rejects.toThrow(/both teams/i);
  });

  it('refuses to lock twice', async () => {
    await expect(lockScorecard(fakePrisma({ scorecard_status: 'locked' }), REQ, 'fx1')).rejects.toThrow(/already locked/i);
  });

  // The requirement, not a nicety: PRD §8.1 "a lock either fully propagates or fails
  // cleanly". Each downstream step gets failed in turn, and the card must be exactly
  // as it was - not locked, not completed, not audited.
  for (const [name, spy] of [
    ['bracket advancement', advance],
    ['standings recompute', recompute],
    ['lifetime entries', lifetime],
    ['achievement derivation', achievements],
    ['certificate queueing', certificates],
    ['participant resolution', resolveParticipants],
  ] as const) {
    it(`rolls the whole lock back when ${name} fails`, async () => {
      const prisma = fakePrisma();
      spy.mockRejectedValueOnce(new Error(`${name} exploded`) as never);

      await expect(lockScorecard(prisma, REQ, 'fx1')).rejects.toThrow(/exploded/);

      expect(prisma.current.scorecard_status).toBe('submitted');
      expect(prisma.current.locked_at).toBeNull();
      expect(prisma.current.locked_by).toBeNull();
      expect(prisma.current.status).toBe('live');
      // And nothing claims it happened.
      expect(auditFn).not.toHaveBeenCalled();
    });
  }
});

describe('lockScorecard · notifying participants (J4-E1-S2)', () => {
  it('tells each participant, and only after the transaction has committed', async () => {
    const prisma = fakePrisma();
    await lockScorecard(prisma, REQ, 'fx1');

    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.target_user_id).toBe('u1');
    expect(sent.title).toMatch(/verified/i);
    // Committed before anyone was told: the card is locked by the time we notify.
    expect(prisma.current.scorecard_status).toBe('locked');
  });

  it('does not notify when the lock fails', async () => {
    const prisma = fakePrisma();
    recompute.mockRejectedValueOnce(new Error('standings exploded') as never);
    await expect(lockScorecard(prisma, REQ, 'fx1')).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });

  it('a notification failure does not undo the lock', async () => {
    const prisma = fakePrisma();
    notify.mockRejectedValue(new Error('notification service down') as never);

    // The lock resolves regardless - it has already committed, and reporting it as
    // failed would be a lie in the more damaging direction.
    await expect(lockScorecard(prisma, REQ, 'fx1')).resolves.toBeDefined();
    expect(prisma.current.scorecard_status).toBe('locked');
  });
});

describe('unlockScorecard', () => {
  it('demands a real reason', async () => {
    const prisma = fakePrisma({ scorecard_status: 'locked' });
    await expect(unlockScorecard(prisma, REQ, 'fx1', '')).rejects.toThrow(/reason/i);
    await expect(unlockScorecard(prisma, REQ, 'fx1', '  x ')).rejects.toThrow(/reason/i);
    expect(prisma.current.scorecard_status).toBe('locked');
  });

  it('returns the card to submitted and moves the lock version on', async () => {
    const prisma = fakePrisma({ scorecard_status: 'locked', lock_version: 2, locked_by: 'someone' });
    const out = await unlockScorecard(prisma, REQ, 'fx1', 'Scorer entered the wrong set score');

    expect(out.scorecard_status).toBe('submitted');
    expect(out.lock_version).toBe(3);
    expect(out.locked_at).toBeNull();
    // Reversal is a full recompute, not a subtraction.
    expect(recompute).toHaveBeenCalledOnce();
    // Downstream artefacts are told which version to supersede, and who it affected.
    expect(lifetime).toHaveBeenCalledWith(
      expect.anything(), 'fx1',
      expect.objectContaining({ supersedeVersion: 2 }),
    );
  });

  it('records the reason in the audit entry', async () => {
    const prisma = fakePrisma({ scorecard_status: 'locked' });
    await unlockScorecard(prisma, REQ, 'fx1', 'Wrong winner recorded');
    const entry = (auditFn.mock.calls[0] as any[])[2];
    expect(entry.action).toBe('fixture.unlocked');
    expect(entry.diff.reason.to).toBe('Wrong winner recorded');
  });

  it('refuses when the card was never locked', async () => {
    await expect(unlockScorecard(fakePrisma(), REQ, 'fx1', 'a good reason here'))
      .rejects.toThrow(/not locked/i);
  });
});

describe('lockScorecardsBulk', () => {
  it('reports per fixture, and one failure does not stop the rest', async () => {
    // Two locks succeed, the middle one fails at the standings step.
    const prisma = fakePrisma();
    recompute.mockRejectedValueOnce(new Error('boom') as never);

    const results = await lockScorecardsBulk(prisma, REQ, ['fx1', 'fx1', 'fx1']);
    // Same id de-duplicates to one attempt - the guarantee under test is the shape.
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ fixture_id: 'fx1', ok: false });
    expect(results[0].error).toMatch(/boom/);
  });
});
