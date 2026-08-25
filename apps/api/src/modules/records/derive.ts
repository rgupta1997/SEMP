import {
  PLACEMENT_LABEL, MEDAL_LABEL, rankSubEvent,
  type AchievementKind, type EventSpec, type EventState, type FormatTemplate,
  type LifetimeEntryKind, type Medal, type StandingsPlacement,
} from '@semp/shared';

// What a locked result MEANS - as pure functions, with no database anywhere in
// sight (J4-E2, J4-E4).
//
// This is deliberately separated from the writing of it. The rules encoded here
// are the ones an institution will be asked to defend years later ("why does her
// profile say Semi-finalist?"), and rules you can only exercise by locking a real
// fixture against a real Postgres are rules nobody tests. Everything below takes
// a plain snapshot and returns plain drafts; `records.service.ts` is the only
// part that talks to Prisma.
//
// Two decisions worth knowing before reading:
//
// 1. AN ACHIEVEMENT RECORDS WHAT ITS FIXTURE DECIDED - never a floor.
//    `standings/domain/schemes.ts` awards placement points progressively: win a
//    quarter-final and you immediately bank the "semi-finalist" floor, because
//    points must accrue as the bracket unfolds. That is right for a points table
//    and wrong for a permanent record - it would leave a champion's profile
//    reading "Semi-finalist, Runner-up AND Winner" for one campaign. So here,
//    each fixture writes only the outcome it settled: the final decides gold and
//    silver, and every other knockout round records the player it ELIMINATED.
//
// 2. THE TIMELINE IS ONE ENTRY PER PERSON PER FIXTURE. Medals, placements and
//    awards ride on it as chips rather than as extra rows (J4-E2-S1: "one entry
//    per event ... and any medal or honour chips"). The countable, queryable
//    copies live in `achievements`, which is what a report groups by. One event
//    the player attended = one line on their timeline, however many honours came
//    out of it.

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

/** A participant of a locked fixture, already resolved to a real account. */
export interface DerivableParticipant {
  user_id: string;
  /** Set for team matches; null for an individual competitor in a ranking event. */
  team_id: string | null;
  /** Who they represented at the time - denormalised onto every record. */
  organization_id: string | null;
  /** The `live_state` competitor row this person matched, for ranking events. */
  competitor_id: string | null;
  name: string;
}

export interface DerivableAward {
  recipient_user_id: string;
  /** The free text as recorded - the fallback when nothing was picked. */
  award_name: string;
  /** Catalogue code, when the official chose from the catalogue (J4-E4-S2). */
  award_type_code: string | null;
  award_type_label: string | null;
}

/** Everything about a fixture the derivation needs, flattened at the call site. */
export interface DerivableFixture {
  id: string;
  round: string | null;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  occurred_on: Date;
  lock_version: number;
  championship_id: string | null;
  championship_name: string | null;
  sport_id: string | null;
  sport_name: string | null;
  discipline_name: string | null;
  /** `tournament_disciplines.format_config` - carries the EventSpec for a ranking event. */
  format_config: unknown;
  /** `fixtures.live_state` - carries ranking-event competitors and their marks. */
  live_state: unknown;
}

export interface DeriveInput {
  fixture: DerivableFixture;
  participants: DerivableParticipant[];
  awards: DerivableAward[];
}

// ---------------------------------------------------------------------------
// outputs
// ---------------------------------------------------------------------------

/** A chip shown on the timeline entry, mirroring an achievement row. */
export interface RecordChip {
  kind: AchievementKind;
  title: string;
  medal?: Medal;
  placement?: StandingsPlacement;
}

export interface AchievementDraft {
  user_id: string | null;
  team_id: string | null;
  organization_id: string | null;
  kind: AchievementKind;
  medal: Medal | null;
  title: string;
  detail: Record<string, unknown>;
}

export interface LifetimeEntryDraft {
  user_id: string;
  organization_id: string | null;
  kind: LifetimeEntryKind;
  title: string;
  detail: Record<string, unknown>;
}

export interface DerivedRecords {
  entries: LifetimeEntryDraft[];
  achievements: AchievementDraft[];
}

// ---------------------------------------------------------------------------
// what a round decides
// ---------------------------------------------------------------------------

