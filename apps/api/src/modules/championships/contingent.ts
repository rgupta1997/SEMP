import {
  contingentKey, entrantUnitType, isIntraLevel, pluralise, unitLabels,
  type ContingentRef, type EntryLevel, type UnitLabels, type UnitType,
} from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';

// The contingent: who competes, who may enter, and who may be picked for them.
//
// Everything about intra-organisation events funnels through this file. The rule it
// exists to hold is one sentence - "the unit wins when there is one, the
// organisation otherwise" - and the reason it is a module rather than a `??` at
// each call site is that there are eleven call sites and they must not drift.
//
// Three jobs, in the order the product uses them:
//
//   1. WHO MAY ENTER        eligibleEntrants()      - the entrant picker's options
//   2. IS THIS ENTRY VALID  assertEntrantAllowed()  - the guard on enrolling
//   3. WHO MAY BE PICKED    assertPlayerEligible()  - the guard on squad selection
//
// (3) is the one that makes an intra result MEAN anything. If Mumbai can field a
// Bangalore player, "Bangalore beat Mumbai" is not a fact about either campus.

// ---------------------------------------------------------------------------
// The championship's competition shape
// ---------------------------------------------------------------------------

export interface EventShape {
  id: string;
  entry_level: EntryLevel;
  entry_scope_unit_id: string | null;
  host_organization_id: string | null;
}

/** Columns every caller here needs. Kept as one const so the selects cannot drift. */
export const EVENT_SHAPE_SELECT = {
  id: true,
  entry_level: true,
  entry_scope_unit_id: true,
  host_organization_id: true,
} as const;

export async function loadEventShape(db: Db, championshipId: string): Promise<EventShape> {
  const row = await db.championships.findUnique({
    where: { id: championshipId },
    select: EVENT_SHAPE_SELECT,
  });
  if (!row) throw new NotFoundError('Championship');
  return row as EventShape;
}

// ---------------------------------------------------------------------------
// The unit tree
// ---------------------------------------------------------------------------

export interface UnitRow {
  id: string;
  organization_id: string;
  parent_id: string | null;
  type: string;
  name: string;
  code: string | null;
  status: string;
  display_order: number;
}

/**
 * Every unit in one organisation, by id.
 *
 * The whole tree is loaded rather than walked query-by-query: it is a few dozen
 * rows, and ancestry has to be resolved for every player being checked. Two levels
 * today, so a recursive CTE would cost more to read than it saves.
 */
export async function loadUnits(db: Db, organizationId: string): Promise<Map<string, UnitRow>> {
  const rows = await db.org_units.findMany({
    where: { organization_id: organizationId },
    select: {
      id: true, organization_id: true, parent_id: true, type: true,
      name: true, code: true, status: true, display_order: true,
    },
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
  });
  return new Map(rows.map((r) => [r.id, r as UnitRow]));
}

/**
 * This unit and every unit above it, nearest first.
 *
 * Depth-capped rather than trusting the data. `parent_id` is a self-reference with
 * no constraint preventing a cycle, and a cycle here would hang the request rather
 * than return a wrong answer - the worse of the two failures.
 */
export function ancestry(units: Map<string, UnitRow>, unitId: string): UnitRow[] {
  const chain: UnitRow[] = [];
  const seen = new Set<string>();
  let cur = units.get(unitId);
  while (cur && !seen.has(cur.id) && chain.length < 16) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parent_id ? units.get(cur.parent_id) : undefined;
  }
  return chain;
}

/** Does `unitId` sit at or beneath `rootId`? The campus-membership test. */
export function isUnder(units: Map<string, UnitRow>, unitId: string, rootId: string): boolean {
  return ancestry(units, unitId).some((u) => u.id === rootId);
}

/** The nearest ancestor of the given type, including the unit itself. */
export function ancestorOfType(units: Map<string, UnitRow>, unitId: string, type: UnitType): UnitRow | null {
  return ancestry(units, unitId).find((u) => u.type === type) ?? null;
}

// ---------------------------------------------------------------------------
// 1 · who may enter
// ---------------------------------------------------------------------------

export interface Entrant {
  /** The contingent key - what standings group by. */
  key: string;
  orgId: string;
  unitId: string | null;
  name: string;
  short?: string | null;
  /** For a department, the campus it belongs to. Renders "Sales · Bangalore". */
  parentName?: string | null;
}

/**
 * The entrants an intra championship offers.
 *
 * SETUP and ARCHIVED units are excluded: a unit that has been created but not put
 * into use is a legitimate scope for a role grant and is not yet a competitor. The
 * distinction matters because an organisation building out its structure would
 * otherwise find half-finished campuses appearing on an entry form.
 *
 * Returns [] for an inter-organisation event - the entrants there are other
 * institutions, which apply rather than being enumerated.
 */
