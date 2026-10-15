import { describe, expect, it } from 'vitest';
import { SETUP_EVENT_TYPES, SETUP_STEP_KEYS, SETUP_STEP_MODES, type SetupSteps } from './blueprint.js';
import { setupWorkbookLayout } from './layout.js';
import { SETUP_DEFAULT_STEPS, setupHeaderKey } from './template.js';
import { validateSetupWorkbook } from './validate.js';
import { setupSampleGrids, setupTemplateGrids } from './workbook.js';

const sheetsOf = (grids: ReturnType<typeof setupSampleGrids>) =>
  Object.fromEntries(grids.map((g) => [g.name, g.rows]));

const errorsFor = (type: (typeof SETUP_EVENT_TYPES)[number], steps: SetupSteps) =>
  validateSetupWorkbook({ eventType: type, steps, sheets: sheetsOf(setupSampleGrids(type, steps)) })
    .issues.filter((i) => i.severity === 'error').map((i) => `${i.code}: ${i.message}`);

describe('the downloads follow the step switches', () => {
  for (const type of SETUP_EVENT_TYPES) {
    for (const step of SETUP_STEP_KEYS) {
      for (const mode of SETUP_STEP_MODES) {
        it(`${type}: ${step} = ${mode} — the sample for these switches validates with no errors`, () => {
          const steps = { ...SETUP_DEFAULT_STEPS[type], [step]: mode };
          expect(errorsFor(type, steps)).toEqual([]);
        });
      }
    }
  }

  it.each([
    ['people and squads skipped', { people: 'skip', squads: 'skip' }],
    ['only fixtures are built', { org: 'existing', campus: 'existing', competitors: 'existing', people: 'skip', staff: 'skip', championship: 'existing', venue: 'existing', draws: 'existing', squads: 'existing' }],
    ['no venue, no fixtures', { venue: 'skip', fixtures: 'skip' }],
    ['everything already exists', Object.fromEntries(SETUP_STEP_KEYS.map((k) => [k, 'existing']))],
  ] as const)('intra with %s validates with no errors', (_label, over) => {
    expect(errorsFor('intra', { ...SETUP_DEFAULT_STEPS.intra, ...over } as SetupSteps)).toEqual([]);
  });

  it('leaves out the Schedule sheet when Fixtures is skipped, and says why', () => {
    const steps = { ...SETUP_DEFAULT_STEPS.intra, fixtures: 'skip' as const };
    const grids = setupTemplateGrids('intra', steps);
    expect(grids.map((g) => g.name)).not.toContain('Schedule');
    const text = grids[0].rows.map((r) => r.join(' ')).join('\n');
    expect(text).toMatch(/Schedule sheet\s+Left out: Fixtures is set to Skip/);
  });

  it('drops the player columns when People is skipped, and stops requiring the captain', () => {
    const steps = { ...SETUP_DEFAULT_STEPS.intra, people: 'skip' as const };
    const squads = setupTemplateGrids('intra', steps).find((g) => g.name === 'Squads')!.rows[0];
    expect(squads).toContain('Squad name');
    expect(squads).not.toContain('Captain name');
    expect(squads.some((h) => /^Player \d+$/.test(h))).toBe(false);
    expect(setupTemplateGrids('intra', steps).map((g) => g.name)).not.toContain('People');
  });

  it('writes, for every setting, exactly the headers the validator reads — no more, no fewer', () => {
    for (const type of SETUP_EVENT_TYPES) {
      for (const step of SETUP_STEP_KEYS) {
        for (const mode of SETUP_STEP_MODES) {
          const steps = { ...SETUP_DEFAULT_STEPS[type], [step]: mode };
          const layout = setupWorkbookLayout(type, steps);
          const grids = setupTemplateGrids(type, steps);
          for (const l of layout) {
            const grid = grids.find((g) => g.name === l.sheet.name);
            expect(!!grid, `${type} ${step}=${mode} ${l.sheet.name}`).toBe(l.included);
            if (!grid) continue;
            const written = l.sheet.kind === 'fields' ? grid.rows.slice(1).map((r) => r[0]) : grid.rows[0];
            expect(written.map(setupHeaderKey)).toEqual(l.columns.map((c) => setupHeaderKey(c.header)));
            for (const key of l.required) expect(l.columns.some((c) => c.key === key)).toBe(true);
          }
        }
      }
    }
  });

  it('keeps the defaults unchanged when no switches are given', () => {
    for (const type of SETUP_EVENT_TYPES) {
      expect(setupTemplateGrids(type)).toEqual(setupTemplateGrids(type, SETUP_DEFAULT_STEPS[type]));
      expect(setupSampleGrids(type)).toEqual(setupSampleGrids(type, SETUP_DEFAULT_STEPS[type]));
    }
  });
});
