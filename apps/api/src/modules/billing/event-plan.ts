import {
  CAPABILITIES,
  catalogSettings,
  granted,
  grantedCapabilities,
  isDefaultFormat,
  limitsIn,
  planFor,
  resolveEventPlan,
  type CapabilityKey,
  type EventPlanState,
  type LimitKey,
  type Tier,
} from '@semp/entitlements';
import {
  assertCapability,
  assertWithinOrgLimit,
  CapabilityRequiredError,
  limitState,
  PlanLimitError,
  plansEnforced,
  type LimitState,
} from '@semp/entitlements/server';
import { countActiveEvents, countEventsTotal } from './usage.js';
import type { Db } from '../../infra/prisma.js';
import { DomainError } from '../../shared/errors.js';
import { CapabilityError } from '../../http/middleware/entitlements.js';

// The plan an EVENT runs on, and the gates that read it.
//
// Every gate here costs ONE indexed read (the championship by primary key, with
// its host org's plan joined) plus the cached enforcement switch. Gates run only
// on create/edit routes; nothing here sits on a read path or the live-scoring
// hot path. When plans are switched off platform-wide every event resolves to
// `max` and every gate passes - which is how beta runs today.

export interface Actor {
  id: string;
  isSuperAdmin?: boolean;
}

/** Thrown when an event's grace period has run out: it is read-only until the plan is restored. */
export class PlanLapsedError extends DomainError {
  constructor(graceUntil: string | null) {
    super(
      'PLAN_LAPSED',
      'This event is read-only: the plan it runs on has ended. Renew the subscription to continue - nothing has been deleted.',
      402,
      { graceUntil },
    );
  }
}

export async function eventPlanOf(db: Db, championshipId: string): Promise<EventPlanState & { hostOrganizationId: string | null }> {
  const row = await db.championships.findUnique({
    where: { id: championshipId },
    select: {
      plan_tier: true, plan_source: true, plan_grace_until: true, host_organization_id: true,
      organizations: { select: { plan: true } },
    },
  });
  const enforced = await plansEnforced(db as never);
  const state = resolveEventPlan({
    orgTier: (row?.organizations?.plan as Tier | undefined) ?? null,
    planTier: (row?.plan_tier as Tier | null) ?? null,
    planSource: row?.plan_source ?? null,
    graceUntil: row?.plan_grace_until ?? null,
    enforced,
  });
  return { ...state, hostOrganizationId: row?.host_organization_id ?? null };
}

/** 403 CAPABILITY_REQUIRED unless the event's plan includes it. Super admins pass (support). */
export async function assertEventCapability(
  db: Db,
  championshipId: string | null | undefined,
  capability: CapabilityKey,
  actor?: Actor,
): Promise<void> {
  if (!championshipId || actor?.isSuperAdmin) return;
  const plan = await eventPlanOf(db, championshipId);
  if (!granted(plan.tier, capability)) throw new CapabilityError(new CapabilityRequiredError(capability));
}

export async function eventHasCapability(db: Db, championshipId: string, capability: CapabilityKey): Promise<boolean> {
  return granted((await eventPlanOf(db, championshipId)).tier, capability);
}

/**
 * 402 PLAN_LIMIT_REACHED when the event has no room for `adding` more.
 * `count` is only run when the plan actually has a ceiling - an unlimited plan
 * pays for no counting query at all.
 */
export async function assertEventLimit(
  db: Db,
  championshipId: string | null | undefined,
  key: LimitKey,
  count: () => Promise<number>,
  opts: { adding?: number; actor?: Actor } = {},
): Promise<void> {
  if (!championshipId || opts.actor?.isSuperAdmin) return;
  const plan = await eventPlanOf(db, championshipId);
  const cap = planFor('org', plan.tier).limits[key];
  if (cap === null || cap === undefined) return;
  const current = await count();
  const adding = opts.adding ?? 1;
  if (current + adding > cap) {
    throw new PlanLimitError(key, cap, current, plan.hostOrganizationId ?? undefined);
  }
}

