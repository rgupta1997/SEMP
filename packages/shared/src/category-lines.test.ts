import { describe, expect, it } from 'vitest';
import {
  COLUMN_MAP, FAMILY_TABLE, SPINE_METRICS, lineFamilyFor, registryMetricKeys,
  toCategoryRow, type LineFamily,
} from './category-lines.js';
import { ALL_STAT_SPECS } from './stat-registry.js';

const FAMILIES = Object.keys(FAMILY_TABLE) as LineFamily[];

describe('nothing the registry measures can be silently dropped', () => {
  // THE test in this file. A metric with no column is a metric written nowhere, and
  // the whole reason for moving off a jsonb bag was that such a loss was invisible.
  it.each(FAMILIES)('every %s metric has a column or belongs to the spine', (family) => {
    const orphans = registryMetricKeys(family)
      .filter((k) => !SPINE_METRICS.includes(k))
      .filter((k) => !(k in COLUMN_MAP[family]));
    expect(orphans, `no column for: ${orphans.join(', ')}`).toEqual([]);
  });

  it('and nothing is mapped that the registry does not measure', () => {
    // The other direction: a stale column mapping is a column nothing ever fills.
    for (const family of FAMILIES) {
      const known = new Set(registryMetricKeys(family));
      const stale = Object.keys(COLUMN_MAP[family]).filter((k) => !known.has(k));
      expect(stale, `${family} maps unknown metrics: ${stale.join(', ')}`).toEqual([]);
    }
  });

  it('covers every sport that has a stat spec, or says why not', () => {
    const uncovered = ALL_STAT_SPECS
      .filter((s) => lineFamilyFor(s.sport) === null)
      .map((s) => `${s.sport} (${s.family})`);
    // Cricket keeps three tables of its own and 'measured' sports are records, not
    // match lines. Anything else appearing here is a gap.
    expect(uncovered).toEqual([]);
  });
});

describe('routing a sport to its table', () => {
  it('sends the families where they belong', () => {
    expect(lineFamilyFor('table tennis')).toBe('racquet');
    expect(lineFamilyFor('football')).toBe('invasion');
    expect(lineFamilyFor('basketball')).toBe('invasion');
    expect(lineFamilyFor('kabaddi')).toBe('raid');
    expect(lineFamilyFor('volleyball')).toBe('net');
    expect(lineFamilyFor('chess')).toBe('board');
    expect(lineFamilyFor('boxing')).toBe('combat');
  });

  it('has no table for a sport it does not know', () => {
    expect(lineFamilyFor('quidditch')).toBeNull();
    expect(lineFamilyFor(null)).toBeNull();
    expect(lineFamilyFor('cricket')).toBeNull();   // three tables of its own
  });
});

describe('projecting a bag onto columns', () => {
  it('carries the numbers across', () => {
    const r = toCategoryRow('football', { goals: 2, assists: 1, minutes: 90, yellows: 1 })!;
    expect(r.table).toBe('invasion_match_lines');
    expect(r.row).toMatchObject({ goals: 2, assists: 1, minutes: 90, yellows: 1 });
    expect(r.unmapped).toEqual([]);
  });

  it('leaves the spine metrics to the spine', () => {
    // A detail table holding its own copy of wins/losses is a second source of truth
    // for the number every page shows.
    const r = toCategoryRow('football', { matches: 1, wins: 1, goals: 1 })!;
    expect(r.row.goals).toBe(1);
    expect(r.row).not.toHaveProperty('matches');
    expect(r.row).not.toHaveProperty('wins');
    expect(r.unmapped).toEqual([]);
  });

  it('stores no rate, because a rate is recomputed from its operands', () => {
    const r = toCategoryRow('table tennis', {
      points_won: 30, points_lost: 20, win_pct: 60, point_diff: 10, service_win_pct: 55,
    })!;
    expect(r.row).toMatchObject({ points_won: 30, points_lost: 20 });
    expect(Object.keys(r.row)).not.toContain('win_pct');
    // Not flagged as unmapped either - dropping it is correct, not a gap.
    expect(r.unmapped).toEqual([]);
  });

  it('reports a metric it does not recognise instead of throwing', () => {
    // A single unknown key must never fail a result lock.
    const r = toCategoryRow('football', { goals: 1, invented_metric: 7 })!;
    expect(r.row.goals).toBe(1);
    expect(r.unmapped).toEqual(['invented_metric']);
  });

  it('turns a career count into the per-match fact it actually is', () => {
    const won = toCategoryRow('badminton', { comeback_wins: 1, retirements: 0 })!;
    expect(won.row.comeback_win).toBe(true);
    // Zero writes nothing, so the column default (false) stands.
    expect(won.row).not.toHaveProperty('retired');
  });

  it('sums carrom boards and snooker frames into one pair of columns', () => {
    // They are the same concept counted; four columns would leave two always zero.
    expect(toCategoryRow('carrom', { boards_won: 3, boards_lost: 1 })!.row)
      .toMatchObject({ units_won: 3, units_lost: 1 });
    expect(toCategoryRow('pool/snooker', { frames_won: 4, frames_lost: 2, highest_break: 62 })!.row)
      .toMatchObject({ units_won: 4, units_lost: 2, highest_break: 62 });
  });

  it('records the colour as a colour, not as two counters', () => {
    const white = toCategoryRow('chess', { as_white: 1, result_points_x2: 2 })!;
    expect(white.row.colour).toBe('white');
    expect(white.row.result_points_x2).toBe(2);
    expect(white.row).not.toHaveProperty('colour_is_white');
    const black = toCategoryRow('chess', { as_black: 1 })!;
    expect(black.row.colour).toBe('black');
    // An explicit fact beats anything inferred from the bag.
    expect(toCategoryRow('chess', { as_white: 1 }, { colour: 'black' })!.row.colour).toBe('black');
  });

  it('takes the facts the bag cannot carry', () => {
    const r = toCategoryRow('tennis', {}, { rubber_key: 'R2', partner_user_id: 'u9' })!;
    expect(r.row).toMatchObject({ rubber_key: 'R2', partner_user_id: 'u9' });
    const c = toCategoryRow('boxing', {}, { weight_class: '75kg', win_by: 'ko' })!;
    expect(c.row).toMatchObject({ weight_class: '75kg', win_by: 'ko' });
  });

  it('does not duplicate singles/doubles into the racquet table', () => {
    // The spine already has `position`; a second copy is a second thing to disagree.
    const r = toCategoryRow('squash', { points_won: 11 }, { position: 'singles' })!;
    expect(r.row).not.toHaveProperty('position');
    // Where the table DOES have the column, it is filled.
    expect(toCategoryRow('kabaddi', {}, { position: 'raider' })!.row.position).toBe('raider');
  });

  it('never writes a negative or a fraction into an integer column', () => {
    // Every column carries `check (x >= 0)`, so a negative would abort the insert
    // and take the whole lock down with it.
    const r = toCategoryRow('football', { goals: -3, assists: 2.6 })!;
    expect(r.row.goals).toBe(0);
    expect(r.row.assists).toBe(3);
  });

  it('returns nothing at all for a sport with no detail table', () => {
    expect(toCategoryRow('cricket', { runs: 40 })).toBeNull();
    expect(toCategoryRow(null, {})).toBeNull();
  });
});
