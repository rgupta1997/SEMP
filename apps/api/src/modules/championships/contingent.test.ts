import { describe, it, expect } from 'vitest';
import { contingentKey } from '@semp/shared';
import {
  ancestry, assertEntrantAllowed, checkPlayerEligible, eligibleEntrants, isUnder,
  screenSquad, type UnitRow,
} from './contingent.js';

// The contingent rules, tested where they are decidable without a database.
//
// The stakes here are unusual for a pure-logic test: every one of these functions
// exists to stop a result being credited to the wrong competitor. A permissive bug
// in `checkPlayerEligible` does not throw or 500 - it produces a standings table
// that is quietly, permanently wrong, and there is no later moment at which anybody
// notices. So the refusal branches are tested as carefully as the happy path.

const ORG = 'org-iimb';
const OTHER_ORG = 'org-iimi';

// Two campuses, three departments. Mumbai deliberately has no departments, so a
// department-level event confined to it has zero entrants - the empty case that a
// screen has to render honestly rather than as a loading state.
const UNITS: UnitRow[] = [
  { id: 'blr', organization_id: ORG, parent_id: null, type: 'campus', name: 'Bangalore', code: 'BLR', status: 'ACTIVE', display_order: 0 },
  { id: 'mum', organization_id: ORG, parent_id: null, type: 'campus', name: 'Mumbai', code: 'MUM', status: 'ACTIVE', display_order: 1 },
  { id: 'pune', organization_id: ORG, parent_id: null, type: 'campus', name: 'Pune', code: 'PNQ', status: 'SETUP', display_order: 2 },
  { id: 'sales', organization_id: ORG, parent_id: 'blr', type: 'department', name: 'Sales', code: 'SLS', status: 'ACTIVE', display_order: 0 },
  { id: 'eng', organization_id: ORG, parent_id: 'blr', type: 'department', name: 'Engineering', code: 'ENG', status: 'ACTIVE', display_order: 1 },
  { id: 'fin', organization_id: ORG, parent_id: 'pune', type: 'department', name: 'Finance', code: 'FIN', status: 'ACTIVE', display_order: 2 },
];

const unitMap = (rows: UnitRow[] = UNITS) => new Map(rows.map((u) => [u.id, u]));
const LABELS = { campus: 'Campus', department: 'Department' };

/** Just enough of `Db` for the functions under test. */
function fakeDb(over: Record<string, unknown> = {}) {
  return {
    org_units: { findMany: async () => UNITS },
    organization_members: { findMany: async () => [] },
    org_unit_members: { findMany: async () => [] },
    users: { findMany: async () => [] },
    organizations: { findUnique: async () => ({ settings: {} }) },
    ...over,
  } as any;
}

const event = (over: Record<string, unknown> = {}) => ({
  id: 'evt', entry_level: 'organization' as const, entry_scope_unit_id: null,
  host_organization_id: ORG, ...over,
} as any);

// ---------------------------------------------------------------------------

describe('contingentKey - the one rule everything downstream reads', () => {
  it('uses the unit when there is one', () => {
    expect(contingentKey({ orgId: ORG, unitId: 'blr' })).toBe('blr');
  });

  it('falls back to the organisation when there is not', () => {
    expect(contingentKey({ orgId: ORG, unitId: null })).toBe(ORG);
  });

  it('gives two campuses of ONE organisation two different keys', () => {
    // This single assertion is the whole feature. Before the contingent existed both
    // sides resolved to `ORG`, so an intra standings table had one row.
    const blr = contingentKey({ orgId: ORG, unitId: 'blr' });
    const mum = contingentKey({ orgId: ORG, unitId: 'mum' });
    expect(blr).not.toBe(mum);
  });
});

describe('ancestry', () => {
  it('walks a department up to its campus, nearest first', () => {
    expect(ancestry(unitMap(), 'sales').map((u) => u.id)).toEqual(['sales', 'blr']);
  });

  it('returns just the campus for a top-level unit', () => {
    expect(ancestry(unitMap(), 'blr').map((u) => u.id)).toEqual(['blr']);
  });

  it('returns nothing for an id that is not in the tree', () => {
    expect(ancestry(unitMap(), 'nope')).toEqual([]);
  });

  it('terminates on a cycle instead of hanging', () => {
    // parent_id has no constraint preventing this. A hang is a worse failure than a
    // wrong answer because it takes the request thread with it.
    const cyclic: UnitRow[] = [
      { id: 'a', organization_id: ORG, parent_id: 'b', type: 'department', name: 'A', code: null, status: 'ACTIVE', display_order: 0 },
      { id: 'b', organization_id: ORG, parent_id: 'a', type: 'campus', name: 'B', code: null, status: 'ACTIVE', display_order: 0 },
    ];
    expect(ancestry(unitMap(cyclic), 'a').map((u) => u.id)).toEqual(['a', 'b']);
  });
});

