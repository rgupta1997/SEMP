import { describe, expect, it } from 'vitest';
import { withExtraSubEvents } from './event-scoring.js';

const spec = {
  result: { resultType: 'weight', winnerIs: 'max', unit: 'kg', aggregate: 'medals', medalPoints: [5, 3, 1] },
  subEvents: [{ key: 'm63', label: 'Men ≤63kg' }],
  pickOne: true,
} as any;

describe('classes added from the event setup', () => {
  it('appends them after the built-in ones, once each', () => {
    const out = withExtraSubEvents(spec, { extraEvents: [{ key: 'd105', label: 'Men ≤105kg' }, { key: 'd105', label: 'dup' }, { key: 'm63', label: 'clash' }] });
    expect(out.subEvents.map((se) => se.key)).toEqual(['m63', 'd105']);
    expect(out.pickOne).toBe(true);
  });

  it('reads "relay" in the name as a relay, and leaves the spec alone with nothing added', () => {
    expect(withExtraSubEvents(spec, { extraEvents: [{ key: 'r', label: "Men's 4x50m Medley Relay" }] }).subEvents[1].kind).toBe('relay');
    expect(withExtraSubEvents(spec, null)).toBe(spec);
    expect(withExtraSubEvents(spec, { extraEvents: [{ key: 1, label: 'bad' } as any] })).toBe(spec);
  });
});
