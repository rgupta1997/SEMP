import { describe, it, expect } from 'vitest';
import { deriveRecords, eventMedals, verdictsOf, type DeriveInput, type DerivableFixture, type DerivableParticipant } from './derive.js';

// These tests are the specification for what a locked result means. Every case
// here is one an institution could be asked to defend from a player's profile
// years after the championship folded.

const FIXTURE: DerivableFixture = {
  id: 'fx1',
  round: 'Final',
  status: 'completed',
  home_team_id: 'tA', away_team_id: 'tB',
  home_team_name: 'IIMB', away_team_name: 'IIMA',
  home_score: 3, away_score: 1,
  winner_team_id: 'tA',
  occurred_on: new Date('2026-08-16T00:00:00Z'),
  lock_version: 0,
  championship_id: 'champ1', championship_name: 'Inter-College 2026',
  sport_id: 'sp1', sport_name: 'Football', discipline_name: 'Mens',
  format_config: null,
  live_state: null,
};

const SQUAD: DerivableParticipant[] = [
  { user_id: 'u1', team_id: 'tA', organization_id: 'o1', competitor_id: null, name: 'Winner One' },
  { user_id: 'u2', team_id: 'tA', organization_id: 'o1', competitor_id: null, name: 'Winner Two' },
  { user_id: 'u3', team_id: 'tB', organization_id: 'o2', competitor_id: null, name: 'Loser One' },
];

const input = (fx: Partial<DerivableFixture> = {}, over: Partial<DeriveInput> = {}): DeriveInput => ({
  fixture: { ...FIXTURE, ...fx },
  participants: SQUAD,
  awards: [],
  ...over,
});

// ---------------------------------------------------------------------------

describe('verdictsOf · what a round settles', () => {
  it('a final decides gold and silver', () => {
    expect(verdictsOf(FIXTURE)).toEqual([
      { team_id: 'tA', kind: 'medal', medal: 'gold', placement: 'winner' },
      { team_id: 'tB', kind: 'medal', medal: 'silver', placement: 'runner_up' },
    ]);
  });

  it('a third-place playoff decides bronze, and fourth for the loser', () => {
    const v = verdictsOf({ ...FIXTURE, round: '3rd Place' });
    expect(v).toEqual([
      { team_id: 'tA', kind: 'medal', medal: 'bronze', placement: 'third_place' },
      { team_id: 'tB', kind: 'placement', placement: 'fourth_place' },
    ]);
  });

  // The single most important rule in this file. The standings engine awards a
  // "semi-finalist floor" to a team that WINS a quarter-final, because points
  // must accrue as the bracket unfolds. Copying that here would leave a
  // champion's permanent profile reading Quarter-finalist, Semi-finalist,
  // Runner-up AND Winner for one campaign.
  it('records only the eliminated side in earlier knockout rounds', () => {
    expect(verdictsOf({ ...FIXTURE, round: 'SF' })).toEqual([
      { team_id: 'tB', kind: 'placement', placement: 'semi_finalist' },
    ]);
    expect(verdictsOf({ ...FIXTURE, round: 'QF' })).toEqual([
      { team_id: 'tB', kind: 'placement', placement: 'quarter_finalist' },
    ]);
  });

  it('gives a semi-final winner nothing - the final decides them', () => {
    const v = verdictsOf({ ...FIXTURE, round: 'SF' });
    expect(v.some((x) => x.team_id === 'tA')).toBe(false);
  });

  it('settles nothing for a league fixture, an early round, or a bye', () => {
    expect(verdictsOf({ ...FIXTURE, round: 'League' })).toEqual([]);
    expect(verdictsOf({ ...FIXTURE, round: 'R16' })).toEqual([]);
    expect(verdictsOf({ ...FIXTURE, round: null })).toEqual([]);
    expect(verdictsOf({ ...FIXTURE, status: 'bye' })).toEqual([]);
  });

  it('settles nothing when no winner was declared', () => {
    expect(verdictsOf({ ...FIXTURE, winner_team_id: null })).toEqual([]);
  });

  it('still decides a final won by walkover', () => {
    const v = verdictsOf({ ...FIXTURE, status: 'walkover' });
    expect(v[0]).toMatchObject({ team_id: 'tA', medal: 'gold' });
  });
});

// ---------------------------------------------------------------------------

