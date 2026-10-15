import { describe, expect, it } from 'vitest';
import type { EventSetupBlueprint, SetupEventType, SetupSteps } from './blueprint.js';
import { SETUP_DEFAULT_STEPS, type SetupValidationResult } from './template.js';
import { validateSetupWorkbook } from './validate.js';
import { setupSampleGrids } from './workbook.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
type Sheets = Record<string, string[][]>;

const sample = (type: SetupEventType): Sheets =>
  Object.fromEntries(setupSampleGrids(type).map((g) => [g.name, g.rows.map((r) => [...r])]));

const run = (type: SetupEventType, sheets: Sheets, steps: Partial<SetupSteps> = {}) =>
  validateSetupWorkbook({ eventType: type, steps: { ...SETUP_DEFAULT_STEPS[type], ...steps }, sheets });

const colOf = (grid: string[][], header: string) => {
  const i = grid[0].indexOf(header);
  if (i < 0) throw new Error(`no column ${header}`);
  return i;
};
/** Set a cell by Excel row number and header. */
const set = (s: Sheets, sheet: string, row: number, header: string, value: string) => {
  s[sheet][row - 1][colOf(s[sheet], header)] = value;
};
const get = (s: Sheets, sheet: string, row: number, header: string) => s[sheet][row - 1][colOf(s[sheet], header)];
/** Set an Event field. */
const field = (s: Sheets, name: string, value: string) => {
  const r = s.Event.find((x) => x[0] === name);
  if (!r) throw new Error(`no field ${name}`);
  r[1] = value;
};
/** Append a row by header; returns its Excel row number. */
const addRow = (s: Sheets, sheet: string, rec: Record<string, string>) => {
  s[sheet].push(s[sheet][0].map((h) => rec[h] ?? ''));
  return s[sheet].length;
};
const dropColumn = (s: Sheets, sheet: string, header: string) => {
  const i = colOf(s[sheet], header);
  s[sheet] = s[sheet].map((r) => r.filter((_, j) => j !== i));
};
const codes = (r: SetupValidationResult, severity?: 'error' | 'warning' | 'info') =>
  r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const find = (r: SetupValidationResult, code: string) => r.issues.filter((i) => i.code === code);
const bp = (r: SetupValidationResult): EventSetupBlueprint => {
  if (!r.blueprint) throw new Error(`no blueprint: ${JSON.stringify(r.issues)}`);
  return r.blueprint;
};
const person = (r: SetupValidationResult, name: string) => bp(r).people.filter((p) => p.name === name);
const squad = (r: SetupValidationResult, name: string) => bp(r).squads.find((s) => s.name === name)!;
/** The sample's Squads sheet with the schedule removed (so squad edits do not trip schedule checks). */
const noSchedule = (type: SetupEventType = 'intra') => { const s = sample(type); delete s.Schedule; return s; };

/** A minimal intra workbook built from scratch. */
function tiny(): Sheets {
  return {
    Event: [
      ['Field', 'Value'], ['Event name', 'Tiny Cup 2026'], ['Host organisation', 'Tiny Org'], ['Campus', 'Pune'],
      ['Start date', '2026-10-17'], ['End date', '2026-10-18'], ['Venue', 'Tiny Ground'], ['Grounds', 'Turf 1, Turf 2'],
      ['Day dates', 'Day 1=2026-10-17; Day 2=2026-10-18'],
    ],
    Draws: [['Sport', 'Discipline', 'Format', 'Match minutes'], ['Football', 'Mixed', 'Knockout', '20']],
    Squads: [
      ['Squad name', 'Sport', 'Discipline', 'Plays for', 'Captain name', 'Captain mobile', 'Player 1', 'Player 2'],
      ['Alpha', 'Football', 'Mixed', 'Unit A', 'Asha Rao', '', 'Asha Rao', 'Bela Das'],
      ['Bravo', 'Football', 'Mixed', 'Unit B', 'Chirag Sen', '', 'Chirag Sen', 'Dinesh Iyer'],
      ['Charlie', 'Football', 'Mixed', 'Unit C', 'Esha Bose', '', 'Esha Bose', 'Firoz Ali'],
      ['Delta', 'Football', 'Mixed', 'Unit D', 'Gita Nair', '', 'Gita Nair', 'Hari Om'],
    ],
    Staff: [['Name', 'Role', 'Ground'], ['Boss Lady', 'Org owner', ''], ['Ref One', 'Official', 'Turf 1'], ['Ref Two', 'Official', 'Turf 2']],
  };
}

// ---------------------------------------------------------------------------
describe('samples', () => {
  for (const type of ['intra', 'campus', 'inter'] as const) {
    it(`the ${type} sample validates with no errors and no warnings`, () => {
      const r = run(type, sample(type));
      expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.summary).toMatchObject({ draws: 1, competitors: 6, squads: 6, grounds: 2, matches: 5, byes: 2, people: 42 });
    });
  }

  it('a tiny hand-built workbook validates too', () => {
    const r = run('intra', tiny());
    expect(codes(r, 'error')).toEqual([]);
    expect(codes(r, 'warning')).toEqual([]);
    expect(bp(r).fixtures).toEqual([{ kind: 'generate', drawKey: 'd1' }]);
  });
});

