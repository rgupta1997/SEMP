import { describe, expect, it } from 'vitest';
import {
  formatIdsForDraw, matchRoundRule, parseRoundFormats, predictKnockoutRounds,
  resolveFormat, resolveRounds, type LadderFormatRow,
} from './format-ladder.js';
import { presetByKey } from './racquet-presets.js';

const sprint = presetByKey('sprint_9_serve3')!;
const ittf = presetByKey('ittf_bo5_11')!;
const classic21 = presetByKey('legacy_21_bo3')!;

const rows: LadderFormatRow[] = [
  { id: 'f-sprint', config: sprint, name: sprint.name },
  { id: 'f-ittf', config: ittf, name: ittf.name },
  { id: 'f-21', config: classic21, name: classic21.name },
];

describe('the resolution ladder', () => {
  it('falls back to a REAL sport default, not a generic counter', () => {
    const r = resolveFormat({}, { sport: 'table tennis' }, rows);
    expect(r.layer).toBe('sportDefault');
    expect(r.format?.levels[0].target).toBe(11);
    expect(r.format?.levels[0].winBy).toBe(2);
  });

  it('prefers the draw over the sport default', () => {
    const r = resolveFormat({}, { sport: 'table tennis', scoring_format_id: 'f-sprint' }, rows);
    expect(r.layer).toBe('draw');
    expect(r.format?.presetKey).toBe('sprint_9_serve3');
  });

  it('prefers the fixture over everything configurable', () => {
    const r = resolveFormat(
      { scoring_format_id: 'f-21' },
      { sport: 'table tennis', scoring_format_id: 'f-sprint' },
      rows,
    );
    expect(r.layer).toBe('fixture');
    expect(r.format?.presetKey).toBe('legacy_21_bo3');
  });

  it('freezes the rules a scored match was played under, beating a later edit', () => {
    const r = resolveFormat(
      { scoring_format_id: 'f-21', frozen_format: sprint },
      { sport: 'table tennis', scoring_format_id: 'f-ittf' },
      rows,
    );
    expect(r.layer).toBe('frozen');
    expect(r.format?.presetKey).toBe('sprint_9_serve3');
  });

  it('reports provenance, because "who changed the rules?" needs an on-screen answer', () => {
    expect(resolveFormat({}, { sport: 'squash' }, rows).source).toBe('the sport default');
    expect(resolveFormat({ scoring_format_id: 'f-ittf' }, {}, rows).source).toBe('an override on this match');
  });

  it('ignores a format id that no longer resolves or no longer validates', () => {
    const broken: LadderFormatRow[] = [{ id: 'f-bad', config: { nonsense: true } }];
    const r = resolveFormat({ scoring_format_id: 'f-bad' }, { sport: 'badminton' }, broken);
    expect(r.layer).toBe('sportDefault');
    const missing = resolveFormat({ scoring_format_id: 'f-gone' }, { sport: 'badminton' }, rows);
    expect(missing.layer).toBe('sportDefault');
  });

  it('returns nothing for a sport the kernel deliberately does not score', () => {
    // Cricket keeps its own model (different grain) and the measured sports keep the
    // EventSpec layer. "Not here" is a decision about them, not a gap.
    for (const sport of ['cricket', 'box cricket', 'swimming', 'athletics', 'weightlifting']) {
      const r = resolveFormat({}, { sport }, rows);
      expect(r.layer, sport).toBe('none');
      expect(r.format, sport).toBeNull();
    }
  });

  it('DOES score every other family now', () => {
    for (const sport of ['volleyball', 'throwball', 'football', 'futsal', 'basketball',
      'hockey', 'handball', 'frisbee', 'kabaddi', 'kho-kho', 'carrom', 'pool/snooker',
      'chess', 'tug of war', 'arm wrestling', 'fencing', 'taekwondo', 'judo',
      'wrestling', 'boxing']) {
      const r = resolveFormat({}, { sport }, rows);
      expect(r.layer, sport).toBe('sportDefault');
      expect(r.format, sport).toBeTruthy();
    }
  });
});

