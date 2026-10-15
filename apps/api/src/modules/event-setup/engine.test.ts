import { describe, expect, it } from 'vitest';
import type { SetupMatchRowSpec } from '@semp/shared';
import {
  CLEANUP_ORDER, CleanupRefusedError, buildDrawScoringFormat, cleanupBlueprint, createdCount, emptyManifest,
  firstFree, generatedFixturesOf, knockoutFixturesOf, normaliseManifest, orgCodeOf, platformPlanOf,
  provisionalLogin, slugOf, storableCredential, tableOfKey, type Manifest, type ManifestStore, type Resolution,
} from './engine.js';

// The pure half of the engine. The database half (resolvePlatform / applyBlueprint)
// is exercised end to end against a real database - a unit test with a hand-mocked
// Prisma would only prove the mock.

describe('manifest keys', () => {
  it('maps every key the WNS build wrote to its table', () => {
    // The prefixes in out/wns-football-2026.manifest.json - a `run.ts wns plan`
    // finds everything only if every one still resolves.
    expect(tableOfKey('org')).toBe('organizations');
    expect(tableOfKey('campus')).toBe('org_units');
    expect(tableOfKey('unit:s12')).toBe('org_units');
    expect(tableOfKey('person:aarav shah')).toBe('users');
    expect(tableOfKey('staff:ref1')).toBe('users');
    expect(tableOfKey('championship')).toBe('championships');
    expect(tableOfKey('venue')).toBe('venues');
    expect(tableOfKey('ground:turf1')).toBe('venue_grounds');
    expect(tableOfKey('draw:football')).toBe('tournament_disciplines');
    expect(tableOfKey('team:s12')).toBe('teams');
  });

  it('maps an inter competitor to organizations and refuses anything unknown', () => {
    expect(tableOfKey('competitor:c1')).toBe('organizations');
    expect(tableOfKey('users')).toBeNull();
    expect(tableOfKey('pg_catalog:x')).toBeNull();
  });

  it('reads the column default {} as an empty manifest, without aliasing the input', () => {
    expect(normaliseManifest({})).toEqual(emptyManifest());
    expect(normaliseManifest(null)).toEqual(emptyManifest());
    const raw = { keys: { org: 'a' }, created: { users: ['u1'] }, runs: [{ at: 't', mode: 'apply' }] };
    const m = normaliseManifest(raw);
    m.created.users.push('u2');
    expect(raw.created.users).toEqual(['u1']);
    expect(createdCount(m)).toBe(2);
  });
});

describe('names and codes', () => {
  it('takes the first free code, case-insensitively', () => {
    expect(firstFree('WNS', [])).toBe('WNS');
    expect(firstFree('WNS', ['wns'])).toBe('WNS-2');
    expect(firstFree('WNS', ['WNS', 'WNS-2'])).toBe('WNS-3');
  });

  it('derives an org code from its name or the sheet code', () => {
    expect(orgCodeOf('Beta Industries')).toBe('BI');
    expect(orgCodeOf('Acme')).toBe('ACME');
    expect(orgCodeOf('Beta Industries', ' bx 1 ')).toBe('BX1');
  });

  it('slugs a championship name', () => {
    expect(slugOf('WNS Football Championship 2026')).toBe('wns-football-championship-2026');
    expect(slugOf('***')).toBe('event');
  });
});

