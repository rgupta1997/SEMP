import { describe, expect, it } from 'vitest';
import { knobModelFor, whyNotEditable } from './knob-facade.js';
import { CRICKET_PRESETS, cricketPresetByKey } from './cricket-rules.js';
import { allPresets, presetByKey } from './racquet-presets.js';

describe('one interface over both knob models', () => {
  it('routes each family to its own model', () => {
    expect(knobModelFor(cricketPresetByKey('cricket_t20')!).family).toBe('cricket');
    expect(knobModelFor(presetByKey('ittf_bo5_11')!).family).toBe('rally');
  });

  it('round-trips every editable preset in BOTH families through the facade', () => {
    // Asserted on the KNOBS, not on the stored format. `applyKnobs` normalises - it
    // copies the format-level serve spec down onto the level, which is equivalent
    // because serveSpecFor falls back to the format - so a structural comparison
    // would fail on a difference that changes no rule. What must hold is that a
    // round trip is idempotent: reading, writing and reading again gives the same
    // knobs, or opening a format and pressing Save would alter it.
    for (const f of [...allPresets(), ...CRICKET_PRESETS]) {
      const m = knobModelFor(f);
      if (!m.editable(f)) continue;
      const once = m.read(f);
      const twice = m.read(m.apply(f, once));
      expect(twice, `${m.family}:${f.presetKey}`).toEqual(once);
      // And the summary line a person reads is unchanged by the round trip.
      expect(m.describe(twice), `${m.family}:${f.presetKey}`).toBe(m.describe(once));
    }
  });

  it('leaves the format it was handed untouched', () => {
    // Varying a shipped preset must never mutate the shelf.
    for (const f of [...allPresets(), ...CRICKET_PRESETS]) {
      const m = knobModelFor(f);
      if (!m.editable(f)) continue;
      const before = JSON.stringify(f);
      m.apply(f, m.read(f), 'Ours');
      expect(JSON.stringify(f), `${m.family}:${f.presetKey}`).toBe(before);
    }
  });

  it('offers groups and applicable specs for whatever it is given', () => {
    for (const f of [cricketPresetByKey('cricket_t20')!, presetByKey('ittf_bo5_11')!]) {
      const m = knobModelFor(f);
      const knobs = m.read(f);
      expect(m.groups.length).toBeGreaterThan(0);
      expect(m.specsFor(knobs).length).toBeGreaterThan(0);
      // Every applicable spec belongs to a group the editor will render.
      const groups = new Set(m.groups.map((g) => g.key));
      for (const s of m.specsFor(knobs)) expect(groups.has(s.group), s.key).toBe(true);
      // And every applicable spec names a knob that exists.
      for (const s of m.specsFor(knobs)) expect(Object.keys(knobs)).toContain(s.key);
      expect(m.describe(knobs)).toBeTruthy();
    }
  });

  it('explains a refusal once, not once per family', () => {
    // Tennis nests a game inside a set, which the flat model cannot describe.
    const tennis = allPresets().find((f) => f.sport === 'tennis')!;
    expect(whyNotEditable(tennis)).toContain('tennis');
    expect(whyNotEditable(cricketPresetByKey('cricket_test')!)).toBeNull();
    expect(whyNotEditable(presetByKey('ittf_bo5_11')!)).toBeNull();
  });
});