/** Format gate: a non-default format needs advanced_formats on the event's plan. */
export async function assertFormatAllowed(
  db: Db,
  championshipId: string | null | undefined,
  formatId: string | null | undefined,
  actor?: Actor,
): Promise<void> {
  if (!championshipId || !formatId || actor?.isSuperAdmin) return;
  const fmt = await db.tournament_formats.findUnique({ where: { id: formatId }, select: { name: true } });
  if (!fmt || isDefaultFormat(fmt.name)) return;
  await assertEventCapability(db, championshipId, 'advanced_formats', actor);
}

/** Standings scheme gate. placement / ranking are the free defaults. */
export function capabilityForScheme(config: unknown): CapabilityKey | null {
  const c = (config ?? {}) as { scheme?: string; include_match_points?: boolean };
  if (c.scheme === 'custom') return 'custom_points';
  if (c.scheme === 'league_points' || c.scheme === 'medal') return 'standard_points';
  if (c.scheme === 'placement' && c.include_match_points) return 'standard_points';
  return null;
}

// ---- counters (each backed by an existing index) ---------------------------

export async function championshipOfTournamentSport(db: Db, tournamentSportId: string | null | undefined): Promise<string | null> {
  if (!tournamentSportId) return null;
  const ts = await db.tournament_sports.findUnique({
    where: { id: tournamentSportId },
    select: { tournaments: { select: { championship_id: true } } },
  });
  return ts?.tournaments?.championship_id ?? null;
}

export async function championshipOfTournament(db: Db, tournamentId: string | null | undefined): Promise<string | null> {
  if (!tournamentId) return null;
  return (await db.tournaments.findUnique({ where: { id: tournamentId }, select: { championship_id: true } }))?.championship_id ?? null;
}

export const countDraws = (db: Db, championshipId: string) =>
  db.tournament_disciplines.count({ where: { tournament_sports: { tournaments: { championship_id: championshipId } } } });

export const countDisciplinesInSport = (db: Db, tournamentSportId: string) =>
  db.tournament_disciplines.count({ where: { tournament_sport_id: tournamentSportId, discipline_id: { not: null } } });

export const countTeamsInEvent = (db: Db, championshipId: string) =>
  db.team_entries.count({ where: { championship_id: championshipId } });