describe('isUnder', () => {
  it('is true for a department of that campus', () => {
    expect(isUnder(unitMap(), 'sales', 'blr')).toBe(true);
  });
  it('is true for the campus itself', () => {
    expect(isUnder(unitMap(), 'blr', 'blr')).toBe(true);
  });
  it('is false across campuses', () => {
    expect(isUnder(unitMap(), 'sales', 'mum')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('eligibleEntrants', () => {
  it('offers nothing for an inter-organisation event - anybody may apply', async () => {
    expect(await eligibleEntrants(fakeDb(), event())).toEqual([]);
  });

  it('offers the ACTIVE campuses, and not the one still being set up', async () => {
    const rows = await eligibleEntrants(fakeDb(), event({ entry_level: 'campus' }));
    expect(rows.map((r) => r.name).sort()).toEqual(['Bangalore', 'Mumbai']);
    // Pune is SETUP: a legitimate scope for a role grant, not yet a competitor.
    expect(rows.some((r) => r.name === 'Pune')).toBe(false);
  });

  it('offers every department across the organisation when no campus is named', async () => {
    const rows = await eligibleEntrants(fakeDb(), event({ entry_level: 'department' }));
    expect(rows.map((r) => r.name).sort()).toEqual(['Engineering', 'Finance', 'Sales']);
  });

  it('offers only that campus’s departments when one is named', async () => {
    const rows = await eligibleEntrants(fakeDb(), event({ entry_level: 'department', entry_scope_unit_id: 'blr' }));
    expect(rows.map((r) => r.name).sort()).toEqual(['Engineering', 'Sales']);
  });

  it('names the campus a department belongs to, so two "Sales" rows are tellable apart', async () => {
    const rows = await eligibleEntrants(fakeDb(), event({ entry_level: 'department' }));
    expect(rows.find((r) => r.name === 'Sales')?.parentName).toBe('Bangalore');
  });

  it('returns an empty list - not an error - for a campus with no departments', async () => {
    const rows = await eligibleEntrants(fakeDb(), event({ entry_level: 'department', entry_scope_unit_id: 'mum' }));
    expect(rows).toEqual([]);
  });

  it('offers nothing when an intra event somehow has no host', async () => {
    expect(await eligibleEntrants(fakeDb(), event({ entry_level: 'campus', host_organization_id: null }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('assertEntrantAllowed', () => {
  it('accepts an organisation entering an inter-organisation event', async () => {
    await expect(assertEntrantAllowed(fakeDb(), event(), { orgId: OTHER_ORG, unitId: null })).resolves.toBeUndefined();
  });

  it('refuses a unit entering an inter-organisation event', async () => {
    await expect(assertEntrantAllowed(fakeDb(), event(), { orgId: ORG, unitId: 'blr' }))
      .rejects.toThrow(/between organisations/i);
  });

  it('accepts a campus entering a campus-level event', async () => {
    await expect(assertEntrantAllowed(fakeDb(), event({ entry_level: 'campus' }), { orgId: ORG, unitId: 'blr' }))
      .resolves.toBeUndefined();
  });

  it('refuses an organisation-shaped entry to an intra event', async () => {
    // This is the old enroll call arriving unchanged. Without the check it would
    // create a contingent keyed on the organisation, which nothing can rank.
    await expect(assertEntrantAllowed(fakeDb(), event({ entry_level: 'campus' }), { orgId: ORG, unitId: null }))
      .rejects.toThrow(/must name one/i);
  });

  it('refuses another organisation trying to enter an intra event', async () => {
    await expect(assertEntrantAllowed(fakeDb(), event({ entry_level: 'campus' }), { orgId: OTHER_ORG, unitId: 'blr' }))
      .rejects.toThrow(/inside its host organisation/i);
  });

  it('refuses a department entering a campus-level event', async () => {
    await expect(assertEntrantAllowed(fakeDb(), event({ entry_level: 'campus' }), { orgId: ORG, unitId: 'sales' }))
      .rejects.toThrow(/is a department/i);
  });

  it('refuses a campus that is not ACTIVE', async () => {
    await expect(assertEntrantAllowed(fakeDb(), event({ entry_level: 'campus' }), { orgId: ORG, unitId: 'pune' }))
      .rejects.toThrow(/marked SETUP/i);
  });

  it('refuses a department outside the campus the event is limited to', async () => {
    await expect(assertEntrantAllowed(
      fakeDb(),
      event({ entry_level: 'department', entry_scope_unit_id: 'blr' }),
      { orgId: ORG, unitId: 'fin' },
    )).rejects.toThrow(/limited to Bangalore/i);
  });

  it('refuses an intra event with no host rather than silently allowing it', async () => {
    await expect(assertEntrantAllowed(fakeDb(), event({ entry_level: 'campus', host_organization_id: null }), { orgId: ORG, unitId: 'blr' }))
      .rejects.toThrow(/no host organisation/i);
  });
});

// ---------------------------------------------------------------------------

describe('checkPlayerEligible - strict unit eligibility', () => {
  it('allows anybody when the team plays for the organisation itself', () => {
    // Inter-organisation: membership is the whole test, and the caller established it.
    expect(checkPlayerEligible(unitMap(), null, { isMember: true, unitIds: new Set<string>() }, 'Asha', LABELS).ok).toBe(true);
  });

  it('allows a player of that exact campus', () => {
    expect(checkPlayerEligible(unitMap(), 'blr', { isMember: true, unitIds: new Set(['blr']) }, 'Asha', LABELS).ok).toBe(true);
  });

  it('allows a player of a department beneath that campus', () => {
    expect(checkPlayerEligible(unitMap(), 'blr', { isMember: true, unitIds: new Set(['sales']) }, 'Asha', LABELS).ok).toBe(true);
  });

  it('refuses a player from another campus, and says which', () => {
    const v = checkPlayerEligible(unitMap(), 'blr', { isMember: true, unitIds: new Set(['mum']) }, 'Meera', LABELS);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Meera belongs to Mumbai/);
  });

  // What multi-membership buys. The same person is legitimately in a campus AND a
  // department inside it, and under the old single-column placement they had to
  // pick one and lost eligibility for the other.
  it('allows somebody who belongs to SEVERAL units, for each of them', () => {
    const both = { isMember: true, unitIds: new Set(['blr', 'sales']) };
    expect(checkPlayerEligible(unitMap(), 'blr', both, 'Asha', LABELS).ok).toBe(true);
    expect(checkPlayerEligible(unitMap(), 'sales', both, 'Asha', LABELS).ok).toBe(true);
    // Still refused where none of their units qualifies.
    expect(checkPlayerEligible(unitMap(), 'mum', both, 'Asha', LABELS).ok).toBe(false);
  });

  it('names every unit they DO belong to when refusing', () => {
    const v = checkPlayerEligible(unitMap(), 'mum', { isMember: true, unitIds: new Set(['sales', 'eng']) }, 'Ravi', LABELS);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Sales/);
    expect(v.reason).toMatch(/Engineering/);
  });

  it('refuses a player with no unit at all', () => {
    // The important direction. Allowing them would put every unassigned person in
    // the organisation into every campus's talent pool.
    const v = checkPlayerEligible(unitMap(), 'blr', { isMember: true, unitIds: new Set<string>() }, 'Sunil', LABELS);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/has not been added to a campus/i);
  });

  it('refuses somebody who is not a member of the organisation', () => {
    const v = checkPlayerEligible(unitMap(), 'blr', { isMember: false, unitIds: new Set<string>() }, 'Stranger', LABELS);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/not a member/i);
  });

  it('refuses a campus colleague from the wrong DEPARTMENT for a department team', () => {
    // Same campus, different department: eligible for Bangalore, not for Sales.
    expect(checkPlayerEligible(unitMap(), 'sales', { isMember: true, unitIds: new Set(['eng']) }, 'Ravi', LABELS).ok).toBe(false);
    expect(checkPlayerEligible(unitMap(), 'blr', { isMember: true, unitIds: new Set(['eng']) }, 'Ravi', LABELS).ok).toBe(true);
  });

  it('speaks the organisation’s own nouns', () => {
    const v = checkPlayerEligible(unitMap(), 'blr', { isMember: true, unitIds: new Set<string>() }, 'Sunil', { campus: 'Office', department: 'Team' });
    expect(v.reason).toMatch(/added to an office|added to a office/i);
  });
});

// ---------------------------------------------------------------------------

describe('screenSquad', () => {
  const db = fakeDb({
    organization_members: {
      findMany: async () => [
        { user_id: 'u-asha' }, { user_id: 'u-meera' }, { user_id: 'u-sunil' },
      ],
    },
    org_unit_members: {
      findMany: async () => [
        { user_id: 'u-asha', org_unit_id: 'sales' },
        { user_id: 'u-meera', org_unit_id: 'mum' },
        // u-sunil is a member but placed nowhere.
      ],
    },
    users: {
      findMany: async () => [
        { id: 'u-asha', name: 'Asha' },
        { id: 'u-meera', name: 'Meera' },
        { id: 'u-sunil', name: 'Sunil' },
      ],
    },
  });

  it('passes everybody through untouched for an organisation team', async () => {
    const team = { organization_id: ORG, org_unit_id: null };
    const r = await screenSquad(db, team, ['u-asha', 'u-meera', 'u-sunil']);
    expect(r.ok).toHaveLength(3);
    expect(r.refused).toEqual([]);
  });

  it('returns EVERY refusal rather than stopping at the first', async () => {
    // A captain pasting thirty names wants the whole list of who cannot play, not
    // one name per round trip.
    const team = { organization_id: ORG, org_unit_id: 'blr' };
    const r = await screenSquad(db, team, ['u-asha', 'u-meera', 'u-sunil']);
    expect(r.ok).toEqual(['u-asha']);
    expect(r.refused.map((x) => x.user_id).sort()).toEqual(['u-meera', 'u-sunil']);
    expect(r.refused.every((x) => x.reason.length > 0)).toBe(true);
  });

  it('does no work at all for an empty list', async () => {
    const r = await screenSquad(db, { organization_id: ORG, org_unit_id: 'blr' }, []);
    expect(r).toEqual({ ok: [], refused: [] });
  });
});