export async function eligibleEntrants(db: Db, event: EventShape): Promise<Entrant[]> {
  if (!isIntraLevel(event.entry_level)) return [];
  const orgId = event.host_organization_id;
  if (!orgId) return [];

  const type = entrantUnitType(event.entry_level);
  if (!type) return [];

  const units = await loadUnits(db, orgId);
  const out: Entrant[] = [];
  for (const u of units.values()) {
    if (u.type !== type) continue;
    if (u.status !== 'ACTIVE') continue;
    // A department-level event may be confined to one campus. Null scope means the
    // whole organisation's departments, which is the org-wide department league.
    if (event.entry_scope_unit_id && !isUnder(units, u.id, event.entry_scope_unit_id)) continue;
    const parent = u.parent_id ? units.get(u.parent_id) : null;
    out.push({
      key: u.id,
      orgId,
      unitId: u.id,
      name: u.name,
      short: u.code,
      parentName: parent?.name ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2 · is this entry valid
// ---------------------------------------------------------------------------

/**
 * Refuse an entry that does not belong in this championship.
 *
 * Both directions are checked, because both are real mistakes rather than
 * hypotheticals: an inter-org event handed a unit id (a client sending the intra
 * shape at the wrong event), and an intra event handed an organisation with no unit
 * (the old enroll call arriving unchanged). Each silently produces a contingent
 * nothing can rank, so each gets a message naming what was wrong.
 */
export async function assertEntrantAllowed(db: Db, event: EventShape, ref: ContingentRef): Promise<void> {
  if (!isIntraLevel(event.entry_level)) {
    if (ref.unitId) {
      throw new BusinessRuleError('This championship is contested between organisations, so an entry cannot name a campus or department.');
    }
    return;
  }

  const hostOrgId = event.host_organization_id;
  if (!hostOrgId) {
    throw new BusinessRuleError('This championship is contested inside one organisation but has no host organisation set.');
  }
  if (ref.orgId !== hostOrgId) {
    throw new BusinessRuleError('This championship is contested inside its host organisation. Another organisation cannot enter it.');
  }
  if (!ref.unitId) {
    const type = entrantUnitType(event.entry_level);
    throw new BusinessRuleError(`This championship is contested between ${type}s, so an entry must name one.`);
  }

  const units = await loadUnits(db, hostOrgId);
  const unit = units.get(ref.unitId);
  if (!unit) throw new NotFoundError('Campus or department');

  const type = entrantUnitType(event.entry_level);
  if (type && unit.type !== type) {
    throw new BusinessRuleError(`This championship is contested between ${type}s. “${unit.name}” is a ${unit.type}.`);
  }
  if (unit.status !== 'ACTIVE') {
    throw new BusinessRuleError(`“${unit.name}” is marked ${unit.status} and cannot be entered into a championship.`);
  }
  if (event.entry_scope_unit_id && !isUnder(units, unit.id, event.entry_scope_unit_id)) {
    const scope = units.get(event.entry_scope_unit_id);
    throw new BusinessRuleError(`This championship is limited to ${scope?.name ?? 'one campus'}. “${unit.name}” is not part of it.`);
  }
}

/**
 * The entry row for one contingent, or null.
 *
 * A plain `findFirst`, and it exists as a named function because the compound
 * unique it replaces - `championship_id_organization_id` - was removed by the
 * intra-events migration and Prisma no longer generates a `findUnique` for this
 * pair. Three call sites used that key; centralising them means the next one
 * cannot quietly reintroduce "one entry per organisation", which is precisely the
 * assumption that made intra events impossible.
 */
export async function findEntrant(db: Db, championshipId: string, ref: ContingentRef) {
  return db.championship_organizations.findFirst({
    where: {
      championship_id: championshipId,
      organization_id: ref.orgId,
      org_unit_id: ref.unitId ?? null,
    },
  });
}

/**
 * May a squad playing for `unitId` compete in this championship?
 *
 * Two things have to hold and they fail for different reasons, so they are reported
 * separately. The LEVEL check is the one that was missing, and its absence produced
 * the worst message in the product: a batch squad entering a campus-level event was
 * told "PGP 2026 has not been invited", which sent people looking for an invitation
 * that could never have been the right answer. The real problem was that a batch
 * cannot compete against campuses at all - the table would rank a batch beside a
 * campus, which is the mixing the entry level exists to prevent.
 *
 * Returns null when the squad may enter; otherwise the sentence to refuse it with.
 */
export async function squadEntryRefusal(
  db: Db,
  event: EventShape,
  championshipName: string,
  unitId: string | null,
  labels: UnitLabels,
): Promise<string | null> {
  const wanted = entrantUnitType(event.entry_level);
  if (!wanted) return null;                       // inter-org: nothing to check here

  if (!unitId) {
    return `“${championshipName}” is contested between ${pluralise(labels[wanted]).toLowerCase()}, so a whole-organisation squad cannot enter it.`;
  }

  const units = await loadUnits(db, event.host_organization_id ?? '');
  const unit = units.get(unitId);
  if (!unit) return 'That squad does not belong to the organisation running this championship.';

  // 1 · the LEVEL. Names the mismatch AND both ways out, because there genuinely
  // are two: move the squad up a level, or run the event at the squad's level.
  if (unit.type !== wanted) {
    const parent = unit.parent_id ? units.get(unit.parent_id) : null;
    const theirs = labels[unit.type as UnitType] ?? unit.type;
    return `“${championshipName}” is contested between ${pluralise(labels[wanted]).toLowerCase()}, and this squad plays for ${unit.name}, which is a ${theirs.toLowerCase()}${parent ? ` of ${parent.name}` : ''}. `
      + `Enter a squad that plays for ${parent ? parent.name : `the ${labels[wanted].toLowerCase()} itself`} — it can pick players from ${unit.name} — or run this championship between ${pluralise(theirs).toLowerCase()} instead.`;
  }

  // 2 · the INVITATION. Only asked once the level is right, so it can never be the
  // reason somebody is shown for a mismatch they cannot fix by inviting anything.
  const invited = await db.championship_invitations.findFirst({
    where: { championship_id: event.id, org_unit_id: unitId, status: { in: ['pending', 'accepted'] } },
    select: { id: true },
  });
  if (!invited) {
    return `${unit.name} is not taking part in “${championshipName}”. Add it under Setup → Invite first.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3 · who may be picked
// ---------------------------------------------------------------------------

export interface EligibilityVerdict {
  ok: boolean;
  /** Present when refused - shown to the organiser, so it names the person and the reason. */
  reason?: string;
}

/**
 * Every unit each of these people belongs to, by user id.
 *
 * A person is in SEVERAL units at once - a campus, a department inside it, an
 * intake year - so placement is a set, not a value. This is the only way placement
 * should be read: `organization_members` no longer carries a unit column, precisely
 * so that eligibility, the directory and the reports cannot each answer this
 * differently.
 */
export async function loadPlacements(
  db: Db,
  organizationId: string,
  userIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (userIds.length === 0) return out;
  const rows = await db.org_unit_members.findMany({
    where: { organization_id: organizationId, user_id: { in: userIds } },
    select: { user_id: true, org_unit_id: true },
  });
  for (const r of rows) {
    let set = out.get(r.user_id);
    if (!set) { set = new Set(); out.set(r.user_id, set); }
    set.add(r.org_unit_id);
  }
  return out;
}

/**
 * May this person play for this contingent?
 *
 * The strict rule: at least ONE of the units this person belongs to must sit at or
 * beneath the contingent's unit. No organiser override - a squad list that can be
 * waived is a squad list that means nothing, and the whole point of an internal
 * event is that "Bangalore beat Mumbai" is a fact about those two campuses.
 *
 * "At least one" is what multi-membership buys: somebody in Bangalore AND in Sales
 * is legitimately eligible for the Bangalore squad and the Sales squad, and under
 * the old single-column placement they had to choose. The containment test is
 * unchanged - a campus includes its departments, a department does not include its
 * campus - it is now applied across the whole set.
 *
 * Somebody in no unit at all is refused rather than allowed. That direction is
 * deliberate: allowing them would put every unplaced person in the organisation
 * into every campus's talent pool, which is the exact failure this check exists to
 * prevent. The message says what to do about it.
 */
export function checkPlayerEligible(
  units: Map<string, UnitRow>,
  contingentUnitId: string | null,
  placement: { isMember: boolean; unitIds: ReadonlySet<string> } | null,
  who: string,
  labels: UnitLabels,
): EligibilityVerdict {
  // Inter-organisation: belonging to the organisation is the whole test, and the
  // caller has already established membership.
  if (!contingentUnitId) return { ok: true };

  const unit = units.get(contingentUnitId);
  const unitName = unit?.name ?? 'this team';
  const level = unit?.type === 'department' ? labels.department.toLowerCase() : labels.campus.toLowerCase();

  if (!placement?.isMember) return { ok: false, reason: `${who} is not a member of this organisation.` };
  if (placement.unitIds.size === 0) {
    return { ok: false, reason: `${who} has not been added to a ${level} yet, so they cannot be picked for ${unitName}.` };
  }
  if ([...placement.unitIds].some((id) => isUnder(units, id, contingentUnitId))) return { ok: true };

  // Named, not just refused. "Meera belongs to Mumbai" is actionable; "not
  // eligible" sends somebody hunting through a directory.
  const theirs = [...placement.unitIds]
    .map((id) => units.get(id)?.name)
    .filter((n): n is string => !!n);
  return {
    ok: false,
    reason: theirs.length
      ? `${who} belongs to ${theirs.join(' and ')}, so they cannot play for ${unitName}.`
      : `${who} does not belong to ${unitName}.`,
  };
}

/**
 * The batch form of the check, for a squad being submitted at once.
 *
 * Returns every refusal rather than throwing on the first: an organiser pasting
 * fifteen names wants the list of who cannot play, not one name at a time across
 * fifteen round trips.
 */
export async function screenSquad(
  db: Db,
  team: { organization_id: string; org_unit_id: string | null },
  userIds: string[],
): Promise<{ ok: string[]; refused: Array<{ user_id: string; reason: string }> }> {
  if (!team.org_unit_id || userIds.length === 0) {
    return { ok: userIds, refused: [] };
  }

  const [units, members, placements, people, org] = await Promise.all([
    loadUnits(db, team.organization_id),
    db.organization_members.findMany({
      where: { organization_id: team.organization_id, user_id: { in: userIds } },
      select: { user_id: true },
    }),
    loadPlacements(db, team.organization_id, userIds),
    db.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    db.organizations.findUnique({ where: { id: team.organization_id }, select: { settings: true } }),
  ]);

  const labels = unitLabels(org?.settings);
  const isMember = new Set(members.map((m) => m.user_id));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const ok: string[] = [];
  const refused: Array<{ user_id: string; reason: string }> = [];
  for (const id of userIds) {
    const verdict = checkPlayerEligible(
      units,
      team.org_unit_id,
      { isMember: isMember.has(id), unitIds: placements.get(id) ?? new Set() },
      nameOf.get(id) ?? 'This player',
      labels,
    );
    if (verdict.ok) ok.push(id);
    else refused.push({ user_id: id, reason: verdict.reason ?? 'Not eligible for this team.' });
  }
  return { ok, refused };
}

/** Single-player form. Throws with the reason, for the one-at-a-time endpoints. */
export async function assertPlayerEligible(
  db: Db,
  team: { organization_id: string; org_unit_id: string | null },
  userId: string,
): Promise<void> {
  const { refused } = await screenSquad(db, team, [userId]);
  if (refused.length) throw new BusinessRuleError(refused[0].reason);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export interface ContingentName {
  key: string;
  name: string;
  short: string | null;
  /** The campus, when the contingent is a department. */
  parent: string | null;
}

/**
 * Names for a set of contingents, in one round trip.
 *
 * Standings, fixtures and medal tallies all need "what do I call this row", and
 * each of them previously reached for `organizations.name` directly. Doing that in
 * an intra event labels every row with the institution - twelve rows all reading
 * "IIM Bangalore" - which is exactly the bug this whole change exists to fix.
 */
export async function nameContingents(db: Db, refs: ContingentRef[]): Promise<Map<string, ContingentName>> {
  const out = new Map<string, ContingentName>();
  if (refs.length === 0) return out;

  const unitIds = [...new Set(refs.map((r) => r.unitId).filter((id): id is string => !!id))];
  const orgIds = [...new Set(refs.filter((r) => !r.unitId).map((r) => r.orgId))];

  const [units, orgs] = await Promise.all([
    unitIds.length
      ? db.org_units.findMany({
        where: { id: { in: unitIds } },
        select: { id: true, name: true, code: true, parent_id: true },
      })
      : Promise.resolve([]),
    orgIds.length
      ? db.organizations.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true, short_name: true },
      })
      : Promise.resolve([]),
  ]);

  // One more hop for the campus a department belongs to. Only the parents that are
  // not already in the result set, so a campus-level event costs nothing extra.
  const parentIds = [...new Set(units.map((u) => u.parent_id).filter((id): id is string => !!id && !unitIds.includes(id)))];
  const parents = parentIds.length
    ? await db.org_units.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
    : [];
  const parentName = new Map([...units, ...parents].map((u) => [u.id, u.name]));

  for (const u of units) {
    out.set(u.id, {
      key: u.id,
      name: u.name,
      short: u.code,
      parent: u.parent_id ? parentName.get(u.parent_id) ?? null : null,
    });
  }
  for (const o of orgs) {
    out.set(o.id, { key: o.id, name: o.name, short: o.short_name, parent: null });
  }
  return out;
}

export { contingentKey };
