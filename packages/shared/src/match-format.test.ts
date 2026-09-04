import { describe, expect, it } from 'vitest';
import {
  CRICKET_FAMILY, RALLY_FAMILY, familyForSport, formatName, formatOfficiating,
  isCricketFormat, isRallyFormat,
  matchFormatSchema,
} from './match-format.js';
import { resolveFormat, resolveMatchFormat, walkLadder, type LadderFormatRow } from './format-ladder.js';
import { cricketPresetByKey } from './cricket-rules.js';
import { presetByKey } from './racquet-presets.js';

const tt = presetByKey('ittf_bo5_11')!;
const t20 = cricketPresetByKey('cricket_t20')!;
const superOver = cricketPresetByKey('cricket_super_over')!;

describe('telling the two families apart', () => {
  it('narrows a cricket format by its kind', () => {
    expect(isCricketFormat(t20)).toBe(true);
    expect(isRallyFormat(t20)).toBe(false);
  });

  it('narrows a rally format by its levels', () => {
    // ScoringFormat carries no `kind`: adding one would invalidate every format row
    // already stored, so the ABSENCE is the discriminant.
    expect(isRallyFormat(tt)).toBe(true);
    expect(isCricketFormat(tt)).toBe(false);
  });

  it('is safe on nothing at all', () => {
    expect(isCricketFormat(null)).toBe(false);
    expect(isRallyFormat(undefined)).toBe(false);
  });

  it('reads the fields both families share without narrowing', () => {
    for (const f of [tt, t20]) {
      expect(formatName(f)).toBeTruthy();
      expect(['officiated', 'selfScored']).toContain(formatOfficiating(f));
    }
  });
});

describe('choosing a family by sport', () => {
  it('sends cricket and box cricket to the cricket family', () => {
    expect(familyForSport('cricket').key).toBe('cricket');
    expect(familyForSport('Box Cricket').key).toBe('cricket');
  });

  it('sends everything else to the rally family', () => {
    for (const s of ['table tennis', 'badminton', 'football', 'chess', null, 'quidditch']) {
      expect(familyForSport(s).key).toBe('rally');
    }
  });

  it('each family reads only its own configs', () => {
    // Cross-feeding must return null, not a half-parsed object - the ladder relies
    // on a failed parse to fall through to the next rung.
    expect(RALLY_FAMILY.parse(t20)).toBeNull();
    expect(CRICKET_FAMILY.parse(tt)).toBeNull();
    expect(RALLY_FAMILY.parse(tt)).not.toBeNull();
    expect(CRICKET_FAMILY.parse(t20)).not.toBeNull();
  });
});

describe('cricket walks the SAME ladder', () => {
  // The whole point of the union: an organiser setting "QF short, Final full" must
  // get identical behaviour whichever sport it is.
  const draw = {
    sport: 'cricket',
    round_formats: [
      { round: 'Final', presetKey: 'cricket_t20' },
      { round: 'QF', presetKey: 'cricket_super_over' },
    ],
  };

  it('falls to the sport default with nothing configured', () => {
    const r = resolveMatchFormat({}, { sport: 'cricket' });
    expect(r.family).toBe('cricket');
    expect(r.layer).toBe('sportDefault');
    expect((r.format as typeof t20).presetKey).toBe('cricket_t20');
  });

  it('honours a per-round override, by preset key and with no saved row', () => {
    const qf = resolveMatchFormat({ round: 'QF' }, draw);
    expect(qf.layer).toBe('round');
    expect((qf.format as typeof t20).oversPerInnings).toBe(1);
    const final = resolveMatchFormat({ round: 'Final' }, draw);
    expect((final.format as typeof t20).oversPerInnings).toBe(20);
  });

  it('lets an override on one match beat the round', () => {
    const rows: LadderFormatRow[] = [{ id: 'f1', config: { ...t20, oversPerInnings: 8, name: 'Eights' } }];
    const r = resolveMatchFormat({ round: 'QF', scoring_format_id: 'f1' }, draw, rows);
    expect(r.layer).toBe('fixture');
    expect((r.format as typeof t20).oversPerInnings).toBe(8);
  });

  it('lets a frozen snapshot beat everything, so a played match stays reproducible', () => {
    const r = resolveMatchFormat(
      { round: 'QF', frozen_format: { ...superOver, name: 'As played' } }, draw,
    );
    expect(r.layer).toBe('frozen');
    expect(formatName(r.format!)).toBe('As played');
  });

  it('falls THROUGH a config that no longer validates', () => {
    // A stored format that has gone stale must not resolve to something malformed.
    const rows: LadderFormatRow[] = [{ id: 'bad', config: { kind: 'cricket', nonsense: true } }];
    const r = resolveMatchFormat({ scoring_format_id: 'bad' }, { sport: 'cricket' }, rows);
    expect(r.layer).toBe('sportDefault');
  });

  it('resolves a stored preset reference rather than dropping to the default', () => {
    const rows: LadderFormatRow[] = [{ id: 'ref', config: { presetKey: 'cricket_t10' } }];
    const r = resolveMatchFormat({ scoring_format_id: 'ref' }, { sport: 'cricket' }, rows);
    expect(r.layer).toBe('fixture');
    expect((r.format as typeof t20).oversPerInnings).toBe(10);
  });
});

