import { describe, expect, it } from 'vitest';
import {
  CRICKET_KNOB_SPECS, applyCricketKnobs, cricketKnobsFor, describeCricketKnobs,
  readCricketKnobs,
} from './cricket-knobs.js';
import { CRICKET_PRESETS, cricketFormatSchema, cricketPresetByKey } from './cricket-rules.js';

const fmt = (k: string) => cricketPresetByKey(k)!;

describe('reading a format into knobs', () => {
  it('round-trips every shipped preset unchanged', () => {
    // The editing model must be LOSSLESS for anything on the shelf, or opening a
    // preset and pressing Save would silently alter the rules.
    for (const p of CRICKET_PRESETS) {
      const back = applyCricketKnobs(p, readCricketKnobs(p));
      // presetKey is deliberately dropped on a vary; everything else must match.
      expect({ ...back, presetKey: p.presetKey }, p.presetKey).toEqual(p);
    }
  });

  it('turns unlimited overs into a toggle', () => {
    // `null` is the stored form and a form field cannot hold it usefully. Folding it
    // to a number is exactly the bug that made the Test preset a 20-over game.
    const test = readCricketKnobs(fmt('cricket_test'));
    expect(test.limitedOvers).toBe(false);
    // Still shows a sensible number, so switching the toggle back on is not 0 overs.
    expect(test.oversPerInnings).toBeGreaterThan(0);
    expect(readCricketKnobs(fmt('cricket_t20')).limitedOvers).toBe(true);
  });

  it('keeps the wicket count explicit, because it is not always players - 1', () => {
    // A super over ends after TWO wickets with eleven on the sheet. Deriving the
    // count from the squad size cannot express that, and the round-trip test above
    // is what caught it.
    expect(readCricketKnobs(fmt('cricket_super_over')).wicketsToEnd).toBe(2);
    expect(readCricketKnobs(fmt('cricket_t20')).wicketsToEnd).toBe(10);
    expect(readCricketKnobs(fmt('box_5ov_6_lms')).lastManStands).toBe(true);
    expect(readCricketKnobs(fmt('cricket_t20')).lastManStands).toBe(false);
  });

  it('turns a null limit into a toggle plus a sensible number', () => {
    const test = readCricketKnobs(fmt('cricket_test'));
    expect(test.bowlerLimitEnabled).toBe(false);
    expect(test.maxOversPerBowler).toBeGreaterThan(0);
    const t20 = readCricketKnobs(fmt('cricket_t20'));
    expect(t20.bowlerLimitEnabled).toBe(true);
    expect(t20.maxOversPerBowler).toBe(4);
  });
});