export async function countParticipantsInEvent(db: Db, championshipId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    select count(distinct tm.user_id)::int as n
      from team_entries te
      join team_members tm on tm.team_id = te.team_id and tm.is_active = true
     where te.championship_id = ${championshipId}::uuid`;
  return rows[0]?.n ?? 0;
}

/**
 * Adding `adding` players to a team: checked against EVERY event the team is
 * entered in (teams and events are many-to-many), each on its own plan.
 */
export async function assertRosterRoom(db: Db, teamId: string, adding: number, actor?: Actor): Promise<void> {
  if (actor?.isSuperAdmin || adding <= 0) return;
  const entries = await db.team_entries.findMany({ where: { team_id: teamId }, select: { championship_id: true }, distinct: ['championship_id'] });
  for (const e of entries) {
    await assertEventLimit(db, e.championship_id, 'participants_per_event', () => countParticipantsInEvent(db, e.championship_id), { adding, actor });
  }
}

// ---- what the client renders -----------------------------------------------

export interface EventPlanView extends EventPlanState {
  name: string;
  capabilities: CapabilityKey[];
  limits: LimitState[];
  defaultFormats: string[];
}

/** One call for the whole event workspace: tier, lock state, granted capabilities, ceilings with usage. */
export async function eventPlanView(db: Db, championshipId: string): Promise<EventPlanView> {
  const plan = await eventPlanOf(db, championshipId);
  const keys = limitsIn('org', 'event');
  const counters: Record<string, () => Promise<number>> = {
    teams_per_event: () => countTeamsInEvent(db, championshipId),
    participants_per_event: () => countParticipantsInEvent(db, championshipId),
    draws_per_event: () => countDraws(db, championshipId),
    // Per sport, so the event-wide figure shown is the busiest sport.
    disciplines_per_sport: async () => {
      const rows = await db.$queryRaw<Array<{ n: number }>>`
        select coalesce(max(c), 0)::int as n from (
          select count(*) as c
            from tournament_disciplines td
            join tournament_sports ts on ts.id = td.tournament_sport_id
            join tournaments t on t.id = ts.tournament_id
           where t.championship_id = ${championshipId}::uuid and td.discipline_id is not null
           group by td.tournament_sport_id) s`;
      return rows[0]?.n ?? 0;
    },
  };
  const counts = await Promise.all(keys.map((k) => counters[k]?.() ?? Promise.resolve(0)));
  return {
    ...plan,
    name: planFor('org', plan.tier).name,
    capabilities: grantedCapabilities('org', plan.tier).filter((k) => CAPABILITIES[k].ladder === 'org'),
    limits: keys.map((k, i) => limitState('org', plan.tier, k, counts[i])),
    defaultFormats: catalogSettings().defaultFormats,
  };
}

// ---- creating an event -------------------------------------------------------

/**
 * Every plan check that applies to CREATING a championship, run inside the
 * creating transaction behind one advisory lock per host (org or solo person),
 * so two simultaneous creates cannot both squeeze under the same ceiling.
 * One lock key per transaction means there is no ordering to get wrong and
 * nothing to deadlock; `pg_advisory_xact_lock` releases at commit and works
 * through the transaction pooler (session-level advisory locks would not).
 *
 * Returns the stamp to write on the new row.
 */
export async function assertMayCreateEvent(
  tx: Db,
  input: { hostOrgId: string | null; userId: string; isSuperAdmin: boolean; entryLevel: string },
): Promise<{ plan_tier: Tier; plan_source: 'org' }> {
  const lockKey = `event-quota:${input.hostOrgId ?? `user:${input.userId}`}`;
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${lockKey}))`;

  const org = input.hostOrgId
    ? await tx.organizations.findUnique({ where: { id: input.hostOrgId }, select: { plan: true } })
    : null;
  const stamp = { plan_tier: ((org?.plan as Tier | undefined) ?? 'free') as Tier, plan_source: 'org' as const };
  if (input.isSuperAdmin) return stamp;

  if (input.hostOrgId) {
    await assertWithinOrgLimit(tx as never, 'active_events', input.hostOrgId, await countActiveEvents(tx as never, input.hostOrgId));
    await assertWithinOrgLimit(tx as never, 'events_total', input.hostOrgId, await countEventsTotal(tx as never, input.hostOrgId));
    const holder = { userId: input.userId, organizationId: input.hostOrgId };
    try {
      if (input.entryLevel === 'department') await assertCapability(tx as never, 'intra_department', holder);
      if (input.entryLevel === 'campus') await assertCapability(tx as never, 'intra_campus', holder);
    } catch (e) {
      if (e instanceof CapabilityRequiredError) throw new CapabilityError(e);
      throw e;
    }
    return stamp;
  }

  // A person hosting with no organisation behind them runs on the Free plan's
  // ceilings - counted over the events they organise that have no host org.
  if (!(await plansEnforced(tx as never))) return stamp;
  const free = planFor('org', 'free').limits;
  const mine = { host_organization_id: null, user_championship_roles: { some: { user_id: input.userId } } };
  const checks: Array<[LimitKey, () => Promise<number>]> = [
    ['active_events', () => tx.championships.count({ where: { ...mine, archived_at: null, status: { not: 'completed' } } })],
    ['events_total', () => tx.championships.count({ where: mine })],
  ];
  for (const [key, count] of checks) {
    const cap = free[key];
    if (cap === null || cap === undefined) continue;
    const current = await count();
    if (current >= cap) throw new PlanLimitError(key, cap, current);
  }
  return stamp;
}
