import { describe, expect, it } from 'vitest';
import { isPoolSport, poolRubber, poolTieTotals, poolTieTotalsOf, readPoolState } from './pool.js';
import { playedContests } from './played-contests.js';
import { buildTieSpec, isFrameContest, tieLayoutsFor, tieTemplateFor } from './tie-templates.js';
import { hydrateTie, initTie, reopenRubber } from './tie.js';
import { tiebreakerLabel, tiebreakerOptions } from './standings-ranking.js';
import { resolveFormat } from './format-ladder.js';

const f = (winner: 'A' | 'B', ballsLeft?: number) => ({ winner, ...(ballsLeft != null ? { ballsLeft } : {}) });

describe('pool rubbers, frame by frame', () => {
  it('knows the sport', () => {
    expect(isPoolSport('Pool/Snooker')).toBe(true);
    expect(isPoolSport('Carrom')).toBe(false);
  });

  it('a best of 5 is won at 3 frames; frames after that are ignored', () => {
    const r = poolRubber({ frames: [f('A', 3), f('B', 2), f('A', 5), f('A', 1), f('B', 7)] }, 5);
    expect(r).toMatchObject({ framesWon: [3, 1], ballsFor: [9, 2], winner: 'A', decided: true, toWin: 3 });
  });

  it('a best of 3 is won at 2, and an unrecorded ball count adds nothing', () => {
    const r = poolRubber({ frames: [f('B'), f('B', 4)] }, 3);
    expect(r).toMatchObject({ framesWon: [0, 2], ballsFor: [0, 4], winner: 'B', toWin: 2 });
    expect(poolRubber({ frames: [f('A')] }, 3)).toMatchObject({ decided: false, winner: null });
  });

  it('reads stored frames tolerantly, keeping balls within 0-8', () => {
    expect(readPoolState({ frames: [f('A', 12), { winner: 'X' }, f('B', 0), null] })).toEqual({ frames: [f('A', 8), f('B', 0)] });
    expect(readPoolState(null)).toBeNull();
  });

  it('sums a tie: frames won and balls won by, home first', () => {
    const t = poolTieTotals([
      { pool: { frames: [f('A', 2), f('A', 3), f('A', 1)] }, bestOf: 5 },
      { pool: { frames: [f('B', 6), f('A', 2), f('B', 1)] }, bestOf: 3 },
      { pool: null, bestOf: 5 },
    ]);
    expect(t).toEqual({ frames: [4, 2], balls: [8, 7] });
  });

  it('reads the totals from a saved fixture, using each rubber’s best-of from the saved layout', () => {
    const live = {
      tie: { rubbers: [{ pool: { frames: [f('A', 2), f('A', 3), f('A', 1), f('B', 8)] } }, { pool: { frames: [f('B', 4), f('B', 4)] } }] },
      tieSpec: { rubbers: [{ contest: { segMax: 5 } }, { contest: { segMax: 3 } }] },
    };
    // The 4th frame of rubber 1 came after A had 3: not counted.
    expect(poolTieTotalsOf(live)).toEqual({ frames: [3, 2], balls: [6, 8] });
    expect(poolTieTotalsOf({ tie: { rubbers: [{ winner: 'A' }] } })).toBeNull();
    expect(poolTieTotalsOf(null)).toBeNull();
  });
});

describe('pool ties', () => {
  it('the standard tie scores each rubber best of 5 frames', () => {
    const tie = tieTemplateFor('Pool/Snooker')!.tie!;
    expect(tie.rubbers).toHaveLength(5);
    expect(tie.rubbers.every((r) => isFrameContest(r.contest) && r.contest.segMax === 5)).toBe(true);
  });

  it('offers the Inter-IIM men and women layouts with their frames', () => {
    const layouts = tieLayoutsFor('Pool/Snooker');
    expect(layouts.map((l) => l.key)).toEqual(['default', 'iim_men', 'iim_women']);
    const men = layouts.find((l) => l.key === 'iim_men')!;
    expect(men.rubbers.map((r) => [r.size, r.frames])).toEqual([[2, 5], [2, 5], [1, 5], [1, 5], [1, 5]]);
    const women = layouts.find((l) => l.key === 'iim_women')!;
    expect(women.rubbers.map((r) => [r.size, r.frames])).toEqual([[2, 3], [1, 3], [1, 3]]);
  });

  it('a layout gives each rubber its own best-of', () => {
    const spec = buildTieSpec('Pool/Snooker', [{ label: 'Doubles', size: 2, frames: 3 }, { label: 'Singles', size: 1, frames: 5 }, { label: 'Singles 2', size: 1 }]);
    expect(spec.rubbers.map((r) => r.contest.segMax)).toEqual([3, 5, 5]);
    expect(spec.rubbers.every((r) => isFrameContest(r.contest))).toBe(true);
  });

  it('a rubber keeps its frames through a save and loses them on a reset', () => {
    const spec = buildTieSpec('Pool/Snooker', [{ label: 'Singles', size: 1, frames: 3 }]);
    const saved = { ...initTie(spec), rubbers: [{ ...initTie(spec).rubbers[0], pool: { frames: [f('A', 2)] } }] };
    const back = hydrateTie(JSON.parse(JSON.stringify(saved)), spec);
    expect(back.rubbers[0].pool).toEqual({ frames: [f('A', 2)] });
    expect(reopenRubber(spec, back, 0, true).rubbers[0].pool).toBeUndefined();
  });

  it('players get the frames they won in their rubber', () => {
    const played = playedContests({
      liveState: {
        tie: { rubbers: [{ key: 'ms1', lineup: { A: ['a1'], B: ['b1'] }, winner: 'A', pool: { frames: [f('A'), f('B'), f('A')] } }] },
        tieSpec: { rubbers: [{ contest: { segMax: 3 } }] },
      },
      sportName: 'Pool/Snooker', entryType: 'team', roster: { A: ['a1'], B: ['b1'] }, matchWinner: 'A',
    });
    expect(played.kind === 'contests' && played.contests[0]).toMatchObject({ frames: true, score: [2, 1] });
  });

  it('frames won and net ball difference are offered for pool team events only', () => {
    expect(tiebreakerOptions('Pool/Snooker', 'team')).toEqual(expect.arrayContaining(['frames_won', 'ball_diff']));
    expect(tiebreakerOptions('Pool/Snooker', 'individual')).not.toContain('frames_won');
    expect(tiebreakerOptions('Carrom', 'team')).not.toContain('ball_diff');
    expect(tiebreakerOptions(null)).not.toContain('frames_won');
    expect(tiebreakerLabel('ball_diff', 'Pool/Snooker', 'team')).toBe('Net ball difference');
    expect(tiebreakerLabel('frames_won', 'Pool/Snooker', 'team')).toBe('Frames won');
  });
});

// Sheet PO02: the manual result form checks a pool match against its own best-of.
describe('a pool match’s own best-of reaches the manual form', () => {
  const top = (preset: string | null) => {
    const f = resolveFormat({ round: null, stage_sequence: null }, { scoring_preset_key: preset, sport: 'Pool/Snooker' }).format!;
    return f.levels[f.levels.length - 1].target;
  };
  it('best of 3 frames is won at 2, best of 5 at 3', () => {
    expect(top('frames_bo3')).toBe(2);
    expect(top('frames_bo5')).toBe(3);
  });
});
