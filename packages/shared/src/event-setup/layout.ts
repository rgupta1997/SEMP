/*
 * WHAT A WORKBOOK HOLDS FOR ONE SETUP — which sheets, which columns, which of them
 * must be filled — given the event type AND the setup's step switches.
 *
 * One function, read by three things that must agree: the template download, the
 * sample download, and the validator. Turn Fixtures to Skip and the template loses
 * its Schedule sheet, the sample loses its matches, and the validator stops asking
 * for one — never one without the others.
 */
import type { SetupEventType, SetupStepKey, SetupStepMode, SetupSteps } from './blueprint.js';
import {
  SETUP_TEMPLATE_SHEETS, setupColumnRequired, setupColumnsFor,
  type SetupSheetName, type SetupTemplateColumn, type SetupTemplateSheet,
} from './template.js';

export interface SetupSheetLayout {
  sheet: SetupTemplateSheet;
  /** In the template and read on upload. A sheet that is not is ignored if present. */
  included: boolean;
  /** Why a sheet is left out, in a sentence for the Instructions sheet. */
  leftOutBecause?: string;
  /** The columns (or Event fields) this setup uses, in template order. */
  columns: SetupTemplateColumn[];
  /** Columns this setup needs filled. */
  required: Set<string>;
}

/** Squads columns that only describe people: not needed when People is skipped. */
const PERSON_COLUMN = /^(captain_|vc_|player_\d+$|substitute_\d+$)/;
/** Event fields that only describe the venue. */
const VENUE_FIELDS = new Set(['venue', 'grounds', 'ground_type']);

/** Venue and Fixtures both skipped: no grounds exist for this setup, so none are asked for. */
export const setupGroundsUnused = (steps: SetupSteps) => steps.venue === 'skip' && steps.fixtures === 'skip';

/** Whether the Squads sheet is read at all — the validator's rule, stated once. */
export const setupSquadsNeeded = (steps: SetupSteps) =>
  !(steps.squads === 'skip' && steps.competitors === 'skip' && steps.people === 'skip');

export function setupWorkbookLayout(type: SetupEventType, steps: SetupSteps): SetupSheetLayout[] {
  const venueUnused = setupGroundsUnused(steps);
  return SETUP_TEMPLATE_SHEETS.map((sheet): SetupSheetLayout => {
    let included = true;
    let leftOutBecause: string | undefined;
    const skip = (step: string) => `${step} is set to Skip.`;
    if (sheet.name === 'Squads' && !setupSquadsNeeded(steps)) { included = false; leftOutBecause = 'Squads, competitors and people are all set to Skip.'; }
    if (sheet.name === 'People' && steps.people === 'skip') { included = false; leftOutBecause = skip('People'); }
    if (sheet.name === 'Staff' && steps.staff === 'skip') { included = false; leftOutBecause = skip('Staff and roles'); }
    if (sheet.name === 'Schedule' && steps.fixtures === 'skip') { included = false; leftOutBecause = skip('Fixtures'); }

    const columns = setupColumnsFor(sheet, type).filter((c) => {
      if (sheet.name === 'Squads' && steps.people === 'skip' && PERSON_COLUMN.test(c.key)) return false;
      if (sheet.name === 'Event' && venueUnused && VENUE_FIELDS.has(c.key)) return false;
      // No venue means no grounds, so an official has no ground to be put on.
      if (sheet.name === 'Staff' && venueUnused && c.key === 'ground') return false;
      return true;
    });
    const required = new Set(columns.filter((c) => setupColumnRequired(c, type)).map((c) => c.key));
    return { sheet, included, leftOutBecause, columns, required };
  });
}

export function setupSheetLayout(type: SetupEventType, steps: SetupSteps, name: SetupSheetName): SetupSheetLayout {
  return setupWorkbookLayout(type, steps).find((l) => l.sheet.name === name)!;
}

/** What each switch means for the person filling the workbook in, one line each. */
export function setupStepAdvice(step: SetupStepKey, mode: SetupStepMode): string {
  if (mode === 'skip') {
    const skipped: Partial<Record<SetupStepKey, string>> = {
      people: 'No players are set up from this workbook, so the Squads sheet has no player columns and there is no People sheet.',
      staff: 'No staff are set up from this workbook, so there is no Staff sheet.',
      fixtures: 'No matches are set up from this workbook, so there is no Schedule sheet.',
      venue: 'The venue is not set up from this workbook.',
    };
    return skipped[step] ?? 'Not set up from this workbook.';
  }
  if (mode === 'existing') {
    const found: Partial<Record<SetupStepKey, string>> = {
      org: 'It is already on Sportagon: write its name exactly as it is there, and it is found, not created.',
      campus: 'It is already on Sportagon: write its name exactly as it is there.',
      competitors: 'They are already on Sportagon: write each name exactly as it is there.',
      people: 'They are already on Sportagon: they are matched by ID, mobile or email, and nobody new is created.',
      staff: 'They are already on Sportagon: give each one\'s email or mobile so they can be found.',
      championship: 'It is already on Sportagon: write the event name exactly as it is there.',
      venue: 'It is already on Sportagon: write the venue and ground names exactly as they are there.',
      draws: 'They are already on Sportagon: write each sport and discipline exactly as in the event.',
      squads: 'They are already on Sportagon: write each squad name exactly as it is there.',
      fixtures: 'The matches already exist: the Schedule sheet is only checked against them.',
    };
    return found[step] ?? 'It is already on Sportagon and is found, not created.';
  }
  return 'Built from this workbook. Anything already on Sportagon is found and reused.';
}