describe('per-round overrides - the QF/SF/Final requirement', () => {
  // "QF and SF play best of 3 to 11; the Final plays best of 3 to 21."
  const round_formats = [
    { stageSequence: 1, round: 'Final', formatId: 'f-21' },
    { stageSequence: 1, round: 'SF', formatId: 'f-sprint' },
    { stageSequence: 1, round: 'QF', formatId: 'f-sprint' },
  ];
  const draw = { sport: 'table tennis', scoring_format_id: 'f-ittf', round_formats };

  it('gives each round its own format and leaves the rest on the draw default', () => {
    const at = (round: string) => resolveFormat({ round, stage_sequence: 1 }, draw, rows);
    expect(at('Final').format?.presetKey).toBe('legacy_21_bo3');
    expect(at('Final').layer).toBe('round');
    expect(at('SF').format?.presetKey).toBe('sprint_9_serve3');
    expect(at('QF').format?.presetKey).toBe('sprint_9_serve3');
    // R16 has no override, so it plays the draw default.
    expect(at('R16').layer).toBe('draw');
    expect(at('R16').format?.presetKey).toBe('ittf_bo5_11');
  });

  it('matches the round labels the generators actually stamp', () => {
    // generators/util.ts emits exactly these.
    for (const round of ['Final', 'SF', 'QF']) {
      expect(matchRoundRule(round_formats, { round, stage_sequence: 1 })?.layer).toBe('round');
    }
    expect(matchRoundRule(round_formats, { round: 'R32', stage_sequence: 1 })).toBeNull();
  });

  it('lets a specific round beat a broad stage rule when listed first', () => {
    const ordered = [
      { stageSequence: 2, round: 'Final', formatId: 'f-21' },
      { stageSequence: 2, formatId: 'f-sprint' }, // everything else in stage 2
    ];
    expect(matchRoundRule(ordered, { round: 'Final', stage_sequence: 2 })?.layer).toBe('round');
    expect(matchRoundRule(ordered, { round: 'SF', stage_sequence: 2 })?.layer).toBe('stage');
    // Stage 1 is untouched by either rule.
    expect(matchRoundRule(ordered, { round: 'Final', stage_sequence: 1 })).toBeNull();
  });

  it('treats a fixture with no stage_sequence as stage 1', () => {
    expect(matchRoundRule(round_formats, { round: 'Final', stage_sequence: null })?.layer).toBe('round');
  });

  it('rejects a malformed override list rather than half-applying it', () => {
    expect(parseRoundFormats('nonsense')).toEqual([]);
    expect(parseRoundFormats([{ formatId: 'f-1' }])).toEqual([]); // needs a round or a stage
    expect(parseRoundFormats([{ round: 'Final', formatId: 'f-1' }])).toHaveLength(1);
  });

  it('collects every format a draw could need in one list, for one query', () => {
    const ids = formatIdsForDraw(draw, [
      { scoring_format_id: 'f-ittf' }, { scoring_format_id: null }, { scoring_format_id: 'f-x' },
    ]);
    expect(new Set(ids)).toEqual(new Set(['f-ittf', 'f-21', 'f-sprint', 'f-x']));
  });
});

