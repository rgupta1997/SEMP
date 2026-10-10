import { describe, expect, it } from 'vitest';
import type { RallyLog } from '@semp/shared';
import { cardTally } from './RacquetDeck';

describe('card markers', () => {
  it('a red card sits with the side that offended, not the side given the point', () => {
    // "Misconduct · Team A → Red card · point to Team B" sends a penalty with side B.
    const log: RallyLog = [{ t: 'penalty', side: 'B', card: 'red', reason: 'misconduct' }];
    const t = cardTally(log, 'badminton');
    expect(t.A.fouls).toBe(1);
    expect(t.B.fouls).toBe(0);
  });

  it('a warning sits with the side it was given against', () => {
    const t = cardTally([{ t: 'card', card: 'yellow', against: 'A' }], 'badminton');
    expect(t.A.warnings).toBe(1);
    expect(t.B.warnings).toBe(0);
  });
});
