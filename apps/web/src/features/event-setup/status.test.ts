import { describe, expect, it } from 'vitest';
import type { EventSetupBlueprint, SetupValidationResult } from '@semp/shared';
import { canEditSteps, canUpload, contactProgress, isStaleApplying, sectionStates, STALE_APPLYING_MS } from './status';
import { generatedDraws, matchPreviewRows, peopleCounts, squadPreviewRows } from './preview';
import type { EventSetupStatus } from './types';

const validation = { ok: true, issues: [], summary: {} as never, blueprint: null } as unknown as SetupValidationResult;

const at = (status: EventSetupStatus, extra: Partial<{ file_name: string | null; validation: SetupValidationResult | null; verify_report: { checked: number; failures: string[]; at: string } | null }> = {}) =>
  sectionStates({ status, file_name: 'w.xlsx', validation, verify_report: null, ...extra });

describe('sectionStates', () => {
  it('a fresh draft starts at the switches (the template is built for them), with everything after an upload locked', () => {
    expect(sectionStates({ status: 'draft', file_name: null, validation: null, verify_report: null })).toEqual({
      steps: 'current', template: 'open', upload: 'open', results: 'locked', apply: 'locked', after: 'locked',
    });
  });

  it('a draft that still carries a validation (steps changed after it) asks for the upload again', () => {
    expect(at('draft')).toEqual({
      template: 'done', steps: 'done', upload: 'current', results: 'open', apply: 'locked', after: 'locked',
    });
  });

  it('an invalid workbook points at the results', () => {
    expect(at('invalid')).toEqual({
      template: 'done', steps: 'done', upload: 'done', results: 'current', apply: 'locked', after: 'locked',
    });
  });

  it('a validated setup points at apply; applying and failed stay there', () => {
    for (const s of ['validated', 'applying', 'failed'] as const) {
      const st = at(s);
      expect(st.apply).toBe('current');
      expect(st.results).toBe('done');
      expect(st.after).toBe('locked');
    }
  });

  it('an applied setup points at the after section until it verifies clean', () => {
    expect(at('applied').after).toBe('current');
    expect(at('applied', { verify_report: { checked: 10, failures: ['x'], at: '' } }).after).toBe('current');
    expect(at('applied', { verify_report: { checked: 10, failures: [], at: '' } }).after).toBe('done');
  });

  it('an undone setup asks for the workbook again and locks apply', () => {
    const st = at('undone');
    expect(st.upload).toBe('current');
    expect(st.apply).toBe('locked');
    expect(st.after).toBe('open');
  });

  it('never marks more than one section current', () => {
    for (const s of ['draft', 'invalid', 'validated', 'applying', 'applied', 'failed', 'undone'] as const) {
      expect(Object.values(at(s)).filter((v) => v === 'current').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('contactProgress', () => {
  it('reads the API figures: replaced = total - placeholder, over the accounts the run created', () => {
    expect(contactProgress({ total: 300, placeholder: 40, replaced: 260 })).toEqual({ outstanding: 40, done: 260, of: 300 });
    expect(contactProgress({ total: 5, placeholder: 0, replaced: 5 })).toEqual({ outstanding: 0, done: 5, of: 5 });
    expect(contactProgress(null)).toBeNull();
  });
});

describe('stale runs and what may change', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('calls an applying row stale only past the API window', () => {
    expect(isStaleApplying({ status: 'applying', updated_at: ago(STALE_APPLYING_MS - 1000) }, now)).toBe(false);
    expect(isStaleApplying({ status: 'applying', updated_at: ago(STALE_APPLYING_MS + 1000) }, now)).toBe(true);
    expect(isStaleApplying({ status: 'failed', updated_at: ago(STALE_APPLYING_MS * 3) }, now)).toBe(false);
  });

  it('freezes steps and uploads while applied or mid-run, and frees them once a run is stale', () => {
    const fresh = ago(1000);
    for (const status of ['draft', 'invalid', 'validated', 'failed', 'undone'] as const) {
      expect(canUpload({ status, updated_at: fresh }, now)).toBe(true);
      expect(canEditSteps({ status, updated_at: fresh }, now)).toBe(true);
    }
    expect(canUpload({ status: 'applied', updated_at: fresh }, now)).toBe(false);
    expect(canEditSteps({ status: 'applied', updated_at: fresh }, now)).toBe(false);
    expect(canUpload({ status: 'applying', updated_at: fresh }, now)).toBe(false);
    expect(canUpload({ status: 'applying', updated_at: ago(STALE_APPLYING_MS + 1) }, now)).toBe(true);
  });
});

const bp = {
  key: 'k', eventType: 'intra',
  draws: [{ key: 'd1', sport: 'Football', discipline: 'Mixed' }, { key: 'd2', sport: 'Cricket', discipline: "Men's" }],
  competitors: [{ key: 'c1', name: 'Finance', kind: 'department' }],
  people: [
    { key: 'p1', name: 'Aarav Shah', phone: '9876543210', memberCode: 'E1' },
    { key: 'p2', name: 'Neha K', email: 'n@x.com' },
  ],
  staff: [{ key: 's1', name: 'Priya', eventRole: 'organiser' }, { key: 's2', name: 'Ref', eventRole: 'official' }],
  venue: { name: 'Ground', grounds: [{ key: 'g1', name: 'Turf 1', type: 'field' }] },
  squads: [
    { key: 'q1', drawKey: 'd1', name: 'Strikers', shortName: 'STR', competitorKey: 'c1', section: '1', members: [{ personKey: 'p1', role: 'captain' }, { personKey: 'p2', role: 'player' }] },
    { key: 'q2', drawKey: 'd1', name: 'Falcons', shortName: 'FAL', competitorKey: 'c1', members: [] },
    { key: 'q3', drawKey: 'd2', name: 'Bats', shortName: 'BAT', competitorKey: 'c1', members: [] },
  ],
  fixtures: [
    {
      kind: 'knockout-rows', drawKey: 'd1', utcOffset: '+05:30', rows: [
        { matchId: 'F', date: '2026-10-18', kickoff: '10:00', minutes: 20, groundKey: 'g1', home: { winnerOf: 'SF1' }, away: { winnerOf: 'SF2' } },
        { matchId: 'SF1', date: '2026-10-17', kickoff: '09:00', minutes: 20, groundKey: 'g1', home: { squadKey: 'q1' }, away: { squadKey: 'q2' } },
      ],
    },
    { kind: 'generate', drawKey: 'd2' },
  ],
} as unknown as EventSetupBlueprint;

describe('previews', () => {
  it('resolves squad keys to names, the competitor and the captain', () => {
    expect(squadPreviewRows(bp)[0]).toEqual({
      key: 'q1', name: 'Strikers', shortName: 'STR', draw: 'Football · Mixed', competitor: 'Finance',
      section: '1', members: 2, captain: 'Aarav Shah',
    });
    expect(squadPreviewRows(bp)[1].captain).toBe('');
  });

  it('orders matches by date and kickoff, resolving grounds and sides', () => {
    const rows = matchPreviewRows(bp);
    expect(rows.map((r) => r.matchId)).toEqual(['SF1', 'F']);
    expect(rows[0].ground).toBe('Turf 1');
    expect(rows[0].home).toEqual({ kind: 'squad', name: 'Strikers' });
    expect(rows[1].away).toEqual({ kind: 'winner', matchId: 'SF2' });
  });

  it('lists generated draws with their squad count', () => {
    expect(generatedDraws(bp)).toEqual([{ draw: "Cricket · Men's", squads: 1 }]);
  });

  it('counts people and staff', () => {
    expect(peopleCounts(bp)).toEqual({
      people: 2, withMobile: 1, withEmail: 1, withMemberCode: 1, staff: 2, organisers: 1, officials: 1, pocs: 0,
    });
  });
});
