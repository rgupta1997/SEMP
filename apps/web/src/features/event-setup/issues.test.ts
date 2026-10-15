import { describe, expect, it } from 'vitest';
import type { SetupIssue } from '@semp/shared';
import {
  countIssues, filterIssues, groupBySeverity, issueLocator, issueSheets, issuesCsvRows,
  NO_SHEET, sortIssues, verdict,
} from './issues';

const I = (p: Partial<SetupIssue>): SetupIssue => ({ severity: 'error', code: 'x', message: 'm', ...p });

const sample: SetupIssue[] = [
  I({ severity: 'warning', code: 'dup_player', sheet: 'Squads', row: 9, column: 'Player 3', message: 'Same player twice' }),
  I({ severity: 'info', code: 'note', message: 'General note' }),
  I({ severity: 'error', code: 'bad_mobile', sheet: 'Squads', row: 12, column: 'Captain mobile', message: '9 digits' }),
  I({ severity: 'error', code: 'missing_sheet', message: 'No Staff sheet' }),
  I({ severity: 'error', code: 'bad_date', sheet: 'Event', row: 8, column: 'Start date', message: 'Not a date' }),
  I({ severity: 'error', code: 'bad_mobile', sheet: 'Squads', row: 4, column: 'Captain mobile', message: '11 digits' }),
  I({ severity: 'warning', code: 'unknown_ground', sheet: 'Schedule', row: 3, column: 'Ground', message: 'Turf 9' }),
];

describe('sortIssues', () => {
  it('puts errors first, then sheets in workbook order, then rows, with sheet-less issues last', () => {
    const codes = sortIssues(sample).map((i) => `${i.severity}:${i.sheet ?? '-'}:${i.row ?? ''}`);
    expect(codes).toEqual([
      'error:Event:8',
      'error:Squads:4',
      'error:Squads:12',
      'error:-:',
      'warning:Squads:9',
      'warning:Schedule:3',
      'info:-:',
    ]);
  });

  it('does not mutate its input', () => {
    const copy = [...sample];
    sortIssues(sample);
    expect(sample).toEqual(copy);
  });
});

describe('countIssues / issueSheets', () => {
  it('counts by severity', () => {
    expect(countIssues(sample)).toEqual({ error: 4, warning: 2, info: 1 });
  });

  it('lists sheets in workbook order with a General bucket for sheet-less issues', () => {
    expect(issueSheets(sample)).toEqual([
      { key: 'Event', label: 'Event', count: 1 },
      { key: 'Squads', label: 'Squads', count: 3 },
      { key: 'Schedule', label: 'Schedule', count: 1 },
      { key: NO_SHEET, label: 'General', count: 2 },
    ]);
  });
});

describe('filterIssues', () => {
  it('filters by severity and sheet together', () => {
    expect(filterIssues(sample, { severity: 'error', sheet: 'Squads' })).toHaveLength(2);
    expect(filterIssues(sample, { severity: 'all', sheet: 'Squads' })).toHaveLength(3);
    expect(filterIssues(sample, { severity: 'warning', sheet: 'all' })).toHaveLength(2);
    expect(filterIssues(sample, { severity: 'all', sheet: 'all' })).toHaveLength(sample.length);
  });

  it('reaches issues with no sheet through NO_SHEET', () => {
    const general = filterIssues(sample, { severity: 'all', sheet: NO_SHEET });
    expect(general.map((i) => i.code).sort()).toEqual(['missing_sheet', 'note']);
  });
});

describe('groupBySeverity', () => {
  it('returns only non-empty groups, errors first', () => {
    const groups = groupBySeverity(filterIssues(sample, { severity: 'all', sheet: 'Schedule' }));
    expect(groups.map((g) => g.severity)).toEqual(['warning']);
    expect(groupBySeverity(sample).map((g) => [g.severity, g.issues.length])).toEqual([
      ['error', 4], ['warning', 2], ['info', 1],
    ]);
  });
});

describe('issueLocator', () => {
  it('joins sheet, row and column, skipping what is absent', () => {
    expect(issueLocator(I({ sheet: 'Squads', row: 12, column: 'Captain mobile' }))).toBe('Squads · row 12 · Captain mobile');
    expect(issueLocator(I({ sheet: 'Event' }))).toBe('Event');
    expect(issueLocator(I({}))).toBe('');
  });
});

describe('issuesCsvRows', () => {
  it('writes a header and one sorted row per issue', () => {
    const rows = issuesCsvRows(sample);
    expect(rows[0]).toEqual(['Severity', 'Sheet', 'Row', 'Column', 'Code', 'Message']);
    expect(rows).toHaveLength(sample.length + 1);
    expect(rows[1]).toEqual(['error', 'Event', '8', 'Start date', 'bad_date', 'Not a date']);
    expect(rows[4]).toEqual(['error', '', '', '', 'missing_sheet', 'No Staff sheet']);
  });
});

describe('verdict', () => {
  it('blocks on errors', () => {
    const v = verdict(sample, false);
    expect(v.tone).toBe('blocked');
    expect(v.title).toBe('4 errors to fix');
  });

  it('asks for a review when only warnings remain', () => {
    const v = verdict(sample.filter((i) => i.severity !== 'error'), true);
    expect(v.tone).toBe('review');
    expect(v.title).toBe('Ready to apply · 2 warnings to review');
  });

  it('is ready with nothing but notes', () => {
    expect(verdict([I({ severity: 'info' })], true).tone).toBe('ready');
    expect(verdict([], true).title).toBe('Ready to apply');
  });

  it('still blocks when the validator says not ok without an error issue', () => {
    expect(verdict([], false).tone).toBe('blocked');
  });

  it('uses the singular for one', () => {
    expect(verdict([I({})], false).title).toBe('1 error to fix');
  });
});