describe('writing knobs back', () => {
  const t20 = fmt('cricket_t20');

  it('produces a format that still validates', () => {
    const k = readCricketKnobs(t20);
    const out = applyCricketKnobs(t20, { ...k, oversPerInnings: 9, playersPerSide: 7 }, 'Nines');
    const r = cricketFormatSchema.safeParse(out);
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true);
    expect(out.name).toBe('Nines');
  });

  it('drops the preset key, so a variation is not mistaken for the original', () => {
    // Keeping it would let a later lookup resolve back to the shipped rules.
    const out = applyCricketKnobs(t20, { ...readCricketKnobs(t20), oversPerInnings: 12 }, 'Twelves');
    expect(out.presetKey).toBeUndefined();
    expect(t20.presetKey).toBe('cricket_t20');   // the original is untouched
  });

  it('clamps the wicket count to what the schema will accept', () => {
    // `wickets <= players - 1 unless lastManStands` is a check constraint, so the
    // form must not be able to produce a row the insert would reject.
    const k = readCricketKnobs(t20);
    const six = applyCricketKnobs(t20, { ...k, playersPerSide: 6, wicketsToEnd: 9, lastManStands: false });
    expect(six.wicketsToEndInnings).toBe(5);
    const lms = applyCricketKnobs(t20, { ...k, playersPerSide: 6, wicketsToEnd: 9, lastManStands: true });
    expect(lms.wicketsToEndInnings).toBe(6);
    for (const out of [six, lms]) expect(cricketFormatSchema.safeParse(out).success).toBe(true);
    // And a deliberately low count is left alone.
    expect(applyCricketKnobs(t20, { ...k, wicketsToEnd: 2 }).wicketsToEndInnings).toBe(2);
  });

  it('never lets a bowler be allocated more overs than the innings has', () => {
    const k = readCricketKnobs(t20);
    const out = applyCricketKnobs(t20, { ...k, oversPerInnings: 5, maxOversPerBowler: 20 });
    expect(out.maxOversPerBowler).toBe(5);
  });

  it('clears the powerplay when the overs go away', () => {
    const k = readCricketKnobs(t20);
    const out = applyCricketKnobs(t20, { ...k, limitedOvers: false });
    expect(out.oversPerInnings).toBeNull();
    // A powerplay in an unlimited innings is meaningless.
    expect(out.powerplayOvers).toBeNull();
  });

  it('clamps a value outside the possible range rather than storing it', () => {
    const k = readCricketKnobs(t20);
    const out = applyCricketKnobs(t20, { ...k, ballsPerOver: 99, playersPerSide: 1, wideRuns: 50 });
    expect(out.ballsPerOver).toBe(12);
    expect(out.playersPerSide).toBe(2);
    expect(out.wideRuns).toBe(5);
    expect(cricketFormatSchema.safeParse(out).success).toBe(true);
  });

  it('leaves the format it was given untouched', () => {
    const before = JSON.stringify(t20);
    applyCricketKnobs(t20, { ...readCricketKnobs(t20), oversPerInnings: 3 }, 'Threes');
    expect(JSON.stringify(t20)).toBe(before);
  });
});

describe('offering only the knobs that apply', () => {
  it('hides the overs field when the innings is unlimited', () => {
    const k = readCricketKnobs(fmt('cricket_test'));
    const keys = cricketKnobsFor(k).map((s) => s.key);
    expect(keys).not.toContain('oversPerInnings');
    expect(keys).not.toContain('powerplayEnabled');
    expect(keys).toContain('limitedOvers');
  });

  it('hides the bowler limit until it is switched on', () => {
    const k = readCricketKnobs(fmt('cricket_test'));
    expect(cricketKnobsFor(k).map((s) => s.key)).not.toContain('maxOversPerBowler');
    expect(cricketKnobsFor({ ...k, bowlerLimitEnabled: true }).map((s) => s.key))
      .toContain('maxOversPerBowler');
  });

  it('offers no powerplay in a four-over box game', () => {
    const k = readCricketKnobs(fmt('box_4ov_4ball'));
    expect(cricketKnobsFor(k).map((s) => s.key)).not.toContain('powerplayEnabled');
  });

  it('every knob spec names a real knob', () => {
    const known = Object.keys(readCricketKnobs(fmt('cricket_t20')));
    for (const s of CRICKET_KNOB_SPECS) expect(known, s.key).toContain(s.key);
  });

  it('every knob has a spec, so none is unreachable in the editor', () => {
    const spec = new Set(CRICKET_KNOB_SPECS.map((s) => s.key));
    for (const key of Object.keys(readCricketKnobs(fmt('cricket_t20')))) {
      expect(spec.has(key as never), key).toBe(true);
    }
  });
});

describe('describing a change before it is saved', () => {
  it('reads as the format it is', () => {
    expect(describeCricketKnobs(readCricketKnobs(fmt('cricket_t20')))).toContain('20 overs');
    expect(describeCricketKnobs(readCricketKnobs(fmt('cricket_test')))).toContain('unlimited overs');
    expect(describeCricketKnobs(readCricketKnobs(fmt('box_5ov_6_lms')))).toContain('last man stands');
    expect(describeCricketKnobs(readCricketKnobs(fmt('cricket_super_over')))).toContain('2 wickets');
    expect(describeCricketKnobs(readCricketKnobs(fmt('box_4ov_4ball')))).toContain('4-ball overs');
  });

  it('stays quiet about anything that is normal', () => {
    // A line listing every default is a line nobody reads.
    const line = describeCricketKnobs(readCricketKnobs(fmt('cricket_odi')));
    expect(line).not.toContain('a side');       // 11 is normal
    expect(line).not.toContain('6-ball');       // so is six
  });
});