describe('buildDrawScoringFormat', () => {
  const draw = { key: 'football', sport: 'Football' };

  it('sets the WHOLE match on the clock and builds the tie-break from the sheet', () => {
    const r = buildDrawScoringFormat('wns-football-2026', {
      ...draw, scoring: { presetKey: 'fest_2x10_ko', name: 'WNS Football', matchMinutes: 20, extraTimeMinutes: 5, penaltyKicks: 5 },
    });
    if ('error' in r) throw new Error(r.error);
    const f = r.format as any;
    expect(f.presetKey).toBe('wns-football-2026_football');
    expect(f.name).toBe('WNS Football');
    expect(f.clock.minutes).toBe(20);
    expect(f.tieBreak).toEqual({ extraTime: { periods: 1, minutes: 5 }, penalties: { kicks: 5 } });
    expect(f.rulesSheet.duration).toBe('2 periods of 10 minutes');
  });

  it('reads blank extra time and penalties as none, and keeps the preset clock without match minutes', () => {
    const r = buildDrawScoringFormat('k', { ...draw, scoring: { presetKey: 'fest_2x10_ko', name: 'Plain' } });
    if ('error' in r) throw new Error(r.error);
    expect((r.format as any).tieBreak).toBeNull();
    expect((r.format as any).clock.minutes).toBe(20);
  });

  it('refuses an unknown preset and a preset for another sport', () => {
    expect(buildDrawScoringFormat('k', { ...draw, scoring: { presetKey: 'nope', name: 'x' } })).toMatchObject({ code: 'unknown_preset' });
    expect(buildDrawScoringFormat('k', { key: 'b', sport: 'Badminton', scoring: { presetKey: 'fest_2x10_ko', name: 'x' } }))
      .toMatchObject({ code: 'preset_sport_mismatch' });
  });
});

describe('logins', () => {
  it('gives a real mobile the product pattern', () => {
    expect(provisionalLogin('Asha Rao', '9876500042', undefined)).toEqual({ contact: 'real mobile', password: 'asha@0042' });
  });

  it('gives an email-only or placeholder account a random password, never the shared default', () => {
    const a = provisionalLogin('Asha Rao', undefined, 'asha@corp.com');
    const b = provisionalLogin('Asha Rao', undefined, undefined);
    expect(a.contact).toBe('real email');
    expect(b.contact).toBe('placeholder');
    for (const p of [a.password, b.password]) {
      expect(p).not.toBe('demo123');
      expect(p.length).toBeGreaterThanOrEqual(12);
    }
    expect(a.password).not.toBe(b.password);
  });

  it('never stores a placeholder password', () => {
    const base = { name: 'X', role: 'player', phone: '5000000001', email: 'x@placeholder.invalid', password: 'secret' };
    expect(storableCredential({ ...base, contact: 'placeholder' }).password).toBeNull();
    expect(storableCredential({ ...base, contact: 'real mobile' }).password).toBe('secret');
  });
});

describe('fixtures without a database', () => {
  const row = (matchId: string, home: SetupMatchRowSpec['home'], away: SetupMatchRowSpec['away']): SetupMatchRowSpec =>
    ({ matchId, date: '2026-10-17', kickoff: '09:00', minutes: 20, groundKey: 'g1', home, away });

  it('reads a sheet bracket with a bye into the product generator', () => {
    // A, B play; C has a bye into the final.
    const rows = [row('M1', { squadKey: 'A' }, { squadKey: 'B' }), row('F', { winnerOf: 'M1' }, { squadKey: 'C' })];
    const { layout, gen, realCount } = knockoutFixturesOf({ kind: 'knockout-rows', drawKey: 'd', utcOffset: '+05:30', rows }, false);
    expect(layout.rounds).toBe(2);
    expect(realCount).toBe(2);
    expect(gen.filter((g) => g.status === 'bye')).toHaveLength(1);
  });

  it('refuses a sheet whose match count disagrees with the tree', () => {
    const rows = [row('M1', { squadKey: 'A' }, { squadKey: 'B' }), row('M2', { squadKey: 'C' }, { squadKey: 'D' })];
    expect(() => knockoutFixturesOf({ kind: 'knockout-rows', drawKey: 'd', utcOffset: '+05:30', rows }, false)).toThrow(/final/i);
  });

  it('generates a league over the squads in sheet order', () => {
    const gen = generatedFixturesOf('League', ['a', 'b', 'c', 'd'], false);
    expect(gen).toHaveLength(6);
  });
});

