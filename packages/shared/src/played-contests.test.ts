import { describe, expect, it } from 'vitest';
import { playedContests, seatIn } from './played-contests.js';
import { presetByKey } from './racquet-presets.js';
import type { RallyEvent, RallyLog } from './rally-kernel.js';
import { tieTemplateFor } from './tie-templates.js';
import { decideRubber, hydrateTie, initTie, reopenRubber, resolveMatchLineup } from './tie.js';

const roster = { A: ['a1', 'a2', 'a3', 'a4'], B: ['b1', 'b2', 'b3', 'b4'] };
const ittf = presetByKey('ittf_bo5_11')!;
const points = (side: 'A' | 'B', n: number): RallyLog =>
  Array.from({ length: n }, () => ({ t: 'point', side }) as RallyEvent);

describe('resolveMatchLineup', () => {
  it('a roster no bigger than the match IS the lineup, in swap order', () => {
    const r = resolveMatchLineup({ pairSwap: { A: true } }, { A: ['x', 'y'], B: ['p', 'q'] }, 2);
    expect(r).toEqual({ lineup: { A: ['y', 'x'], B: ['p', 'q'] }, source: 'roster' });
  });

  it('a named lineup wins; a bigger squad with nothing named is legacy; a skip names nobody', () => {
    expect(resolveMatchLineup({ lineup: { A: ['a3'], B: ['b2'] } }, roster, 1).source).toBe('named');
    expect(resolveMatchLineup({}, roster, 1)).toEqual({ lineup: { A: ['a1'], B: ['b1'] }, source: 'legacy' });
    expect(resolveMatchLineup({ lineupSkipped: true }, roster, 1)).toEqual({ lineup: null, source: 'skipped' });
  });
});

describe('playedContests - single racquet match', () => {
  it('one contest for the named players, scored from the rally log', () => {
    const r = playedContests({
      liveState: { lineup: { A: ['a2'], B: ['b3'] }, rally: [...points('A', 11), ...points('A', 11), ...points('A', 11)], format: ittf },
      sportName: 'Table Tennis', entryType: 'team', roster, matchWinner: 'A',
    });
    expect(r.kind).toBe('contests');
    if (r.kind !== 'contests') return;
    expect(r.contests).toHaveLength(1);
    expect(r.contests[0]).toMatchObject({ rubberKey: null, lineup: { A: ['a2'], B: ['b3'] }, winner: 'A', score: [3, 0] });
  });

  it('keeps old matches and non-racquet sports on the old path', () => {
    expect(playedContests({ liveState: {}, sportName: 'Table Tennis', entryType: 'team', roster, matchWinner: 'A' }).kind).toBe('legacy');
    expect(playedContests({ liveState: {}, sportName: 'Football', entryType: 'team', roster, matchWinner: 'A' }).kind).toBe('legacy');
  });

  it('a skipped lineup credits nobody', () => {
    const r = playedContests({ liveState: { lineupSkipped: true }, sportName: 'Badminton', entryType: 'team', roster, matchWinner: 'A' });
    expect(r).toEqual({ kind: 'contests', contests: [] });
  });
});

describe('playedContests - team tie', () => {
  const spec = tieTemplateFor('table tennis')!.tie!;

  it('one contest per rubber with players named; skipped and dead rubbers credit nobody', () => {
    let s = initTie(spec);
    s.rubbers[0] = { ...s.rubbers[0], lineup: { A: ['a1'], B: ['b1'] }, rally: points('A', 33), format: ittf, firstServer: 'A' };
    s = decideRubber(spec, s, 0, 'A');
    s.rubbers[1] = { ...s.rubbers[1], lineupSkipped: true };
    s = decideRubber(spec, s, 1, 'B');
    s.rubbers[2] = { ...s.rubbers[2], lineup: { A: ['a2', 'a3'], B: ['b2', 'b3'] } };
    s = decideRubber(spec, s, 2, 'B');

    const r = playedContests({ liveState: { tie: s }, sportName: 'Table Tennis', entryType: 'team', roster, matchWinner: null });
    expect(r.kind).toBe('contests');
    if (r.kind !== 'contests') return;
    expect(r.contests.map((c) => [c.rubberKey, c.winner])).toEqual([['ms', 'A'], ['md', 'B']]);
    expect(r.contests[0].score).toEqual([3, 0]);
    expect(seatIn(r.contests[1], 'a3')).toEqual({ side: 'A', partner: 'a2', opponents: ['b2', 'b3'], position: 'doubles' });
  });

  it('a tie nobody named anyone in stays on the old path', () => {
    const s = decideRubber(spec, initTie(spec), 0, 'A');
    expect(playedContests({ liveState: { tie: s }, sportName: 'Table Tennis', entryType: 'team', roster, matchWinner: null }).kind).toBe('legacy');
  });

  it('players, points and rules survive a save and reload; a fresh re-score clears points only', () => {
    let s = initTie(spec);
    s.rubbers[0] = { ...s.rubbers[0], lineup: { A: ['a1'], B: ['b1'] }, rally: points('B', 5), format: ittf, firstServer: 'B' };
    const back = hydrateTie(JSON.parse(JSON.stringify(s)), spec);
    expect(back.rubbers[0]).toMatchObject({ lineup: { A: ['a1'], B: ['b1'] }, firstServer: 'B' });
    expect(back.rubbers[0].rally).toHaveLength(5);
    s = reopenRubber(spec, decideRubber(spec, back, 0, 'B'), 0, true);
    expect(s.rubbers[0].rally).toBeUndefined();
    expect(s.rubbers[0].lineup).toEqual({ A: ['a1'], B: ['b1'] });
  });
});