describe('deriveRecords · knockout medals fan out to the squad (J4-E4-S1)', () => {
  it('writes the squad row and one row per member', () => {
    const { achievements } = deriveRecords(input());

    const teamGold = achievements.filter((a) => a.team_id === 'tA' && a.medal === 'gold');
    expect(teamGold).toHaveLength(1);
    expect(teamGold[0].user_id).toBeNull();
    expect(teamGold[0].organization_id).toBe('o1');

    const memberGold = achievements.filter((a) => a.medal === 'gold' && a.user_id);
    expect(memberGold.map((a) => a.user_id).sort()).toEqual(['u1', 'u2']);
    // Attributed to the person, with a breadcrumb back to the squad - so the
    // medal survives the player transferring out of that team.
    expect(memberGold[0].detail.via_team_id).toBe('tA');
    expect(memberGold[0].team_id).toBeNull();
  });

  it('gives the losing squad silver, attributed to their own organisation', () => {
    const { achievements } = deriveRecords(input());
    const silver = achievements.filter((a) => a.medal === 'silver' && a.user_id === 'u3');
    expect(silver).toHaveLength(1);
    expect(silver[0].organization_id).toBe('o2');
  });

  it('titles a placement without inventing a medal', () => {
    const { achievements } = deriveRecords(input({ round: 'SF' }));
    const rows = achievements.filter((a) => a.kind === 'placement');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.medal).toBeNull();
      expect(r.title).toContain('Semi-finalist');
      expect(r.detail.placement).toBe('semi_finalist');
    }
    // Only the eliminated side - nobody from the winning squad.
    expect(rows.every((r) => r.user_id !== 'u1' && r.user_id !== 'u2')).toBe(true);
  });

  it('writes no achievement at all for a league fixture', () => {
    expect(deriveRecords(input({ round: 'League' })).achievements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('deriveRecords · the timeline (J4-E2-S1)', () => {
  it('writes exactly one entry per participant, whatever they won', () => {
    const { entries } = deriveRecords(input());
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.user_id).sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('states the result from that person\'s own side', () => {
    const { entries } = deriveRecords(input());
    const winner = entries.find((e) => e.user_id === 'u1')!;
    const loser = entries.find((e) => e.user_id === 'u3')!;

    expect(winner.title).toBe('IIMB vs IIMA — Won 3-1');
    expect(winner.detail.outcome).toBe('won');
    // The same fixture, read from the other dressing room.
    expect(loser.title).toBe('IIMA vs IIMB — Lost 1-3');
    expect(loser.detail.outcome).toBe('lost');
    expect(loser.detail.opponent_name).toBe('IIMB');
  });

  it('carries medals as chips rather than as extra rows', () => {
    const { entries } = deriveRecords(input());
    const winner = entries.find((e) => e.user_id === 'u1')!;
    expect(winner.detail.chips).toEqual([
      expect.objectContaining({ kind: 'medal', medal: 'gold', title: 'Gold' }),
    ]);
  });

  it('marks a scored fixture as a result and an undecided one as participation', () => {
    expect(deriveRecords(input()).entries[0].kind).toBe('result');
    const drawn = deriveRecords(input({ winner_team_id: null, home_score: 2, away_score: 2 }));
    expect(drawn.entries[0].kind).toBe('result');
    expect(drawn.entries[0].detail.outcome).toBe('drew');
    const unscored = deriveRecords(input({ winner_team_id: null, home_score: null, away_score: null }));
    expect(unscored.entries[0].kind).toBe('participation');
  });

  it('denormalises the context so the entry survives the championship being deleted', () => {
    const { entries } = deriveRecords(input());
    expect(entries[0].detail).toMatchObject({
      sport: 'Football', discipline: 'Mens', championship_name: 'Inter-College 2026', team_name: 'IIMB',
    });
    expect(entries[0].organization_id).toBe('o1');
  });
});

// ---------------------------------------------------------------------------

describe('deriveRecords · awards (J4-E4-S2)', () => {
  const awards = [
    { recipient_user_id: 'u1', award_name: 'Player of the Match', award_type_code: 'player_of_the_match', award_type_label: 'Player of the Match' },
    { recipient_user_id: 'u2', award_name: 'POTM', award_type_code: null, award_type_label: null },
  ];

  it('records the catalogue code so the award is countable', () => {
    const { achievements } = deriveRecords(input({}, { awards }));
    const typed = achievements.find((a) => a.kind === 'award' && a.user_id === 'u1')!;
    expect(typed.detail.award_type_code).toBe('player_of_the_match');
    expect(typed.title).toContain('Player of the Match');
  });

  it('keeps free text exactly as typed, and refuses to guess a type for it', () => {
    const { achievements } = deriveRecords(input({}, { awards }));
    const free = achievements.find((a) => a.kind === 'award' && a.user_id === 'u2')!;
    expect(free.detail.award_type_code).toBeNull();
    expect(free.detail.award_name).toBe('POTM');
    expect(free.title).toContain('POTM');
  });

  it('shows the award as a chip on the recipient\'s timeline entry', () => {
    const { entries } = deriveRecords(input({}, { awards }));
    const u1 = entries.find((e) => e.user_id === 'u1')!;
    expect(u1.detail.chips).toContainEqual(expect.objectContaining({ kind: 'award', title: 'Player of the Match' }));
  });

  it('records an award for someone who is not a listed participant', () => {
    const { achievements } = deriveRecords(input({}, {
      awards: [{ recipient_user_id: 'guest', award_name: 'Fair Play', award_type_code: 'fair_play', award_type_label: 'Fair Play' }],
    }));
    const row = achievements.find((a) => a.user_id === 'guest')!;
    expect(row).toBeDefined();
    expect(row.organization_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('ranking events · medals per competitor (J4-E1-S3 + J4-E4-S1)', () => {
  const EVENT_FIXTURE: Partial<DerivableFixture> = {
    round: null,
    home_team_id: null, away_team_id: null,
    home_team_name: null, away_team_name: null,
    home_score: null, away_score: null,
    winner_team_id: null,
    sport_name: 'Swimming', discipline_name: '50m Freestyle',
    format_config: {
      scoring: {
        fixtureType: 'event', scoringMode: 'detailed',
        event: {
          subEvents: [{ key: 'r50', label: '50m Freestyle' }],
          result: { resultType: 'time', winnerIs: 'min', unit: 's', aggregate: 'medals', medalPoints: [5, 3, 1] },
        },
      },
    },
    live_state: {
      event: {
        participants: [
          { id: 'c1', name: 'Fast Swimmer', orgId: 'o1', marks: { r50: 24.1 } },
          { id: 'c2', name: 'Second Swimmer', orgId: 'o1', marks: { r50: 25.0 } },
          { id: 'c3', name: 'Third Swimmer', orgId: 'o2', marks: { r50: 26.2 } },
          { id: 'c4', name: 'Fourth Swimmer', orgId: 'o2', marks: { r50: 27.9 } },
        ],
      },
    },
  };

  const COMPETITORS: DerivableParticipant[] = [
    { user_id: 'su1', team_id: null, organization_id: 'o1', competitor_id: 'c1', name: 'Fast Swimmer' },
    { user_id: 'su3', team_id: null, organization_id: 'o2', competitor_id: 'c3', name: 'Third Swimmer' },
  ];

  it('ranks with the same function the console and standings use', () => {
    const medals = eventMedals({ ...FIXTURE, ...EVENT_FIXTURE } as DerivableFixture);
    expect(medals).toEqual([
      { competitor_id: 'c1', medal: 'gold', sub_event: '50m Freestyle' },
      { competitor_id: 'c2', medal: 'silver', sub_event: '50m Freestyle' },
      { competitor_id: 'c3', medal: 'bronze', sub_event: '50m Freestyle' },
    ]);
  });

  it('awards a medal only to competitors matched to an account', () => {
    const { achievements } = deriveRecords(input(EVENT_FIXTURE, { participants: COMPETITORS }));
    // c2 took silver but matched no account - no achievement, and nothing invented.
    expect(achievements.map((a) => ({ u: a.user_id, m: a.medal }))).toEqual([
      { u: 'su1', m: 'gold' },
      { u: 'su3', m: 'bronze' },
    ]);
  });

  it('files a competitor with no head-to-head as participation, with the medal as a chip', () => {
    const { entries } = deriveRecords(input(EVENT_FIXTURE, { participants: COMPETITORS }));
    const gold = entries.find((e) => e.user_id === 'su1')!;
    expect(gold.kind).toBe('participation');
    expect(gold.detail.role).toBe('competitor');
    expect(gold.title).toBe('Swimming · 50m Freestyle');
    expect(gold.detail.chips).toEqual([
      expect.objectContaining({ medal: 'gold', title: 'Gold · 50m Freestyle' }),
    ]);
  });

  it('awards no per-athlete medal when the event totals marks into a team score', () => {
    const cfg: any = structuredClone(EVENT_FIXTURE.format_config);
    cfg.scoring.event.result.aggregate = 'sumBest';
    expect(eventMedals({ ...FIXTURE, ...EVENT_FIXTURE, format_config: cfg } as DerivableFixture)).toEqual([]);
  });

  it('is inert on a fixture with no event spec or no competitors', () => {
    expect(eventMedals(FIXTURE)).toEqual([]);
    expect(eventMedals({ ...FIXTURE, ...EVENT_FIXTURE, live_state: { event: { participants: [] } } } as DerivableFixture)).toEqual([]);
  });

  it('honours the shared-place tie rule rather than inventing a tiebreak', () => {
    const tied: any = structuredClone(EVENT_FIXTURE.live_state);
    tied.event.participants[1].marks.r50 = 24.1; // dead heat for first
    const medals = eventMedals({ ...FIXTURE, ...EVENT_FIXTURE, live_state: tied } as DerivableFixture);
    // Two golds, no silver - the same 1-2-2-4 rule the medal tally already applies.
    expect(medals.filter((m) => m.medal === 'gold')).toHaveLength(2);
    expect(medals.some((m) => m.medal === 'silver')).toBe(false);
    expect(medals.filter((m) => m.medal === 'bronze')).toHaveLength(1);
  });
});
