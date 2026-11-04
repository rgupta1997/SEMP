import { describe, expect, it } from 'vitest';
import type { RallyEvent } from '@semp/shared';
import { describeTrace } from './RacquetDeck';

const nameOf = (s: 'A' | 'B') => (s === 'A' ? 'Ahmedabad' : 'Bangalore');
const line = (event: RallyEvent) => describeTrace({ event } as Parameters<typeof describeTrace>[0], nameOf, 'badminton');

// The log names who did what, not just the winner after the reason.
describe('end of match log line', () => {
  it('a retirement names the side that retired', () => {
    expect(line({ t: 'end', outcome: 'win', reason: 'retired', winner: 'A' })).toBe('Bangalore retired - match to Ahmedabad');
  });
  it('a disqualification names the side disqualified', () => {
    expect(line({ t: 'end', outcome: 'win', reason: 'disqualified', winner: 'B' })).toBe('Ahmedabad disqualified - match to Bangalore');
  });
  it('walkover, award, time up and abandoned read plainly', () => {
    expect(line({ t: 'end', outcome: 'win', reason: 'walkover', winner: 'A' })).toBe('Walkover - match to Ahmedabad');
    expect(line({ t: 'end', outcome: 'win', reason: 'conceded', winner: 'B' })).toBe('Match awarded to Bangalore');
    expect(line({ t: 'end', outcome: 'win', reason: 'cap', winner: 'A' })).toBe('Time up - match to Ahmedabad');
    expect(line({ t: 'end', outcome: 'draw', reason: 'cap', winner: null })).toBe('Time up - level');
    expect(line({ t: 'end', outcome: 'void', reason: 'abandoned', winner: null })).toBe('Abandoned - no result');
  });
});
