import { describe, expect, it } from 'vitest';
import type { SetupEventType } from './blueprint.js';
import { readFields, readTable } from './read.js';
import {
  SETUP_DEFAULT_STEPS, SETUP_SHEET_NAMES, SETUP_TEMPLATE_SHEETS, setupColumnRequired, setupColumnsFor,
  type SetupIssue,
} from './template.js';
import { validateSetupWorkbook } from './validate.js';
import { SETUP_INSTRUCTIONS_SHEET, setupSampleGrids, setupTemplateGrids } from './workbook.js';

const TYPES: SetupEventType[] = ['intra', 'campus', 'inter'];
const sheetsOf = (grids: Array<{ name: string; rows: string[][] }>) => Object.fromEntries(grids.map((g) => [g.name, g.rows]));

describe('setupTemplateGrids', () => {
  for (const type of TYPES) {
    it(`${type}: Instructions first, then every sheet in order`, () => {
      const grids = setupTemplateGrids(type);
      expect(grids.map((g) => g.name)).toEqual([SETUP_INSTRUCTIONS_SHEET, ...SETUP_SHEET_NAMES]);
    });

    it(`${type}: each sheet's headers are exactly the template's columns for the type`, () => {
      const grids = setupTemplateGrids(type);
      for (const sheet of SETUP_TEMPLATE_SHEETS) {
        const grid = grids.find((g) => g.name === sheet.name)!;
        const headers = setupColumnsFor(sheet, type).map((c) => c.header);
        if (sheet.kind === 'fields') {
          expect(grid.rows[0]).toEqual(['Field', 'Value']);
          expect(grid.rows.slice(1).map((r) => r[0])).toEqual(headers);
          expect(grid.rows.slice(1).every((r) => r[1] === '')).toBe(true);
        } else {
          expect(grid.rows).toEqual([headers]);
        }
      }
    });

    it(`${type}: every header and alias reads back as its own column`, () => {
      for (const sheet of SETUP_TEMPLATE_SHEETS) {
        const cols = setupColumnsFor(sheet, type);
        const issues: SetupIssue[] = [];
        if (sheet.kind === 'fields') {
          const grid = cols.map((c, i) => [c.header, `v${i}`]);
          const read = readFields(grid, sheet, type, (x) => issues.push(x));
          cols.forEach((c, i) => expect(read.get(c.key)?.value, `${sheet.name}/${c.header}`).toBe(`v${i}`));
        } else {
          const grid = [cols.map((c) => c.header), cols.map((_, i) => `v${i}`)];
          const read = readTable(grid, sheet, type, (x) => issues.push(x));
          cols.forEach((c, i) => expect(read.rows[0].get(c.key), `${sheet.name}/${c.header}`).toBe(`v${i}`));
          for (const c of cols) {
            for (const alias of c.aliases ?? []) {
              const one = readTable([[alias], ['x']], sheet, type, () => {});
              expect(one.rows[0].get(c.key), `${sheet.name}: alias "${alias}"`).toBe('x');
            }
          }
        }
        expect(issues.filter((i) => i.severity !== 'info'), sheet.name).toEqual([]);
      }
    });

    it(`${type}: the Instructions say which columns are required for the type`, () => {
      const rows = setupTemplateGrids(type)[0].rows;
      expect(rows[0][0]).toContain('Sportagon event setup template');
      for (const sheet of SETUP_TEMPLATE_SHEETS) {
        const at = rows.findIndex((r) => r[0]?.startsWith(`${sheet.name} sheet (`));
        expect(at, sheet.name).toBeGreaterThan(0);
        expect(rows[at][0]).toContain(sheet.optional ? 'optional' : 'required');
        expect(rows[at + 2]).toEqual([sheet.kind === 'fields' ? 'Field' : 'Column', 'Required', 'What to enter', 'Allowed values', 'Example']);
        for (const c of setupColumnsFor(sheet, type)) {
          if (/^(player|substitute)_\d+$/.test(c.key)) continue;
          const row = rows.slice(at + 3).find((r) => r[0] === c.header);
          expect(row, `${sheet.name}/${c.header}`).toBeDefined();
          expect(row![1]).toBe(setupColumnRequired(c, type) ? 'Yes' : 'No');
        }
      }
      expect(rows.some((r) => r[0] === 'Player 1 … Player 12')).toBe(true);
      // Within the Event sheet's section: the step table above it has a "Campus" row too.
      const eventAt = rows.findIndex((r) => r[0]?.startsWith('Event sheet ('));
      const campus = rows.slice(eventAt).find((r) => r[0] === 'Campus');
      if (type === 'intra') expect(campus?.[1]).toBe('Yes');
      else expect(campus).toBeUndefined();
      expect(rows.some((r) => r[0] === 'For organisation')).toBe(type === 'inter');
    });

    it(`${type}: a blank template is refused, never thrown on`, () => {
      const r = validateSetupWorkbook({ eventType: type, steps: SETUP_DEFAULT_STEPS[type], sheets: sheetsOf(setupTemplateGrids(type)) });
      expect(r.ok).toBe(false);
      expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['missing_field', 'no_draws', 'no_squads', 'no_organiser']));
      expect(r.issues.some((i) => i.code === 'missing_column')).toBe(false);
    });
  }
});

describe('setupSampleGrids', () => {
  for (const type of TYPES) {
    it(`${type}: validates with no errors and no warnings`, () => {
      const r = validateSetupWorkbook({ eventType: type, steps: SETUP_DEFAULT_STEPS[type], sheets: sheetsOf(setupSampleGrids(type)) });
      expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.blueprint).not.toBeNull();
    });

    it(`${type}: uses the template's headers, one Football draw, six squads, a schedule with two byes`, () => {
      const grids = setupSampleGrids(type);
      const template = setupTemplateGrids(type);
      for (const g of grids) {
        const t = template.find((x) => x.name === g.name)!;
        if (g.name === SETUP_INSTRUCTIONS_SHEET) expect(g.rows).toEqual(t.rows);
        else if (g.name === 'Event') expect(g.rows.map((r) => r[0])).toEqual(t.rows.map((r) => r[0]));
        else expect(g.rows[0]).toEqual(t.rows[0]);
      }
      const r = validateSetupWorkbook({ eventType: type, steps: SETUP_DEFAULT_STEPS[type], sheets: sheetsOf(grids) });
      expect(r.summary).toMatchObject({ draws: 1, squads: 6, competitors: 6, matches: 5, byes: 2, grounds: 2 });
      expect(r.blueprint!.staff.filter((s) => s.eventRole === 'official').map((s) => s.groundKey)).toEqual(['g1', 'g2']);
      expect(r.blueprint!.staff.filter((s) => s.eventRole === 'poc')).toHaveLength(type === 'inter' ? 6 : 0);
    });
  }
});
