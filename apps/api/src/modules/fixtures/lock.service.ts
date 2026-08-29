import type { Request } from 'express';
import type { Db, Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import { recomputeStandingsForFixture } from '../standings/standings.service.js';
import { createNotification } from '../notifications/audience.js';
import { notify } from '@semp/notifications/server/notify.js';
import { Rules } from '@semp/notifications/core/rules.js';
import { advanceWinnerStrict } from './bracket.js';
import { deriveAchievements, queueCertificates, writeLifetimeEntries } from './downstream.js';
import { resolveFixtureParticipants, type FixtureParticipants } from './participants.js';
import { refreshCareerStatsForFixture } from '../records/career-stats.service.js';

// The scorecard state machine - the spine of every "verified" claim in the product.
//
//        record score            submit               lock
//   draft ─────────────▶ draft ─────────▶ submitted ─────────▶ locked
//     ▲                                       │                   │
//     └──────────── unlock (audited, reason) ─┴───────────────────┘
//
// Two rules the rest of the codebase leans on:
//
//   1. A locked scorecard is immutable. Not "the UI hides the button" - every write
//      route calls assertNotLocked, so an organiser, an official and a platform
//      admin are refused identically. Changing a locked result means unlocking it,
//      with a stated reason, on the record.
//   2. The lock either fully propagates or does not happen. Standings, the bracket
//      and every downstream artefact move inside one transaction; if any step fails,
//      the card stays exactly as it was.

export type ScorecardStatus = 'draft' | 'submitted' | 'locked';

const LOCKED_MESSAGE =
  'This scorecard is locked. A locked result can only be changed through a correction - unlock it with a reason first.';

// The guard that closes the immutability hole across the whole write surface.
// Called by /result, /live, /points, /awards and /scorecard.
export async function assertNotLocked(prisma: Db, fixtureId: string): Promise<void> {
  const fx = await prisma.fixtures.findUnique({
    where: { id: fixtureId },
    select: { scorecard_status: true },
  });
  if (fx?.scorecard_status === 'locked') throw new BusinessRuleError(LOCKED_MESSAGE);
}

// What a card must look like before it can be locked. Deliberately strict: locking is
// publishing, and an incomplete result published as Verified is worse than no badge.
function assertLockable(fx: {
  scorecard_status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  live_state: unknown;
}): void {
  if (fx.scorecard_status === 'locked') throw new BusinessRuleError('This scorecard is already locked.');

  // A walkover or a bye has no score to check - the outcome is the record.
  const decidedWithoutPlay = fx.status === 'walkover' || fx.status === 'bye';
  if (decidedWithoutPlay) return;

  // A ranking event (swimming, athletics, powerlifting) has no two sides: its
  // competitors live in live_state as individuals. Judging it by home/away made the
  // whole format unlockable - you could score a heat and never make it official,
  // which also meant the per-athlete medals of J4-E4-S6 could never be awarded. It is
  // complete when somebody has actually recorded a mark.
  const competitors = eventCompetitorsOf(fx.live_state);
  if (competitors !== null) {
    const withMarks = competitors.filter((c) => Object.values(c?.marks ?? {}).some((m) => m != null && m !== ''));
    if (withMarks.length === 0) {
      throw new BusinessRuleError('No competitor has a recorded result yet, so there is nothing to make official.');
    }
    return;
  }

  if (!fx.home_team_id || !fx.away_team_id) {
    throw new BusinessRuleError('Both teams must be set before this scorecard can be locked.');
  }
  if (fx.home_score == null || fx.away_score == null) {
    throw new BusinessRuleError('This scorecard has no score yet, so there is nothing to make official.');
  }
}

/**
 * The competitor rows of a ranking event, or null when this is an ordinary
 * head-to-head fixture. Mirrors how `resolveFixtureParticipants` reads the same
 * state, so the two cannot disagree about what counts as an event.
 */
function eventCompetitorsOf(live: unknown): Array<{ marks?: Record<string, unknown> }> | null {
  const state = live as { event?: { participants?: unknown }; participants?: unknown } | null;
  const rows = state?.event?.participants ?? state?.participants;
  return Array.isArray(rows) ? rows as Array<{ marks?: Record<string, unknown> }> : null;
}

// A label the audit trail can keep after the teams are gone: "IIMB vs IIMA, Football".
function fixtureLabel(fx: any): string {
  const home = fx.teams_fixtures_home_team_idToteams?.name ?? 'TBD';
  const away = fx.teams_fixtures_away_team_idToteams?.name ?? 'TBD';
  const sport = fx.tournament_disciplines?.tournament_sports?.sports?.name;
  const discipline = fx.tournament_disciplines?.disciplines?.name;
  const where = [sport, discipline].filter(Boolean).join(' · ');
  return where ? `${home} vs ${away}, ${where}` : `${home} vs ${away}`;
}

const FIXTURE_FOR_LOCK = {
  include: {
    teams_fixtures_home_team_idToteams: { select: { id: true, name: true, organization_id: true } },
    teams_fixtures_away_team_idToteams: { select: { id: true, name: true, organization_id: true } },
    tournament_disciplines: {
      select: {
        id: true,
        disciplines: { select: { name: true } },
        tournament_sports: {
          select: {
            sports: { select: { name: true } },
            tournaments: { select: { championship_id: true } },
          },
        },
      },
    },
  },
} as const;

const championshipOf = (fx: any): string | null =>
  fx.tournament_disciplines?.tournament_sports?.tournaments?.championship_id ?? null;

// ---------------------------------------------------------------------------
// submit: the scorer says "I'm finished"
// ---------------------------------------------------------------------------

export async function submitScorecard(prisma: Prisma, req: Request, fixtureId: string) {
  const fx = await prisma.fixtures.findUnique({ where: { id: fixtureId }, ...FIXTURE_FOR_LOCK });
  if (!fx) throw new NotFoundError('Fixture');
  if (fx.scorecard_status === 'locked') throw new BusinessRuleError(LOCKED_MESSAGE);

  const updated = await prisma.fixtures.update({
    where: { id: fx.id },
    data: { scorecard_status: 'submitted', submitted_at: new Date(), submitted_by: req.user!.id },
  });

  await audit(prisma, req, {
    action: AUDIT_ACTIONS.fixtureSubmitted,
    target: { type: 'fixtures', id: fx.id, label: fixtureLabel(fx) },
    championshipId: championshipOf(fx),
    summary: `Submitted the scorecard for ${fixtureLabel(fx)}`,
    diff: { scorecard_status: { from: fx.scorecard_status, to: 'submitted' } },
  });

  return updated;
}

// A submitted card is still the scorer's to correct - submitting is a handoff, not a
// commitment. This puts it back to draft.
export async function retractScorecard(prisma: Prisma, req: Request, fixtureId: string) {
  const fx = await prisma.fixtures.findUnique({ where: { id: fixtureId }, ...FIXTURE_FOR_LOCK });
  if (!fx) throw new NotFoundError('Fixture');
  if (fx.scorecard_status === 'locked') throw new BusinessRuleError(LOCKED_MESSAGE);

  const updated = await prisma.fixtures.update({
    where: { id: fx.id },
    data: { scorecard_status: 'draft', submitted_at: null, submitted_by: null },
  });

  await audit(prisma, req, {
    action: AUDIT_ACTIONS.fixtureRetracted,
    target: { type: 'fixtures', id: fx.id, label: fixtureLabel(fx) },
    championshipId: championshipOf(fx),
    summary: `Took the scorecard for ${fixtureLabel(fx)} back for editing`,
    diff: { scorecard_status: { from: fx.scorecard_status, to: 'draft' } },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// lock: the transaction everything else in the product hangs off
// ---------------------------------------------------------------------------

export async function lockScorecard(prisma: Prisma, req: Request, fixtureId: string) {
  // Everything that must be all-or-nothing happens in here. The audit entry and any
  // notification are deliberately OUTSIDE: an audit row describing a rolled-back lock
  // would be a lie, and an email cannot be un-sent.
  const { fx, label, championshipId, fromStatus, participants } = await prisma.$transaction(async (tx) => {
    const current = await tx.fixtures.findUnique({ where: { id: fixtureId }, ...FIXTURE_FOR_LOCK });
    if (!current) throw new NotFoundError('Fixture');
    assertLockable(current);

    // 1 · publish the verified result
    const locked = await tx.fixtures.update({
      where: { id: current.id },
      data: {
        scorecard_status: 'locked',
        locked_at: new Date(),
        locked_by: req.user!.id,
        // A played match becomes completed on lock; a walkover/bye keeps its own status.
        status: current.status === 'walkover' || current.status === 'bye' ? current.status : 'completed',
      },
    });

    // 2 · advance the bracket. Strict here - a half-propagated bracket is worse than
    //     an unlocked card, so a failure rolls the lock back.
    await advanceWinnerStrict(tx, locked.id);

    // 3 · standings. NOT best-effort at this boundary: the live path swallows
    //     recompute errors on purpose (never block a scorer mid-match), but a lock
    //     that publishes a result the table doesn't reflect is exactly the
    //     inconsistency this transaction exists to prevent.
    await recomputeStandingsForFixture(tx, locked.id);

    // 4 · who this result belongs to. Team members, plus any ranking-event
    //     competitor whose phone matches an account - resolved once, here, because
    //     this is the moment the result stops being able to change (J4-E1-S3).
    const participants = await resolveFixtureParticipants(tx, locked.id);

    // Competitors we could not match are written onto the fixture rather than
    // dropped: "3 of 14 aren't linked to an account" is something an organiser can
    // act on; silently keeping 11 is how a lifetime record quietly becomes wrong.
    if (participants.unmatched.length > 0) {
      await tx.fixtures.update({
        where: { id: locked.id },
        data: {
          live_state: {
            ...(locked.live_state as object ?? {}),
            unmatched_competitors: participants.unmatched,
          } as any,
        },
      });
    }

    // 5-7 · downstream artefacts. No-ops until modules 04 and 07 land - they exist
    //       now so those modules plug into an existing seam instead of reopening
    //       this transaction three more times, and they receive the people already
    //       resolved rather than each working it out again.
    await writeLifetimeEntries(tx, locked.id, { participants });
    await deriveAchievements(tx, locked.id, { participants });
    await queueCertificates(tx, locked.id, { participants });

    return {
      fx: locked,
      label: fixtureLabel(current),
      championshipId: championshipOf(current),
      fromStatus: current.scorecard_status,
      participants,
    };
  });

  await audit(prisma, req, {
    action: AUDIT_ACTIONS.fixtureLocked,
    target: { type: 'fixtures', id: fx.id, label },
    championshipId,
    summary: `Locked the scorecard for ${label} - the result is now official`,
    diff: {
      scorecard_status: { from: fromStatus, to: 'locked' },
      result: { from: null, to: `${fx.home_score ?? '-'}-${fx.away_score ?? '-'}` },
      lock_version: { from: fx.lock_version, to: fx.lock_version },
      participants: { from: null, to: participants.resolved.length },
      unmatched_competitors: { from: null, to: participants.unmatched.length },
    },
  });

  // Only now, once it has committed (J4-E1-S2). A notification cannot be rolled
  // back, so one sent inside the transaction would survive a failure that undid the
  // very thing it announces.
  await notifyParticipants(prisma, req, { fixture: fx, label, championshipId, participants });

  // Separate from notifyParticipants above (players) - this tells the organiser and
  // the assigned official the card is now official, matching the trigger doc's
  // "Match score locked -> Organizer/Official" row.
  if (championshipId) {
    try {
      const audience = Rules.compose([
        Rules.role('organiser', championshipId),
        ...(fx.official_id ? [Rules.directUser(fx.official_id)] : []),
      ]);
      await notify(prisma, { type: 'match_score_locked', audience, senderId: req.user!.id, data: { body: `The scorecard for ${label} is now locked.` } });
    } catch (err) {
      console.error(`[lock] match_score_locked notification failed for fixture ${fx.id}:`, err);
    }
  }

  // Career statistics, refreshed for exactly the people this result touched (J4-E3).
  // Outside the transaction and deliberately not awaited into the lock's success: the
  // lock is the fact, and a statistics table that is briefly behind must never be the
  // reason a scorecard refuses to become official. The recompute is idempotent, so the
  // next lock on any of their fixtures repairs a miss.
  await refreshCareerStatsForFixture(prisma, fx.id);

  return fx;
}

// Tell the people in the match that their result is official. Best-effort by
// design: the lock has already committed, and a notification failure must not be
// reported as a failed lock - that would be a lie in the more damaging direction.
async function notifyParticipants(
  prisma: Prisma, req: Request,
  { fixture, label, championshipId, participants }: {
    fixture: { id: string; home_score: number | null; away_score: number | null };
    label: string;
    championshipId: string | null;
    participants: FixtureParticipants;
  },
): Promise<void> {
  if (participants.resolved.length === 0) return;
  const score = fixture.home_score != null && fixture.away_score != null
    ? ` Final score ${fixture.home_score}-${fixture.away_score}.`
    : '';
  try {
    for (const p of participants.resolved) {
      await createNotification(prisma, {
        championship_id: championshipId,
        target_user_id: p.user_id,
        sender_id: req.user!.id,
        type: 'event_lifecycle',
        audience: 'all', // ignored for direct notifications - target_user_id drives visibility
        title: `Result verified: ${label}`,
        body: `The organiser has locked this scorecard, so the result is now official.${score}`,
      });
    }
  } catch (err) {
    console.error(`[lock] participant notification failed for fixture ${fixture.id}:`, err);
  }
}

// ---------------------------------------------------------------------------
// unlock: the only way a locked result changes, and it leaves a mark
// ---------------------------------------------------------------------------

export async function unlockScorecard(prisma: Prisma, req: Request, fixtureId: string, reason: string) {
  const trimmed = reason?.trim() ?? '';
  // Mandatory, and not merely "not empty": an unlock without a stated reason is the
  // precise thing the audit trail exists to prevent.
  if (trimmed.length < 5) {
    throw new BusinessRuleError('Give a reason for the correction - it is recorded against the result.');
  }

  const { fx, label, championshipId, fromVersion } = await prisma.$transaction(async (tx) => {
    const current = await tx.fixtures.findUnique({ where: { id: fixtureId }, ...FIXTURE_FOR_LOCK });
    if (!current) throw new NotFoundError('Fixture');
    if (current.scorecard_status !== 'locked') {
      throw new BusinessRuleError('This scorecard is not locked, so there is nothing to correct.');
    }

    // Back to submitted, and the version moves on so anything generated from the old
    // one (certificates, lifetime entries) can be told apart from what comes next.
    const unlocked = await tx.fixtures.update({
      where: { id: current.id },
      data: {
        scorecard_status: 'submitted',
        locked_at: null,
        locked_by: null,
        lock_version: { increment: 1 },
      },
    });

    // Reversal is by full recompute, never by subtracting a contribution - reversal
    // arithmetic is far easier to get subtly wrong than addition, and the standings
    // engine already recomputes a whole scope from scratch.
    await recomputeStandingsForFixture(tx, unlocked.id);

    // Supersede whatever the previous lock version produced (no-ops until 04/07).
    const participants = await resolveFixtureParticipants(tx, unlocked.id);
    const supersede = { supersedeVersion: current.lock_version, participants };
    await writeLifetimeEntries(tx, unlocked.id, supersede);
    await deriveAchievements(tx, unlocked.id, supersede);
    await queueCertificates(tx, unlocked.id, supersede);

    return {
      fx: unlocked,
      label: fixtureLabel(current),
      championshipId: championshipOf(current),
      fromVersion: current.lock_version,
    };
  });

  await audit(prisma, req, {
    action: AUDIT_ACTIONS.fixtureUnlocked,
    target: { type: 'fixtures', id: fx.id, label },
    championshipId,
    summary: `Unlocked the scorecard for ${label} to correct it — "${trimmed}"`,
    diff: {
      scorecard_status: { from: 'locked', to: 'submitted' },
      lock_version: { from: fromVersion, to: fx.lock_version },
      reason: { from: null, to: trimmed },
    },
  });

  // An unlock supersedes the entries and medals this fixture produced, so the career
  // totals have to come back down too. A record that keeps a medal from a result that
  // was withdrawn is precisely the thing the supersede model exists to prevent.
  await refreshCareerStatsForFixture(prisma, fx.id);

  return fx;
}

// ---------------------------------------------------------------------------
// bulk lock: per fixture, looped outside - never one transaction across fifty
// ---------------------------------------------------------------------------

export interface BulkLockResult {
  fixture_id: string;
  ok: boolean;
  error?: string;
}

// Partial success is correct here: one unlockable card must not stop the other 59.
// Each lock is its own transaction, because a single transaction spanning fifty
// fixtures would hold a pooled connection well past the 15s Lambda ceiling.
export async function lockScorecardsBulk(
  prisma: Prisma, req: Request, fixtureIds: string[],
): Promise<BulkLockResult[]> {
  const results: BulkLockResult[] = [];
  for (const id of [...new Set(fixtureIds)]) {
    try {
      await lockScorecard(prisma, req, id);
      results.push({ fixture_id: id, ok: true });
    } catch (err: any) {
      results.push({ fixture_id: id, ok: false, error: err?.message ?? 'Could not lock this scorecard' });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// the organiser's queue
// ---------------------------------------------------------------------------

export async function lockStatusForChampionship(prisma: Prisma, championshipId: string) {
  const where = {
    tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } },
  };
  const [draft, submitted, locked] = await Promise.all([
    prisma.fixtures.count({ where: { ...where, scorecard_status: 'draft' } }),
    prisma.fixtures.count({ where: { ...where, scorecard_status: 'submitted' } }),
    prisma.fixtures.count({ where: { ...where, scorecard_status: 'locked' } }),
  ]);
  return {
    draft,
    submitted,
    locked,
    total: draft + submitted + locked,
    // What the dashboard CTA counts: cards waiting for an organiser's review.
    ready_to_lock: submitted,
  };
}