describe('the two entry points stay apart', () => {
  it('resolveFormat gives a cricket fixture NO rally format', () => {
    // Correct, not a bug: there is no rally format for cricket, and a caller wanting
    // both families uses resolveMatchFormat.
    const r = resolveFormat({}, { sport: 'cricket' });
    expect(r.format).toBeNull();
    expect(r.layer).toBe('none');
  });

  it('resolveMatchFormat still resolves a racquet sport the old way', () => {
    const r = resolveMatchFormat({}, { sport: 'table tennis' });
    expect(r.family).toBe('rally');
    expect(r.layer).toBe('sportDefault');
    expect(isRallyFormat(r.format)).toBe(true);
  });

  it('resolveFormat and resolveMatchFormat agree on every rally sport', () => {
    for (const sport of ['table tennis', 'badminton', 'tennis', 'squash', 'pickleball', 'football']) {
      const a = resolveFormat({ round: 'Final' }, { sport });
      const b = resolveMatchFormat({ round: 'Final' }, { sport });
      expect(a.layer, sport).toBe(b.layer);
      expect(a.format?.name, sport).toBe(b.format?.name);
    }
  });

  it('walkLadder is the shared implementation, not a copy', () => {
    // Calling it directly with each family must reproduce both entry points exactly.
    const draw = { sport: 'cricket', round_formats: [{ round: 'SF', presetKey: 'cricket_t10' }] };
    const direct = walkLadder({ round: 'SF' }, draw, [], CRICKET_FAMILY);
    const viaUnion = resolveMatchFormat({ round: 'SF' }, draw);
    expect(direct.layer).toBe(viaUnion.layer);
    expect(direct.format?.name).toBe(viaUnion.format?.name);
    expect(walkLadder({}, { sport: 'badminton' }, [], RALLY_FAMILY).format?.name)
      .toBe(resolveFormat({}, { sport: 'badminton' }).format?.name);
  });
});

describe('the save endpoint accepts either family', () => {
  it('validates a format of each kind in full', () => {
    // The endpoint validated with scoringFormatSchema alone, so the shelf would
    // offer cricket presets and then refuse to save a variation of one.
    expect(matchFormatSchema.safeParse(t20).success).toBe(true);
    expect(matchFormatSchema.safeParse(tt).success).toBe(true);
  });

  it('still refuses a config that is broken WITHIN its family', () => {
    // A union must not become a loophole: each branch validates as strictly as before.
    expect(matchFormatSchema.safeParse({ ...t20, ballsPerOver: 0 }).success).toBe(false);
    expect(matchFormatSchema.safeParse({ ...t20, playersPerSide: 6, wicketsToEndInnings: 9, lastManStands: false }).success).toBe(false);
    expect(matchFormatSchema.safeParse({ ...tt, levels: [] }).success).toBe(false);
    expect(matchFormatSchema.safeParse({ nonsense: true }).success).toBe(false);
  });
});