// ---------------------------------------------------------------------------
describe('structure', () => {
  it('a missing required sheet is an error and leaves no blueprint', () => {
    const s = sample('intra');
    delete s.Draws;
    const r = run('intra', s);
    expect(find(r, 'missing_sheet')).toMatchObject([{ severity: 'error', sheet: 'Draws' }]);
    expect(r.ok).toBe(false);
    expect(r.blueprint).toBeNull();
  });

  it('a missing Staff sheet is an error but the blueprint is still previewed', () => {
    const s = sample('intra');
    delete s.Staff;
    const r = run('intra', s);
    expect(find(r, 'missing_sheet')[0]).toMatchObject({ sheet: 'Staff' });
    expect(r.blueprint).not.toBeNull();
  });

  it('a missing required column is an error naming the template header', () => {
    const s = sample('intra');
    dropColumn(s, 'Squads', 'Captain name');
    const r = run('intra', s);
    expect(find(r, 'missing_column')).toMatchObject([{ severity: 'error', sheet: 'Squads', column: 'Captain name' }]);
    expect(r.blueprint).toBeNull();
  });

  it('an empty required sheet is one error, not a cascade', () => {
    const s = sample('intra');
    s.Staff = [[''], ['']];
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual(['empty_sheet']);
  });

  it('reads sheets in any case and headers by alias; lists unknown columns once', () => {
    const s = tiny();
    s.squads = [
      ['Team Name', 'Process Name', "Captain's Name", "Captain's UID", 'Captain Mobile No.', 'Vice Captain', 'Location', 'Remarks', 'Sport', 'Discipline', 'Player 1', 'Substitute Player 1'],
      ['Alpha', 'Unit A', 'ASHA RAO', 'U123', '+91 98765 43210', 'bela das', 'Pune', 'x', 'Football', 'Mixed', 'Asha Rao', 'Zed Khan'],
      ['Bravo', 'Unit B', 'Chirag Sen', '', '', '', 'Pune', '', 'Football', 'Mixed', 'Chirag Sen', ''],
    ];
    delete s.Squads;
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    expect(find(r, 'unknown_columns')).toHaveLength(1);
    expect(find(r, 'unknown_columns')[0].message).toContain('"Location", "Remarks"');
    const asha = person(r, 'Asha Rao')[0];
    expect(asha).toMatchObject({ memberCode: 'U123', phone: '9876543210' });
    expect(squad(r, 'Alpha').members.map((m) => m.role)).toEqual(['captain', 'vice_captain', 'substitute']);
  });

  it('skips blank rows, title rows and blank-ish words', () => {
    const s = tiny();
    set(s, 'Squads', 2, 'Player 2', 'TBD');
    s.Squads = [['Squads for the Tiny Cup'], [], ...s.Squads, ['NA', '-', 'tbd', 'null', 'N/A', 'nil', 'none', ''], ['', '', '', '', '', '', '', '']];
    const r = run('intra', s);
    expect(find(r, 'title_rows_skipped')).toMatchObject([{ severity: 'info', row: 3 }]);
    expect(codes(r, 'error')).toEqual([]);
    expect(bp(r).squads.map((x) => x.key)).toEqual(['s4', 's5', 's6', 's7']);
    expect(squad(r, 'Alpha').members).toHaveLength(1);
  });

  it('trims and collapses whitespace in cells', () => {
    const s = tiny();
    set(s, 'Squads', 2, 'Squad name', '   Alpha    Team  ');
    const r = run('intra', s);
    expect(bp(r).squads[0].name).toBe('Alpha Team');
  });

  it('an optional sheet with headers and no rows is not checked for columns', () => {
    const s = tiny();
    s.Schedule = [['Match', 'When']];
    s.People = [['Who']];
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    expect(bp(r).fixtures).toEqual([{ kind: 'generate', drawKey: 'd1' }]);
  });

  it('never throws on junk', () => {
    const junk = validateSetupWorkbook({ eventType: 'intra', steps: undefined as unknown as SetupSteps, sheets: { Event: [[null as unknown as string, 5 as unknown as string]], Draws: 'x' as unknown as string[][] } });
    expect(junk.ok).toBe(false);
    const bad = validateSetupWorkbook({ eventType: 'nope' as SetupEventType, steps: SETUP_DEFAULT_STEPS.intra, sheets: {} });
    expect(codes(bad)).toEqual(['bad_event_type']);
    expect(bad.blueprint).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('Event sheet', () => {
  it('reads DD/MM/YYYY, DD-MM-YYYY and Excel serial dates', () => {
    const s = tiny();
    field(s, 'Start date', '17/10/2026');
    field(s, 'End date', '46313');
    let r = run('intra', s);
    expect(bp(r).championship).toMatchObject({ startDate: '2026-10-17', endDate: '2026-10-18' });
    field(s, 'Start date', '17-10-2026');
    r = run('intra', s);
    expect(bp(r).championship.startDate).toBe('2026-10-17');
  });

  it('errors on an unreadable date and on an end before the start', () => {
    const s = tiny();
    field(s, 'Start date', 'next Saturday');
    expect(find(run('intra', s), 'bad_date')[0]).toMatchObject({ severity: 'error', sheet: 'Event', row: 5, column: 'Start date' });
    field(s, 'Start date', '2026-10-19');
    expect(codes(run('intra', s), 'error')).toContain('end_before_start');
  });

  it('a required field missing or blank is an error; intra needs a campus', () => {
    const s = tiny();
    s.Event = s.Event.filter((r) => r[0] !== 'Campus');
    field(s, 'Venue', '');
    const r = run('intra', s);
    expect(find(r, 'missing_field').map((i) => i.column).sort()).toEqual(['Campus', 'Venue']);
  });

  it('parses day dates; errors on a bad entry; warns on a day outside the event', () => {
    const s = tiny();
    field(s, 'Day dates', 'Day 1=2026-10-17; Day two=2026-10-18; Day 3=2026-10-25');
    const r = run('intra', s);
    expect(find(r, 'bad_day_dates')).toHaveLength(1);
    expect(find(r, 'day_outside_event')).toHaveLength(1);
  });

  it('grounds: listed once, keys g1.., duplicates warned; ground type and visibility checked', () => {
    const s = tiny();
    field(s, 'Grounds', 'Turf 1, Turf 2, turf 1');
    s.Event.push(['Ground type', 'turf'], ['Visibility', 'Private']);
    const r = run('intra', s);
    expect(bp(r).venue.grounds).toEqual([{ key: 'g1', name: 'Turf 1', type: 'field' }, { key: 'g2', name: 'Turf 2', type: 'field' }]);
    expect(find(r, 'duplicate_ground')).toHaveLength(1);
    expect(find(r, 'bad_value')[0]).toMatchObject({ severity: 'error', column: 'Ground type' });
    expect(bp(r).championship.visibility).toBe('private');
  });

  it('grounds that name nothing are an error', () => {
    const s = tiny();
    field(s, 'Grounds', ' , ,');
    expect(find(run('intra', s), 'missing_field')[0]).toMatchObject({ column: 'Grounds' });
  });

  it('points default to 10/7/4/1 and must be numbers', () => {
    const s = tiny();
    expect(bp(run('intra', s)).championship.placement).toEqual({ winner: 10, runner_up: 7, semi_finalist: 4, participation: 1 });
    s.Event.push(['Points: winner', '12'], ['Points: runner-up', 'seven']);
    const r = run('intra', s);
    expect(bp(r).championship.placement).toMatchObject({ winner: 12, runner_up: 7 });
    expect(find(r, 'bad_number')[0]).toMatchObject({ column: 'Points: runner-up' });
  });

  it('an Event sheet filled across the top is read too', () => {
    const s = tiny();
    s.Event = [s.Event.slice(1).map((r) => r[0]), s.Event.slice(1).map((r) => r[1])];
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    expect(find(r, 'event_read_across')).toHaveLength(1);
    expect(bp(r).championship).toMatchObject({ name: 'Tiny Cup 2026', startDate: '2026-10-17' });
  });

  it('a host short name over 12 characters is cut, with a warning', () => {
    const s = tiny();
    s.Event.push(['Host short name', 'Tiny Organisation Ltd']);
    const r = run('intra', s);
    expect(find(r, 'short_name_too_long')).toHaveLength(1);
    expect(bp(r).org.shortName).toBe('Tiny Organis');
    expect(bp(r).placeholder.emailStem).toBe('tiny-organis');
  });
});

// ---------------------------------------------------------------------------
describe('Draws sheet', () => {
  it('a Football draw with no preset gets fest_2x10_ko and the sheet timings', () => {
    const r = run('intra', sample('intra'));
    expect(bp(r).draws).toEqual([{
      key: 'd1', sport: 'Football', discipline: 'Mixed', format: 'Knockout', squadMin: 6, squadMax: 10, thirdPlace: false,
      scoring: { presetKey: 'fest_2x10_ko', name: 'Football Mixed — 20 min, 5 min extra time, penalties', matchMinutes: 20, extraTimeMinutes: 5, penaltyKicks: 5 },
    }]);
  });

  it('a Football league defaults to the drawable fest_2x10; other sports keep their default', () => {
    const s = tiny();
    s.Draws.push(['Badminton', "Men's Singles", 'League', '30'], ['Football', "Women's", 'League', '']);
    const r = run('intra', s);
    expect(bp(r).draws[1].scoring).toBeUndefined();
    expect(bp(r).draws[2].scoring?.presetKey).toBe('fest_2x10');
    expect(find(r, 'timing_without_preset')).toHaveLength(1);
  });

  it('checks format, numbers, min <= max, yes/no, duplicates and presets', () => {
    const s = tiny();
    s.Draws = [
      ['Sport', 'Discipline', 'Format', 'Squad min', 'Squad max', 'Match minutes', 'Third-place match', 'Scoring preset'],
      ['Football', 'Mixed', 'Swiss', '8', '6', 'twenty', 'maybe', ''],
      ['football', 'mixed', 'Knockout', '', '', '', '', ''],
      ['Cricket', 'Mixed', 'KO', '', '', '', 'yes', 'no_such_preset'],
      ['Basketball', 'Mixed', 'Knockout', '', '', '', '', 'fest_2x10_ko'],
    ];
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual(expect.arrayContaining(['bad_value', 'squad_min_over_max', 'bad_number', 'duplicate_draw', 'unknown_preset', 'preset_wrong_sport']));
    const draws = bp(r).draws;
    expect(draws.map((d) => d.key)).toEqual(['d1', 'd2', 'd3']);
    expect(draws[1]).toMatchObject({ sport: 'Cricket', format: 'Knockout', thirdPlace: true });
  });
});

// ---------------------------------------------------------------------------
describe('Squads sheet', () => {
  it('a squad for a draw that is not on Draws is an error', () => {
    const s = tiny();
    set(s, 'Squads', 3, 'Discipline', "Women's");
    expect(find(run('intra', s), 'unknown_draw')[0]).toMatchObject({ severity: 'error', sheet: 'Squads', row: 3 });
  });

  it('a duplicate squad name in a draw is an error', () => {
    const s = tiny();
    set(s, 'Squads', 3, 'Squad name', 'alpha');
    expect(find(run('intra', s), 'duplicate_squad_name')[0]).toMatchObject({ severity: 'error', row: 3, column: 'Squad name' });
  });

  it('short codes: kept when given, cut over 12, unique, made up when blank', () => {
    const s = tiny();
    s.Squads[0].push('Short code');
    s.Squads[1].push('ALP');
    s.Squads[2].push('alp');
    s.Squads[3].push('A VERY LONG CODE');
    s.Squads[4].push('');
    const r = run('intra', s);
    expect(find(r, 'duplicate_short_code')[0]).toMatchObject({ severity: 'error', row: 3 });
    expect(find(r, 'short_code_too_long')).toHaveLength(1);
    expect(bp(r).squads.map((x) => x.shortName)).toEqual(['ALP', 'alp', 'A VERY LONG', 'DELT']);
  });

  it('intra: a second squad of one unit gets its own unit, with a warning', () => {
    const s = tiny();
    set(s, 'Squads', 3, 'Plays for', 'Unit A');
    const r = run('intra', s);
    expect(find(r, 'competitor_split')).toMatchObject([{ severity: 'warning', row: 3 }]);
    const comps = bp(r).competitors;
    expect(comps.map((c) => c.name)).toEqual(['Unit A', 'Unit A · Bravo', 'Unit C', 'Unit D']);
    expect(comps.every((c) => c.kind === 'department')).toBe(true);
    expect(squad(r, 'Bravo').competitorKey).toBe(comps[1].key);
    expect(r.ok).toBe(true);
  });

  it('intra: a split unit never takes the name of a real one', () => {
    const s = tiny();
    set(s, 'Squads', 3, 'Plays for', 'Unit A');
    set(s, 'Squads', 4, 'Plays for', 'Unit A Bravo');
    const r = run('intra', s);
    const names = bp(r).competitors.map((c) => c.name);
    expect(names).toContain('Unit A · Bravo (2)');
    expect(new Set(bp(r).squads.map((x) => x.competitorKey)).size).toBe(4);
  });

  for (const type of ['inter', 'campus'] as const) {
    it(`${type}: two squads of one competitor in a draw is an error`, () => {
      const s = noSchedule(type);
      set(s, 'Squads', 3, 'Plays for', get(s, 'Squads', 2, 'Plays for'));
      const r = run(type, s);
      expect(find(r, 'competitor_squad_clash')).toMatchObject([{ severity: 'error', row: 3 }]);
      expect(find(r, 'competitor_split')).toEqual([]);
    });
  }

  it('members: duplicates kept once, captain off the list added, roles ranked', () => {
    const s = tiny();
    s.Squads[0].push('Vice-captain name', 'Player 3', 'Substitute 1');
    s.Squads[1].push('Bela Das', 'Bela Das', 'Kiran Pal');
    s.Squads[2].push('', '', '');
    s.Squads[3].push('', '', '');
    s.Squads[4].push('', '', '');
    set(s, 'Squads', 3, 'Player 1', 'Someone Else');
    const r = run('intra', s);
    expect(find(r, 'duplicate_in_squad')).toMatchObject([{ severity: 'warning', row: 2, column: 'Player 3' }]);
    expect(find(r, 'captain_not_listed')).toMatchObject([{ severity: 'info', row: 3, column: 'Captain name' }]);
    expect(squad(r, 'Alpha').members.map((m) => m.role)).toEqual(['captain', 'vice_captain', 'substitute']);
    expect(squad(r, 'Bravo').members.map((m) => m.role)).toEqual(['captain', 'player', 'player']);
  });

  it('a squad that does not say who it plays for is an error', () => {
    const s = tiny();
    set(s, 'Squads', 4, 'Plays for', '');
    expect(find(run('intra', s), 'missing_value')).toMatchObject([{ severity: 'error', row: 4, column: 'Plays for' }]);
  });

  it('a squad with no captain is an error', () => {
    const s = tiny();
    set(s, 'Squads', 2, 'Captain name', '');
    expect(find(run('intra', s), 'missing_value')[0]).toMatchObject({ severity: 'error', row: 2, column: 'Captain name' });
  });

  it('squad size against the draw: warnings', () => {
    const s = noSchedule();
    set(s, 'Squads', 2, 'Player 6', '');
    set(s, 'Squads', 2, 'Player 5', '');
    set(s, 'Squads', 2, 'Substitute 1', '');
    for (const [i, n] of [[7, 'X One'], [8, 'X Two'], [9, 'X Three'], [10, 'X Four']] as const) set(s, 'Squads', 3, `Player ${i}`, n);
    const r = run('intra', s);
    expect(find(r, 'squad_too_small')).toMatchObject([{ severity: 'warning', row: 2 }]);
    expect(find(r, 'squad_too_large')).toMatchObject([{ severity: 'warning', row: 3 }]);
  });

  it('extra player columns and per-player contacts are read', () => {
    const s = tiny();
    s.Squads[0].push('Player 13', 'Player 13 mobile', 'Player 13 ID');
    s.Squads[1].push('Mohan Lal', '9123456789', 'E77');
    for (const r of s.Squads.slice(2)) r.push('', '', '');
    const r = run('intra', s);
    expect(find(r, 'unknown_columns')).toEqual([]);
    expect(person(r, 'Mohan Lal')[0]).toMatchObject({ key: 'E77', memberCode: 'E77', phone: '9123456789' });
  });
});

// ---------------------------------------------------------------------------
describe('people: who is the same person', () => {
  it('the same name on two squads is one person', () => {
    const s = tiny();
    set(s, 'Squads', 3, 'Player 2', 'BELA DAS');
    const r = run('intra', s);
    expect(person(r, 'Bela Das')).toHaveLength(1);
    expect(find(r, 'same_person_several_squads')).toMatchObject([{ severity: 'info' }]);
    expect(r.summary.peopleInSeveralSquads).toBe(1);
    expect(squad(r, 'Bravo').members.map((m) => m.personKey)).toContain('bela das');
  });

  it('the same name with two different IDs is two people, with a warning', () => {
    const s = tiny();
    s.Squads[0].push('Captain ID');
    s.Squads[1].push('E1');
    s.Squads[2].push('E2');
    s.Squads[3].push('');
    s.Squads[4].push('');
    set(s, 'Squads', 3, 'Captain name', 'Asha Rao');
    set(s, 'Squads', 3, 'Player 1', 'Asha Rao');
    const r = run('intra', s);
    expect(find(r, 'same_name_different_ids')).toMatchObject([{ severity: 'warning' }]);
    expect(person(r, 'Asha Rao').map((p) => p.key)).toEqual(['E1', 'E2']);
    expect(squad(r, 'Alpha').members[0].personKey).toBe('E1');
    expect(squad(r, 'Bravo').members[0].personKey).toBe('E2');
  });

  it('one ID under two spellings is one person, with a warning', () => {
    const s = tiny();
    s.Squads[0].push('Captain ID');
    s.Squads[1].push('475682');
    s.Squads[2].push('475682');
    s.Squads[3].push('');
    s.Squads[4].push('');
    set(s, 'Squads', 3, 'Captain name', 'Siddaram Chikkabenur');
    set(s, 'Squads', 3, 'Player 1', '');
    set(s, 'Squads', 2, 'Captain name', 'Siddharam Chikabenur');
    set(s, 'Squads', 2, 'Player 1', '');
    const r = run('intra', s);
    expect(find(r, 'same_id_different_names')).toHaveLength(1);
    expect(bp(r).people.filter((p) => p.memberCode === '475682')).toHaveLength(1);
  });

  it('look-alike names in one competitor are flagged; in different competitors they are not', () => {
    const s = tiny();
    s.Squads[0].push('Substitute 1');
    s.Squads[1].push('Asha');
    s.Squads[2].push('Chirag Senn');
    s.Squads[3].push('Bela Das');
    s.Squads[4].push('');
    const r = run('intra', s);
    const hits = find(r, 'possible_same_person');
    expect(hits).toHaveLength(2);
    expect(hits[0].message).toContain('"Asha Rao"');
    expect(hits[0].message).toContain('"Asha"');
    expect(hits[1].message).toContain('"Chirag Senn"');
    // Bela Das in Unit C is the SAME name, so the same person - not a look-alike.
    expect(person(r, 'Bela Das')).toHaveLength(1);
  });

  it('look-alikes with two different IDs are not flagged', () => {
    const s = tiny();
    s.Squads[0].push('Captain ID', 'Vice-captain name', 'Vice-captain ID');
    s.Squads[1].push('E1', 'Asha Raoo', 'E2');
    for (const r of s.Squads.slice(2)) r.push('', '', '');
    expect(find(run('intra', s), 'possible_same_person')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('People sheet', () => {
  it('links by ID then exact name; warns on unmatched rows, mismatched IDs and conflicting contacts', () => {
    const s = tiny();
    s.Squads[0].push('Captain ID');
    s.Squads[1].push('E1');
    for (const r of s.Squads.slice(2)) r.push('');
    set(s, 'Squads', 2, 'Captain mobile', '9876500001');
    s.People = [
      ['Name', 'ID', 'Mobile', 'Email', 'Gender'],
      ['Wrong Name', 'E1', '9876500002', 'asha@x.com', 'F'], // by ID; mobile conflicts with Squads
      ['bela das', 'B7', '9876500003', '', 'male'], // by name; gives Bela a member code
      ['Nobody Here', '', '9876500004', '', ''],
      ['Chirag Sen', 'C9', '', '', 'unknown'], // by name, but Chirag has no ID -> linked
    ];
    const r = run('intra', s);
    expect(person(r, 'Asha Rao')[0]).toMatchObject({ phone: '9876500001', email: 'asha@x.com', gender: 'female' });
    expect(person(r, 'Bela Das')[0]).toMatchObject({ memberCode: 'B7', phone: '9876500003', gender: 'male' });
    expect(find(r, 'conflicting_mobile')).toHaveLength(1);
    expect(find(r, 'people_row_unmatched')).toMatchObject([{ severity: 'warning', sheet: 'People', row: 4 }]);
    expect(find(r, 'bad_value')).toMatchObject([{ sheet: 'People', row: 5, column: 'Gender' }]);
  });

  it('a name match with a different ID is not linked', () => {
    const s = tiny();
    s.Squads[0].push('Captain ID');
    s.Squads[1].push('E1');
    for (const r of s.Squads.slice(2)) r.push('');
    s.People = [['Name', 'ID', 'Mobile'], ['Asha Rao', 'E9', '9876500002']];
    const r = run('intra', s);
    expect(find(r, 'people_id_mismatch')).toHaveLength(1);
    expect(person(r, 'Asha Rao')[0].phone).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('contacts', () => {
  it('takes the first valid mobile; a bad one is a warning and a placeholder', () => {
    const s = tiny();
    set(s, 'Squads', 2, 'Captain mobile', '12345 / +91 98765-43210 / 9123456789');
    set(s, 'Squads', 3, 'Captain mobile', '98765');
    const r = run('intra', s);
    expect(person(r, 'Asha Rao')[0].phone).toBe('9876543210');
    expect(find(r, 'bad_mobile')).toMatchObject([{ severity: 'warning', row: 3, column: 'Captain mobile' }]);
    expect(person(r, 'Chirag Sen')[0].phone).toBeUndefined();
  });

  it('one mobile on two people is used for neither', () => {
    const s = tiny();
    set(s, 'Squads', 2, 'Captain mobile', '9876543210');
    set(s, 'Squads', 3, 'Captain mobile', '09876543210');
    const r = run('intra', s);
    expect(find(r, 'shared_mobile')).toHaveLength(1);
    expect(find(r, 'shared_mobile')[0].message).toContain('98xxxxxx10');
    expect(person(r, 'Asha Rao')[0].phone).toBeUndefined();
    expect(person(r, 'Chirag Sen')[0].phone).toBeUndefined();
  });

  it('emails: bad ones warned, shared ones used for neither', () => {
    const s = tiny();
    s.Squads[0].push('Captain email');
    s.Squads[1].push('team@unit.com');
    s.Squads[2].push('Team@Unit.com');
    s.Squads[3].push('not an email');
    s.Squads[4].push('gita@unit.com');
    const r = run('intra', s);
    expect(find(r, 'shared_email')).toHaveLength(1);
    expect(find(r, 'bad_email')).toMatchObject([{ row: 4, column: 'Captain email' }]);
    expect(person(r, 'Asha Rao')[0].email).toBeUndefined();
    expect(person(r, 'Gita Nair')[0].email).toBe('gita@unit.com');
  });

  it('placeholder contacts from a re-upload read as none, silently', () => {
    const s = tiny();
    s.Squads[0].push('Captain email');
    s.Squads[1].push('asha-rao-tiny-1@placeholder.invalid');
    for (const r of s.Squads.slice(2)) r.push('');
    set(s, 'Squads', 2, 'Captain mobile', '5000000017');
    const r = run('intra', s);
    expect(codes(r, 'warning')).toEqual([]);
    expect(person(r, 'Asha Rao')[0]).toEqual({ key: 'asha rao', name: 'Asha Rao' });
  });

  it('counts people with a mobile and people on a placeholder', () => {
    const s = tiny();
    set(s, 'Squads', 2, 'Captain mobile', '9876543210');
    s.Squads[0].push('Captain email');
    s.Squads[1].push('');
    s.Squads[2].push('chirag@x.com');
    s.Squads[3].push('');
    s.Squads[4].push('');
    const r = run('intra', s);
    expect(r.summary).toMatchObject({ people: 8, peopleWithMobile: 1, peopleOnPlaceholder: 6 });
  });
});

// ---------------------------------------------------------------------------
describe('Staff sheet', () => {
  it('maps roles and keeps contacts', () => {
    const s = tiny();
    s.Staff = [
      ['Name', 'Role', 'Mobile', 'Email', 'Ground'],
      ['Owner Person', 'Org owner', '9876500010', 'Owner@Org.com', ''],
      ['Admin Person', 'Org admin', '', '', ''],
      ['Org Person', 'Organizer', '', '', ''],
      ['Ref Person', 'Referee', '', '', 'turf 2'],
    ];
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    expect(bp(r).staff).toEqual([
      { key: 'st2', name: 'Owner Person', orgRole: 'owner', eventRole: 'organiser', phone: '9876500010', email: 'owner@org.com' },
      { key: 'st3', name: 'Admin Person', orgRole: 'admin' },
      { key: 'st4', name: 'Org Person', eventRole: 'organiser' },
      { key: 'st5', name: 'Ref Person', eventRole: 'official', groundKey: 'g2', note: 'Scores every match on Turf 2' },
    ]);
  });

  it('errors on an unknown role or ground; warns on an official with no ground', () => {
    const s = tiny();
    s.Staff.push(['Coach', 'Coach', ''], ['Ref Three', 'Official', 'Turf 9'], ['Ref Four', 'Official', '']);
    const r = run('intra', s);
    expect(find(r, 'bad_role')).toMatchObject([{ severity: 'error', row: 5 }]);
    expect(find(r, 'unknown_ground')).toMatchObject([{ severity: 'error', sheet: 'Staff', row: 6 }]);
    expect(find(r, 'official_without_ground')).toMatchObject([{ severity: 'warning', row: 7 }]);
  });

  it('needs an organiser or org owner', () => {
    const s = tiny();
    s.Staff = [['Name', 'Role', 'Ground'], ['Admin', 'Org admin', ''], ['Ref', 'Official', 'Turf 1']];
    expect(find(run('intra', s), 'no_organiser')).toMatchObject([{ severity: 'error' }]);
  });

  it('inter: a POC must name a competing organisation', () => {
    const s = noSchedule('inter');
    const ok = run('inter', s);
    const beta = bp(ok).competitors.find((c) => c.name === 'Beta Industries')!;
    expect(bp(ok).staff.find((x) => x.eventRole === 'poc')!.competitorKey).toBe(beta.key);
    const pocRow = s.Staff.findIndex((r) => r[colOf(s.Staff, 'Role')] === 'POC') + 1;
    set(s, 'Staff', pocRow, 'For organisation', 'Omega Corp');
    set(s, 'Staff', pocRow + 1, 'For organisation', '');
    const r = run('inter', s);
    expect(find(r, 'unknown_competitor')).toMatchObject([{ severity: 'error', row: pocRow }]);
    expect(find(r, 'missing_value')).toMatchObject([{ severity: 'error', row: pocRow + 1, column: 'For organisation' }]);
  });
});

// ---------------------------------------------------------------------------
describe('Schedule sheet', () => {
  // Sample schedule rows: 2 M1 (A v B), 3 M2 (C v D), 4 M3 (W M1 v E), 5 M4 (F v W M2), 6 M5 final.
  it('reads the bracket: dates, Day N, 9:00 AM / 4:00 PM, minutes, byes', () => {
    const r = run('intra', sample('intra'));
    const f = bp(r).fixtures;
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('knockout-rows');
    if (f[0].kind !== 'knockout-rows') return;
    expect(f[0].utcOffset).toBe('+05:30');
    expect(f[0].rows.map((x) => [x.matchId, x.date, x.kickoff, x.minutes, x.groundKey])).toEqual([
      ['M1', '2026-10-17', '09:00', 25, 'g1'],
      ['M2', '2026-10-17', '09:00', 25, 'g2'],
      ['M3', '2026-10-17', '10:00', 20, 'g1'],
      ['M4', '2026-10-17', '10:00', 20, 'g2'],
      ['M5', '2026-10-18', '16:00', 20, 'g1'],
    ]);
    expect(f[0].rows[2].home).toEqual({ winnerOf: 'M1' });
    expect(f[0].rows[2].away).toEqual({ squadKey: 's6' });
    expect(r.summary.byes).toBe(2);
  });

  it('counts one bye in a bracket of three', () => {
    const s = tiny();
    s.Squads.pop();
    s.Schedule = [
      ['Match ID', 'Date', 'Kickoff', 'Ground', 'Side 1', 'Side 2'],
      ['Q1', '2026-10-17', '9:00 am', 'Turf 1', 'Alpha', 'Bravo'],
      ['F', '2026-10-17', '11:00', 'Turf 1', 'winner of q1', 'Charlie'],
    ];
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    expect(r.summary).toMatchObject({ matches: 2, byes: 1 });
  });

  it('an unknown ground is an error', () => {
    const s = sample('intra');
    set(s, 'Schedule', 3, 'Ground', 'Turf 9');
    expect(find(run('intra', s), 'unknown_ground')).toMatchObject([{ severity: 'error', sheet: 'Schedule', row: 3, column: 'Ground' }]);
  });

  it('an unknown squad is an error; a unique prefix in the section is read', () => {
    const s = sample('intra');
    set(s, 'Schedule', 2, 'Side 1', 'Finance Eagles');
    expect(find(run('intra', s), 'unknown_squad')).toMatchObject([{ severity: 'error', row: 2, column: 'Side 1' }]);
    set(s, 'Schedule', 2, 'Side 1', 'Finance Fal');
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    expect(find(r, 'squad_matched_by_prefix')).toHaveLength(1);
  });

  it('a Winner of a match that does not exist is an error', () => {
    const s = sample('intra');
    set(s, 'Schedule', 4, 'Side 1', 'Winner of M9');
    expect(find(run('intra', s), 'unknown_match_ref')).toMatchObject([{ severity: 'error', row: 4, column: 'Side 1' }]);
  });

  it('two finals is an error', () => {
    const s = sample('intra');
    s.Schedule = s.Schedule.filter((_, i) => i !== 5); // drop M5: M3 and M4 both feed nothing
    const r = run('intra', s);
    expect(find(r, 'two_finals')).toHaveLength(1);
    expect(find(r, 'two_finals')[0].message).toContain('M3, row 4; M4, row 5');
  });

  it('a squad missing from the schedule is an error', () => {
    const s = sample('intra');
    addRow(s, 'Squads', { 'Squad name': 'Admin Aces', Sport: 'Football', Discipline: 'Mixed', 'Plays for': 'Admin', 'Captain name': 'Q Person', 'Player 1': 'Q Person' });
    const r = run('intra', s);
    expect(find(r, 'squad_not_in_schedule')).toHaveLength(1);
    expect(find(r, 'squad_not_in_schedule')[0].message).toContain('Admin Aces');
  });

  it('two matches on one ground at once is an error', () => {
    const s = sample('intra');
    set(s, 'Schedule', 3, 'Ground', 'Turf 1');
    expect(find(run('intra', s), 'ground_clash')).toMatchObject([{ severity: 'error', row: 3 }]);
  });

  it('Day N maps through Day dates; an unmapped day is an error', () => {
    const s = sample('intra');
    set(s, 'Schedule', 6, 'Date', 'Day 3');
    expect(find(run('intra', s), 'unmapped_day')).toMatchObject([{ severity: 'error', row: 6, column: 'Date' }]);
  });

  it('reads "Day 1 (15 Oct)" as Day 1, whatever stale date follows it', () => {
    const s = sample('intra');
    set(s, 'Schedule', 4, 'Date', 'Day 1 (15 Oct)');
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    const f = bp(r).fixtures[0];
    if (f.kind !== 'knockout-rows') throw new Error('expected rows');
    expect(f.rows[2].date).toBe('2026-10-17');
  });

  it('maps a bracket error to its row', () => {
    const s = tiny();
    s.Squads.push(['Echo', 'Football', 'Mixed', 'Unit E', 'Ira Roy', '', 'Ira Roy', '']);
    s.Schedule = [
      ['Match ID', 'Date', 'Kickoff', 'Ground', 'Side 1', 'Side 2'],
      ['Q1', '2026-10-17', '09:00', 'Turf 1', 'Alpha', 'Bravo'],
      ['S1', '2026-10-17', '10:00', 'Turf 1', 'Winner of Q1', 'Charlie'],
      ['F', '2026-10-17', '11:00', 'Turf 1', 'Winner of S1', 'Delta'],
      ['X', '2026-10-17', '12:00', 'Turf 2', 'Winner of F', 'Echo'],
    ];
    const r = run('intra', s);
    // F (row 4) takes Delta directly in round 3: only one-round byes are supported.
    expect(find(r, 'bad_bracket')).toMatchObject([{ severity: 'error', sheet: 'Schedule', row: 4 }]);
  });

  it('a winner used twice, a squad named twice, a bye row: errors', () => {
    const s = sample('intra');
    set(s, 'Schedule', 5, 'Side 2', 'Winner of M1');
    let r = run('intra', s);
    expect(find(r, 'winner_used_twice')).toHaveLength(1);
    const t = sample('intra');
    set(t, 'Schedule', 3, 'Side 1', get(t, 'Schedule', 2, 'Side 1'));
    r = run('intra', t);
    expect(find(r, 'squad_twice_in_schedule')).toHaveLength(1);
    const u = sample('intra');
    set(u, 'Schedule', 4, 'Side 2', 'BYE');
    expect(find(run('intra', u), 'bye_row')).toHaveLength(1);
  });

  it('a match before the match it follows has finished is an error', () => {
    const s = sample('intra');
    set(s, 'Schedule', 4, 'Kickoff', '09:10');
    expect(find(run('intra', s), 'starts_before_feeder')).toMatchObject([{ severity: 'error', row: 4 }]);
  });

  it('a person in two squads that play at once, or on both sides of one match', () => {
    const s = tiny();
    s.Squads.splice(4, 1); // drop Delta: four mixed squads make a clean bracket
    s.Squads.push(['Echo', 'Football', 'Mixed', 'Unit E', 'Ira Roy', '', 'Ira Roy', 'Bela Das']);
    s.Draws.push(['Football', "Women's", 'Knockout', '20']);
    s.Squads.push(['Echo W', 'Football', "Women's", 'Unit E', 'Ira Roy', '', 'Ira Roy', '']);
    s.Squads.push(['Foxtrot W', 'Football', "Women's", 'Unit F', 'Jaya Lal', '', 'Jaya Lal', '']);
    field(s, 'Grounds', 'Turf 1, Turf 2, Turf 3');
    s.Schedule = [
      ['Match ID', 'Sport', 'Discipline', 'Date', 'Kickoff', 'Ground', 'Side 1', 'Side 2'],
      ['M1', 'Football', 'Mixed', '2026-10-17', '09:00', 'Turf 1', 'Alpha', 'Echo'],
      ['M2', 'Football', 'Mixed', '2026-10-17', '09:00', 'Turf 2', 'Bravo', 'Charlie'],
      ['M3', 'Football', 'Mixed', '2026-10-17', '10:00', 'Turf 1', 'Winner of M1', 'Winner of M2'],
      ['W1', 'Football', "Women's", '2026-10-17', '09:10', 'Turf 3', 'Echo W', 'Foxtrot W'],
    ];
    const r = run('intra', s);
    expect(codes(r, 'error')).toEqual([]);
    const clashes = find(r, 'person_clash');
    // Bela Das plays for Alpha and Echo, who meet in M1; Ira Roy is in Echo (M1, 09:00) and Echo W (W1, 09:10).
    expect(clashes).toHaveLength(2);
    expect(clashes[0]).toMatchObject({ severity: 'warning', row: 2 });
    expect(clashes[0].message).toContain('Bela Das');
    expect(clashes[1]).toMatchObject({ severity: 'warning', row: 5 });
    expect(clashes[1].message).toContain('Ira Roy');
  });

  it('a squad in two matches at once is an error', () => {
    const s = sample('intra');
    set(s, 'Schedule', 3, 'Side 1', get(s, 'Schedule', 2, 'Side 1'));
    expect(find(run('intra', s), 'squad_clash')).toMatchObject([{ severity: 'error', row: 3 }]);
  });

  it('a schedule for a League draw is refused', () => {
    const s = sample('intra');
    set(s, 'Draws', 2, 'Format', 'League');
    expect(find(run('intra', s), 'schedule_needs_knockout')).toMatchObject([{ severity: 'error' }]);
  });

  it('times: AM/PM read, an end before the kickoff and a missing length are errors', () => {
    const s = sample('intra');
    set(s, 'Schedule', 2, 'End', '08:30');
    set(s, 'Draws', 2, 'Match minutes', '');
    const r = run('intra', s);
    expect(find(r, 'bad_end')).toMatchObject([{ row: 2 }]);
    expect(find(r, 'no_match_length').map((i) => i.row)).toEqual([4, 5, 6]);
  });

  it('no schedule: fixtures are generated, with an info', () => {
    const r = run('intra', noSchedule());
    expect(bp(r).fixtures).toEqual([{ kind: 'generate', drawKey: 'd1' }]);
    expect(find(r, 'fixtures_generated')).toMatchObject([{ severity: 'info' }]);
  });

  it('the blueprint never carries a dangling Winner of', () => {
    const s = sample('intra');
    set(s, 'Schedule', 2, 'Ground', 'Turf 9'); // M1 is dropped, so M3 and then M5 go too
    const r = run('intra', s);
    const f = bp(r).fixtures[0];
    if (f.kind !== 'knockout-rows') throw new Error('expected rows');
    expect(f.rows.map((x) => x.matchId)).toEqual(['M2', 'M4']);
  });

  it('a duplicate match id is an error and is not written twice', () => {
    const s = sample('intra');
    set(s, 'Schedule', 3, 'Match ID', 'M1');
    const r = run('intra', s);
    expect(find(r, 'duplicate_match_id')).toMatchObject([{ row: 3 }]);
    const f = bp(r).fixtures[0];
    if (f.kind !== 'knockout-rows') throw new Error('expected rows');
    expect(f.rows.filter((x) => x.matchId === 'M1')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('step modes', () => {
  it('people skipped: no people, no members, no contact checks; warned', () => {
    const s = sample('intra');
    set(s, 'Squads', 2, 'Captain mobile', 'garbage');
    const r = run('intra', s, { people: 'skip' });
    expect(bp(r).people).toEqual([]);
    expect(bp(r).squads.every((x) => x.members.length === 0)).toBe(true);
    expect(codes(r)).toContain('squads_without_people');
    expect(codes(r)).not.toContain('bad_mobile');
    expect(r.summary.people).toBe(0);
  });

  it('fixtures skipped: no fixtures, Schedule not read', () => {
    const s = sample('intra');
    set(s, 'Schedule', 2, 'Ground', 'Turf 9');
    const r = run('intra', s, { fixtures: 'skip' });
    expect(bp(r).fixtures).toEqual([]);
    expect(codes(r, 'error')).toEqual([]);
    expect(find(r, 'sheet_ignored')[0]).toMatchObject({ sheet: 'Schedule' });
    expect(r.summary).toMatchObject({ matches: 0, byes: 0 });
  });

  it('staff skipped: no Staff sheet needed, no staff', () => {
    const s = sample('intra');
    delete s.Staff;
    const r = run('intra', s, { staff: 'skip' });
    expect(r.ok).toBe(true);
    expect(bp(r).staff).toEqual([]);
  });

  it('"already exists" steps are noted', () => {
    const r = run('intra', sample('intra'), { org: 'existing', competitors: 'existing' });
    expect(find(r, 'step_existing')).toHaveLength(2);
    expect(bp(r).steps.org).toBe('existing');
  });
});

// ---------------------------------------------------------------------------
describe('the blueprint', () => {
  for (const type of ['intra', 'campus', 'inter'] as const) {
    it(`${type}: every field set and every reference resolves`, () => {
      const b = bp(run(type, sample(type)));
      const unique = (xs: string[]) => expect(new Set(xs).size).toBe(xs.length);
      unique(b.competitors.map((c) => c.key));
      unique(b.people.map((p) => p.key));
      unique(b.staff.map((s) => s.key));
      unique(b.draws.map((d) => d.key));
      unique(b.squads.map((s) => s.key));
      unique(b.venue.grounds.map((g) => g.key));
      const comps = new Set(b.competitors.map((c) => c.key));
      const people = new Set(b.people.map((p) => p.key));
      const draws = new Set(b.draws.map((d) => d.key));
      const squads = new Set(b.squads.map((s) => s.key));
      const grounds = new Set(b.venue.grounds.map((g) => g.key));
      for (const s of b.squads) {
        expect(comps.has(s.competitorKey)).toBe(true);
        expect(draws.has(s.drawKey)).toBe(true);
        expect(s.shortName.length).toBeLessThanOrEqual(12);
        for (const m of s.members) expect(people.has(m.personKey)).toBe(true);
        unique(s.members.map((m) => m.personKey));
      }
      for (const st of b.staff) {
        if (st.groundKey) expect(grounds.has(st.groundKey)).toBe(true);
        if (st.competitorKey) expect(comps.has(st.competitorKey)).toBe(true);
        expect(st.existingEmail).toBeUndefined();
      }
      for (const f of b.fixtures) {
        expect(draws.has(f.drawKey)).toBe(true);
        if (f.kind !== 'knockout-rows') continue;
        const ids = new Set(f.rows.map((r) => r.matchId));
        for (const r of f.rows) {
          expect(grounds.has(r.groundKey)).toBe(true);
          for (const side of [r.home, r.away]) {
            if ('squadKey' in side) expect(squads.has(side.squadKey)).toBe(true);
            else expect(ids.has(side.winnerOf)).toBe(true);
          }
        }
      }
      expect(b.key).toBe(slugOf(b.championship.name));
      expect(b.eventType).toBe(type);
      expect(b.org).toMatchObject({ name: 'Acme Corp', shortName: 'ACME', city: 'Pune' });
      expect(b.org.unitLabels).toEqual(type === 'intra' ? { campus: 'Campus', department: 'Batch' } : { campus: 'Campus', department: 'Department' });
      expect(b.campus).toEqual(type === 'intra' ? { key: 'campus', name: 'Pune' } : null);
      expect(b.competitors.every((c) => c.kind === { intra: 'department', campus: 'campus', inter: 'organization' }[type])).toBe(true);
      expect(b.championship).toMatchObject({
        startDate: '2026-10-17', endDate: '2026-10-18', status: 'registration_open', type: 'single_sport',
        entryLevel: { intra: 'department', campus: 'campus', inter: 'organization' }[type],
        scopeToCampus: type === 'intra', visibility: type === 'inter' ? 'public' : 'private',
        placement: { winner: 10, runner_up: 7, semi_finalist: 4, participation: 1 },
      });
      expect(b.venue).toMatchObject({ name: 'Acme Sports Ground', city: 'Pune' });
      expect(b.placeholder).toEqual({ emailStem: 'acme' });
      expect(b.findings).toEqual([]);
      expect(b.squads.map((s) => s.key)).toEqual(['s2', 's3', 's4', 's5', 's6', 's7']);
      expect(b.staff[0].key).toBe('st2');
    });
  }

  it('the key adds the start year when the name lacks it; two draws make a multi-sport event', () => {
    const s = tiny();
    field(s, 'Event name', 'Tiny Cup');
    s.Draws.push(['Cricket', 'Mixed', 'League', '']);
    const b = bp(run('intra', s));
    expect(b.key).toBe('tiny-cup-2026');
    expect(b.championship.type).toBe('multi_sport');
  });

  it('is deterministic', () => {
    const a = run('inter', sample('inter'));
    const b = run('inter', sample('inter'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

function slugOf(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

describe('ambiguous text dates', () => {
  it('warns once per distinct text date that reads both ways, and says how to write the other reading', () => {
    const grids = setupSampleGrids('intra');
    const sheets = Object.fromEntries(grids.map((g) => [g.name, g.rows.map((r) => [...r])]));
    const ev = sheets.Event;
    const startRow = ev.findIndex((r) => r[0] === 'Start date');
    const endRow = ev.findIndex((r) => r[0] === 'End date');
    ev[startRow][1] = '10/11/2026';
    ev[endRow][1] = '25/11/2026'; // unambiguous: day 25 can only be a day
    const res = validateSetupWorkbook({ eventType: 'intra', steps: SETUP_DEFAULT_STEPS.intra, sheets });
    const amb = res.issues.filter((i) => i.code === 'ambiguous_date');
    expect(amb).toHaveLength(1);
    expect(amb[0]).toMatchObject({ severity: 'warning', sheet: 'Event' });
    expect(amb[0].message).toContain('10 November 2026');
    expect(amb[0].message).toContain('2026-10-11');
    expect(res.blueprint?.championship.startDate).toBe('2026-11-10');
  });
});