describe('platformPlanOf', () => {
  it('shows what an apply would create only for steps it builds', () => {
    const need = (mode: 'sheet' | 'existing' | 'skip', found: number, create: number, missing = 0) =>
      ({ mode, found, create, missing, absent: 0, notes: [], missingNames: [] });
    const res = {
      steps: {
        org: need('sheet', 1, 0), campus: need('skip', 0, 0), competitors: need('sheet', 2, 3),
        people: need('existing', 10, 0, 2), staff: need('sheet', 0, 2), championship: need('sheet', 0, 1),
        venue: need('sheet', 0, 3), draws: need('sheet', 0, 1), squads: need('sheet', 0, 5), fixtures: need('sheet', 0, 7),
      },
      issues: [{ severity: 'error', code: 'not_on_platform', message: 'm' }],
    } as unknown as Resolution;
    const plan = platformPlanOf(res);
    expect(plan.steps.map((s) => s.step)).toEqual(['org', 'campus', 'competitors', 'people', 'staff', 'championship', 'venue', 'draws', 'squads', 'fixtures']);
    expect(plan.steps.find((s) => s.step === 'people')).toMatchObject({ found: 10, create: 0, missing: 2 });
    expect(plan.steps.find((s) => s.step === 'competitors')).toMatchObject({ found: 2, create: 3 });
    expect(plan.issues).toHaveLength(1);
  });
});

describe('cleanupBlueprint', () => {
  const store = (m: Manifest) => {
    const saved: Manifest[] = [];
    const s: ManifestStore = { load: async () => normaliseManifest(m), save: async (x) => { saved.push(x); } };
    return { s, saved };
  };
  const prismaWith = (played: number) => {
    const deletes: string[] = [];
    return {
      deletes,
      prisma: {
        fixtures: { count: async () => played },
        $executeRaw: async (q: { sql: string; values: unknown[] }) => {
          deletes.push(/delete from (\w+)/.exec(q.sql)![1]);
          return (q.values[0] as string[]).length;
        },
      } as never,
    };
  };
  const manifest = (): Manifest => ({
    keys: { org: 'o1' },
    created: { organizations: ['o1'], users: ['u1', 'u2'], fixtures: ['f1'], teams: ['t1'], team_entries: ['e1'], org_units: ['x1'] },
    runs: [],
  });

  it('refuses once any match on its draws has been played', async () => {
    const { prisma, deletes } = prismaWith(3);
    await expect(cleanupBlueprint(prisma, store(manifest()).s, { apply: true })).rejects.toBeInstanceOf(CleanupRefusedError);
    expect(deletes).toHaveLength(0);
  });

  it('deletes exactly what it made, children before parents, then empties the manifest', async () => {
    const { prisma, deletes } = prismaWith(0);
    const { s, saved } = store(manifest());
    await cleanupBlueprint(prisma, s, { apply: true });
    expect(deletes).toEqual(['fixtures', 'team_entries', 'teams', 'users', 'org_units', 'organizations']);
    // The same relative order as the declared FK order.
    expect(deletes).toEqual(CLEANUP_ORDER.filter((t) => deletes.includes(t)));
    expect(saved.at(-1)).toMatchObject({ keys: {}, created: {} });
    expect(saved.at(-1)!.runs.at(-1)!.mode).toBe('cleanup');
  });

  it('only reports on a dry run', async () => {
    const { prisma, deletes } = prismaWith(0);
    const { s, saved } = store(manifest());
    const out = await cleanupBlueprint(prisma, s, { apply: false });
    expect(out).toContain('would delete 2 users');
    expect(deletes).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('refuses a manifest naming a table it does not know how to remove', async () => {
    const { prisma } = prismaWith(0);
    await expect(cleanupBlueprint(prisma, store({ ...emptyManifest(), created: { audit_log: ['a'] } }).s, { apply: true })).rejects.toThrow(/audit_log/);
  });
});