describe('predicting the rounds a draw will have', () => {
  it('names them exactly as the generators stamp them', () => {
    expect(predictKnockoutRounds(8)).toEqual(['QF', 'SF', 'Final']);
    expect(predictKnockoutRounds(4)).toEqual(['SF', 'Final']);
    expect(predictKnockoutRounds(2)).toEqual(['Final']);
    expect(predictKnockoutRounds(16)).toEqual(['R16', 'QF', 'SF', 'Final']);
    expect(predictKnockoutRounds(32)).toEqual(['R32', 'R16', 'QF', 'SF', 'Final']);
  });

  it('rounds a non-power-of-two up, because that is what the bracket does', () => {
    // 6 entrants play an 8-bracket with two byes, so the rounds ARE QF/SF/Final.
    expect(predictKnockoutRounds(6)).toEqual(['QF', 'SF', 'Final']);
    expect(predictKnockoutRounds(5)).toEqual(['QF', 'SF', 'Final']);
  });

  it('offers nothing for a draw that cannot be played', () => {
    expect(predictKnockoutRounds(1)).toEqual([]);
    expect(predictKnockoutRounds(0)).toEqual([]);
  });

  it('is what stops a rule being set on a round that never exists', () => {
    // The reported bug: an 8-team draw had overrides stored on R32 and R16, which
    // the generator never creates, so they sat inert forever.
    const real = predictKnockoutRounds(8);
    expect(real).not.toContain('R32');
    expect(real).not.toContain('R16');
  });
});

describe('a round rule can name a built-in preset', () => {
  it('resolves without needing a saved row', () => {
    // Requiring a saved format first is what made the editor read as broken.
    const draw = {
      sport: 'table tennis',
      round_formats: [{ round: 'Final', presetKey: 'legacy_21_bo3' }],
    };
    const r = resolveFormat({ round: 'Final', stage_sequence: 1 }, draw, []);
    expect(r.layer).toBe('round');
    expect(r.format?.presetKey).toBe('legacy_21_bo3');
  });

  it('prefers a saved row over a preset key on the same rule', () => {
    const draw = {
      sport: 'table tennis',
      round_formats: [{ round: 'Final', formatId: 'f-sprint', presetKey: 'legacy_21_bo3' }],
    };
    expect(resolveFormat({ round: 'Final' }, draw, rows).format?.presetKey).toBe('sprint_9_serve3');
  });

  it('ignores a preset key nothing matches, rather than throwing', () => {
    const draw = { sport: 'table tennis', round_formats: [{ round: 'Final', presetKey: 'nope' }] };
    expect(resolveFormat({ round: 'Final' }, draw, []).layer).toBe('sportDefault');
  });

  it('accepts either kind and rejects a rule pointing at neither', () => {
    expect(parseRoundFormats([{ round: 'Final', formatId: 'f-1' }])).toHaveLength(1);
    expect(parseRoundFormats([{ round: 'Final', presetKey: 'ittf_bo5_11' }])).toHaveLength(1);
    expect(parseRoundFormats([{ round: 'Final' }])).toEqual([]);
  });
});

describe('resolving every round at once', () => {
  it('says what each round plays and whether it is inherited or overridden', () => {
    const draw = {
      sport: 'table tennis',
      scoring_format_id: 'f-ittf',
      round_formats: [{ round: 'Final', presetKey: 'legacy_21_bo3' }],
    };
    const out = resolveRounds(
      [{ round: 'QF', matches: 4 }, { round: 'SF', matches: 2 }, { round: 'Final', matches: 1 }],
      draw, rows,
    );
    expect(out.map((r) => [r.round, r.matches, r.overridden, r.format?.presetKey])).toEqual([
      ['QF', 4, false, 'ittf_bo5_11'],
      ['SF', 2, false, 'ittf_bo5_11'],
      ['Final', 1, true, 'legacy_21_bo3'],
    ]);
    // Inherited rounds report where they came from, so the UI can say so.
    expect(out[0].layer).toBe('draw');
    expect(out[2].layer).toBe('round');
  });

  it('falls through to the sport default when the draw has no format of its own', () => {
    const out = resolveRounds([{ round: 'Final', matches: 1 }], { sport: 'badminton' }, []);
    expect(out[0].layer).toBe('sportDefault');
    expect(out[0].overridden).toBe(false);
    expect(out[0].format?.presetKey).toBe('bwf_official_3x21');
  });
});
