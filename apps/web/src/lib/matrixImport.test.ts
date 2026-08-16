import { describe, it, expect } from 'vitest';
import { parseChampionshipMatrix } from './matrixImport';

// The sample sheet has to survive its own importer. A template that produces
// warnings, or that parses into something other than what it visibly says, is
// worse than no template - it teaches the wrong shape and the first real upload
// fails for a reason nobody can trace back here.
//
// This is the SAME grid `downloadMatrixTemplate()` writes, flattened the way
// SheetJS flattens merged cells on the way back in: the merged value lands in the
// top-left cell and the rest come through empty, which is exactly what the
// parser's forward-fill exists to undo.
const SAMPLE: string[][] = [
  ['', '', 'IIM Bangalore', '', 'IIM Ahmedabad', ''],
  ['', '', 'Name', 'Phone Number', 'Name', 'Phone Number'],
  ['Overall', 'Overall POC', 'Asha Rao', '9876543210', 'Ravi Kumar', '9876500011'],
  ['Basketball (Men)', 'Captain', 'Neha Mishra', '9876500022', 'Arjun Nair', '9876500033'],
  ['', 'POC', 'Kiran Shah', '9876500044', 'Meera Iyer', '9876500055'],
  ['Basketball (Women)', 'Captain', 'Priya Menon', '9876500066', 'Sana Khan', '9876500077'],
  ['', 'POC', 'Kiran Shah', '9876500044', 'Meera Iyer', '9876500055'],
  ['Badminton', 'Captain', 'Rahul Verma', '9876500088', 'Dev Patel', '9876500099'],
  ['', 'POC', 'Kiran Shah', '9876500044', 'Meera Iyer', '9876500055'],
];

describe('the downloadable sample sheet', () => {
  const parsed = parseChampionshipMatrix(SAMPLE);

  it('parses with no warnings at all', () => {
    expect(parsed.warnings).toEqual([]);
  });

  it('reads both institutions as sections', () => {
    expect(parsed.sections).toEqual(['IIM Bangalore', 'IIM Ahmedabad']);
  });

  it('reads the Overall block as one section POC each', () => {
    expect(parsed.owners).toEqual([
      { section: 'IIM Bangalore', name: 'Asha Rao', phone: '9876543210' },
      { section: 'IIM Ahmedabad', name: 'Ravi Kumar', phone: '9876500011' },
    ]);
  });

  it('splits "Sport (Discipline)" into three distinct draws', () => {
    expect(parsed.units.map((u) => [u.sport, u.discipline])).toEqual([
      ['Basketball', 'Men'],
      ['Basketball', 'Women'],
      ['Badminton', null],
    ]);
  });

  // The merged sport cell spans Captain and POC. If the forward-fill were wrong,
  // the POC row would land under an empty category and be dropped.
  it('carries a merged sport down onto its POC row', () => {
    const menB = parsed.units.find((u) => u.sport === 'Basketball' && u.discipline === 'Men')!;
    const iimb = menB.teams.find((t) => t.section === 'IIM Bangalore')!;
    expect(iimb.captain).toEqual({ name: 'Neha Mishra', phone: '9876500022' });
    expect(iimb.poc).toEqual({ name: 'Kiran Shah', phone: '9876500044' });
  });

  it('gives every draw a team for both institutions', () => {
    for (const u of parsed.units) {
      expect(u.teams.map((t) => t.section).sort()).toEqual(['IIM Ahmedabad', 'IIM Bangalore']);
      for (const t of u.teams) expect(t.captain?.phone).toBeTruthy();
    }
  });
});

describe('parseChampionshipMatrix guards', () => {
  it('says so plainly when the header row is missing', () => {
    const out = parseChampionshipMatrix([['Basketball', 'Captain', 'Someone', '9876543210']]);
    expect(out.units).toEqual([]);
    expect(out.warnings[0]).toMatch(/name.*phone/i);
  });

  // A person with no phone cannot be matched to an account, so they are reported
  // rather than imported as an unreachable stub.
  it('reports a person with no phone instead of importing them', () => {
    const out = parseChampionshipMatrix([
      ['', '', 'IIM Bangalore', ''],
      ['', '', 'Name', 'Phone Number'],
      ['Badminton', 'Captain', 'No Phone Person', ''],
    ]);
    expect(out.warnings.join(' ')).toMatch(/No Phone Person.*no phone/i);
    expect(out.units[0]?.teams).toEqual([]);
  });

  it('flags a row whose role it does not recognise rather than guessing', () => {
    const out = parseChampionshipMatrix([
      ['', '', 'IIM Bangalore', ''],
      ['', '', 'Name', 'Phone Number'],
      ['Badminton', 'Manager', 'Someone', '9876543210'],
    ]);
    expect(out.warnings.join(' ')).toMatch(/unrecognized role "Manager"/i);
  });
});