type Verdict =
  | { team_id: string; kind: 'medal'; medal: Medal; placement: StandingsPlacement }
  | { team_id: string; kind: 'placement'; placement: StandingsPlacement };

/**
 * The outcome a single knockout fixture SETTLES, for the teams it settled it for.
 *
 * Nothing is emitted for a team that merely advanced - their result is decided by
 * the round they lose in, or by the final. That is the whole difference between
 * this and the standings scheme's progressive floors (see note 1 at the top).
 */
export function verdictsOf(fx: Pick<DerivableFixture, 'round' | 'status' | 'winner_team_id' | 'home_team_id' | 'away_team_id'>): Verdict[] {
  // A bye settles nothing: nobody was beaten, and the team that advanced will be
  // judged by the round they actually play.
  if (fx.status === 'bye' || !fx.winner_team_id) return [];

  const winner = fx.winner_team_id;
  const loser = fx.home_team_id === winner ? fx.away_team_id : fx.home_team_id;
  const round = (fx.round ?? '').trim();

  switch (round) {
    case 'Final':
      return [
        { team_id: winner, kind: 'medal', medal: 'gold', placement: 'winner' },
        ...(loser ? [{ team_id: loser, kind: 'medal', medal: 'silver', placement: 'runner_up' } as Verdict] : []),
      ];
    case '3rd Place':
      return [
        { team_id: winner, kind: 'medal', medal: 'bronze', placement: 'third_place' },
        ...(loser ? [{ team_id: loser, kind: 'placement', placement: 'fourth_place' } as Verdict] : []),
      ];
    // The eliminated side, and only them. The winner goes on to be judged later.
    case 'SF':
      return loser ? [{ team_id: loser, kind: 'placement', placement: 'semi_finalist' }] : [];
    case 'QF':
      return loser ? [{ team_id: loser, kind: 'placement', placement: 'quarter_finalist' }] : [];
    // League fixtures and early rounds (R16, R32, …) decide no placement - a
    // league is settled by the standings table, not by any one match.
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// ranking events: medals per competitor
// ---------------------------------------------------------------------------

const MEDAL_BY_RANK: Record<number, Medal> = { 1: 'gold', 2: 'silver', 3: 'bronze' };

function eventSpecOf(formatConfig: unknown): EventSpec | null {
  const scoring = (formatConfig as { scoring?: FormatTemplate } | null)?.scoring;
  return scoring?.event ?? null;
}

function eventStateOf(liveState: unknown): EventState | null {
  const ls = liveState as { event?: { participants?: unknown }; participants?: unknown } | null;
  const participants = ls?.event?.participants ?? ls?.participants;
  return Array.isArray(participants) ? ({ participants } as EventState) : null;
}

/**
 * Per-competitor medals for a ranking event (swimming, athletics, powerlifting).
 *
 * Ranks each sub-event with the SAME function the console and the standings
 * service use (`rankSubEvent`), so a swimmer's profile and the medal tally can
 * never disagree about who came first - including on the shared-place tie rule.
 *
 * Returns competitor-row ids, because that is the only handle a `live_state`
 * competitor has; the caller maps them back to accounts.
 */
export function eventMedals(fx: Pick<DerivableFixture, 'format_config' | 'live_state'>): Array<{ competitor_id: string; medal: Medal; sub_event: string }> {
  const spec = eventSpecOf(fx.format_config);
  const state = eventStateOf(fx.live_state);
  if (!spec || !state || state.participants.length === 0) return [];
  // 'sumBest' totals marks into a team score - there is no per-athlete placing to
  // award a medal from. `detailedContributions` skips medals for the same reason.
  if (spec.result.aggregate === 'sumBest') return [];

  const out: Array<{ competitor_id: string; medal: Medal; sub_event: string }> = [];
  for (const se of spec.subEvents) {
    for (const [competitorId, rank] of rankSubEvent(spec, state, se.key)) {
      const medal = MEDAL_BY_RANK[rank];
      if (medal) out.push({ competitor_id: competitorId, medal, sub_event: se.label || se.key });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// the derivation
// ---------------------------------------------------------------------------

const outcomeFor = (fx: DerivableFixture, teamId: string | null): 'won' | 'lost' | 'drew' | null => {
  if (!teamId || !fx.home_team_id || !fx.away_team_id) return null;
  if (fx.winner_team_id) return fx.winner_team_id === teamId ? 'won' : 'lost';
  if (fx.home_score != null && fx.away_score != null && fx.home_score === fx.away_score) return 'drew';
  return null;
};

/** "Badminton · Mens Singles" - the context every record needs and no lookup provides later. */
const contextLabel = (fx: DerivableFixture): string =>
  [fx.sport_name, fx.discipline_name].filter(Boolean).join(' · ') || 'Event';

/** The headline on a timeline row: "IIMB vs IIMA — Won 3-1", or the event's name. */
function entryTitle(fx: DerivableFixture, teamId: string | null): string {
  const context = contextLabel(fx);
  if (!fx.home_team_name && !fx.away_team_name) return context;

  const mine = teamId && teamId === fx.away_team_id ? fx.away_team_name : fx.home_team_name;
  const theirs = teamId && teamId === fx.away_team_id ? fx.home_team_name : fx.away_team_name;
  const versus = `${mine ?? 'TBD'} vs ${theirs ?? 'TBD'}`;

  if (fx.status === 'walkover') return `${versus} — Walkover`;
  if (fx.status === 'bye') return `${versus} — Bye`;

  const outcome = outcomeFor(fx, teamId);
  const myScore = teamId && teamId === fx.away_team_id ? fx.away_score : fx.home_score;
  const theirScore = teamId && teamId === fx.away_team_id ? fx.home_score : fx.away_score;
  const score = myScore != null && theirScore != null ? ` ${myScore}-${theirScore}` : '';
  const verb = outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : outcome === 'drew' ? 'Drew' : null;
  return verb ? `${versus} — ${verb}${score}` : versus;
}

/**
 * Everything a locked fixture writes into the permanent record.
 *
 * Pure and total: same snapshot in, same drafts out, no ordering surprises and
 * nothing that can half-succeed. The caller runs it inside the lock transaction
 * and writes the result; if this throws, the lock rolls back and the scorecard
 * stays exactly as it was.
 */
export function deriveRecords({ fixture: fx, participants, awards }: DeriveInput): DerivedRecords {
  const achievements: AchievementDraft[] = [];
  const chipsByUser = new Map<string, RecordChip[]>();
  const addChip = (userId: string, chip: RecordChip) => {
    const list = chipsByUser.get(userId) ?? [];
    list.push(chip);
    chipsByUser.set(userId, list);
  };

  const context = contextLabel(fx);
  const eventLabel = [fx.championship_name, context].filter(Boolean).join(' — ');

  const byTeam = new Map<string, DerivableParticipant[]>();
  for (const p of participants) {
    if (!p.team_id) continue;
    byTeam.set(p.team_id, [...(byTeam.get(p.team_id) ?? []), p]);
  }
  const orgOfTeam = (teamId: string): string | null =>
    byTeam.get(teamId)?.find((p) => p.organization_id)?.organization_id ?? null;

  const teamName = (teamId: string): string | null =>
    teamId === fx.home_team_id ? fx.home_team_name : teamId === fx.away_team_id ? fx.away_team_name : null;

  // ---- 1 · knockout medals and placements (J4-E4-S1) -----------------------
  for (const v of verdictsOf(fx)) {
    const medal = v.kind === 'medal' ? v.medal : null;
    const title = medal
      ? `${MEDAL_LABEL[medal]} — ${eventLabel}`
      : `${PLACEMENT_LABEL[v.placement]} — ${eventLabel}`;
    const detail = {
      placement: v.placement,
      round: fx.round,
      sport: fx.sport_name,
      discipline: fx.discipline_name,
      championship_name: fx.championship_name,
      team_name: teamName(v.team_id),
    };

    // The squad's own row. Its members each get one too, immediately below: a
    // player who later transfers keeps the medal, because it was written to them
    // and not inferred from a roster that has since moved on.
    achievements.push({
      user_id: null,
      team_id: v.team_id,
      organization_id: orgOfTeam(v.team_id),
      kind: v.kind,
      medal,
      title,
      detail,
    });

    for (const p of byTeam.get(v.team_id) ?? []) {
      achievements.push({
        user_id: p.user_id,
        team_id: null,
        organization_id: p.organization_id,
        kind: v.kind,
        medal,
        title,
        detail: { ...detail, via_team_id: v.team_id },
      });
      addChip(p.user_id, {
        kind: v.kind,
        title: medal ? MEDAL_LABEL[medal] : PLACEMENT_LABEL[v.placement],
        ...(medal ? { medal } : {}),
        placement: v.placement,
      });
    }
  }

  // ---- 2 · ranking events: medals per competitor (J4-E4-S1) ----------------
  const byCompetitor = new Map<string, DerivableParticipant>();
  for (const p of participants) if (p.competitor_id) byCompetitor.set(p.competitor_id, p);

  for (const m of eventMedals(fx)) {
    const p = byCompetitor.get(m.competitor_id);
    // A competitor whose phone matched no account earns no achievement - they are
    // already recorded on the fixture as unmatched, which is an organiser's cue to
    // link them rather than a number quietly going missing.
    if (!p) continue;
    const title = `${MEDAL_LABEL[m.medal]} — ${m.sub_event}${fx.championship_name ? `, ${fx.championship_name}` : ''}`;
    achievements.push({
      user_id: p.user_id,
      team_id: null,
      organization_id: p.organization_id,
      kind: 'medal',
      medal: m.medal,
      title,
      detail: {
        sub_event: m.sub_event,
        sport: fx.sport_name,
        discipline: fx.discipline_name,
        championship_name: fx.championship_name,
      },
    });
    addChip(p.user_id, { kind: 'medal', title: `${MEDAL_LABEL[m.medal]} · ${m.sub_event}`, medal: m.medal });
  }

  // ---- 3 · awards (J4-E4-S2) ----------------------------------------------
  const participantById = new Map(participants.map((p) => [p.user_id, p]));
  for (const a of awards) {
    const p = participantById.get(a.recipient_user_id);
    // The award's own name is the title: a catalogue label when one was picked,
    // otherwise the free text exactly as typed. `award_type_code` is what a report
    // groups on, so "POTM" typed by hand stays visible without ever being counted
    // as something it was not.
    const label = a.award_type_label ?? a.award_name;
    achievements.push({
      user_id: a.recipient_user_id,
      team_id: null,
      organization_id: p?.organization_id ?? null,
      kind: 'award',
      medal: null,
      title: `${label} — ${eventLabel}`,
      detail: {
        award_type_code: a.award_type_code,
        award_name: a.award_name,
        sport: fx.sport_name,
        discipline: fx.discipline_name,
        championship_name: fx.championship_name,
      },
    });
    addChip(a.recipient_user_id, { kind: 'award', title: label });
  }

  // ---- 4 · the timeline: one entry per person (J4-E2-S1) -------------------
  const entries: LifetimeEntryDraft[] = participants.map((p) => {
    const outcome = outcomeFor(fx, p.team_id);
    const decided = outcome != null || fx.status === 'walkover' || fx.status === 'bye';
    const chips = chipsByUser.get(p.user_id) ?? [];
    return {
      user_id: p.user_id,
      organization_id: p.organization_id,
      // 'result' when the fixture settled something for them; a heat swum with no
      // head-to-head outcome is participation, and saying otherwise would put a
      // result on a record that has none.
      kind: decided ? 'result' : 'participation',
      title: entryTitle(fx, p.team_id),
      detail: {
        role: p.team_id ? 'player' : 'competitor',
        team_id: p.team_id,
        team_name: p.team_id ? teamName(p.team_id) : null,
        opponent_name: p.team_id
          ? (p.team_id === fx.home_team_id ? fx.away_team_name : fx.home_team_name)
          : null,
        outcome,
        score: fx.home_score != null && fx.away_score != null ? `${fx.home_score}-${fx.away_score}` : null,
        round: fx.round,
        sport: fx.sport_name,
        discipline: fx.discipline_name,
        championship_name: fx.championship_name,
        fixture_status: fx.status,
        // The medal/honour chips J4-E2-S1 asks for, denormalised so the timeline
        // renders from one row and does not need a join to `achievements`.
        chips,
      },
    };
  });

  return { entries, achievements };
}
