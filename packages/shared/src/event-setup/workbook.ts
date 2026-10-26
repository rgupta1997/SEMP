import { KNOCKOUT_ROUND } from '../enums.js';
/*
 * THE WORKBOOK AS GRIDS - the blank template a super admin downloads and a filled
 * sample, both written from SETUP_TEMPLATE_SHEETS so they can never disagree with
 * the validator about a column. Each grid is ready for SheetJS `aoa_to_sheet`.
 */
import type { SetupEventType, SetupSteps } from './blueprint.js';
import { setupStepAdvice, setupWorkbookLayout } from './layout.js';
import {
  SETUP_DEFAULT_STEPS, SETUP_EVENT_TYPE_INFO, SETUP_STEPS, stepLabel, setupExample,
  type SetupSheetName, type SetupTemplateColumn,
} from './template.js';

/** One sheet of a workbook as a grid of strings, ready for SheetJS `aoa_to_sheet`. */
export interface SetupGrid {
  name: string;
  rows: string[][];
}

/** The name of the sheet that explains the others. Not read back by the validator. */
export const SETUP_INSTRUCTIONS_SHEET = 'Instructions';

/**
 * The blank template for an event type and a setup's step switches: an
 * "Instructions" sheet first (what each sheet and column is for, which are required,
 * an example value, and what this setup's switches mean), then every data sheet the
 * setup reads, with its header row only - the Event sheet with its Field column
 * filled in and Value empty. No example rows on data sheets, so nothing left behind by
 * mistake is read as data. Sheets and columns follow setupWorkbookLayout, the same
 * rule the validator reads by: Fixtures on Skip means no Schedule sheet, People on
 * Skip means no player columns.
 */
export function setupTemplateGrids(type: SetupEventType, steps: SetupSteps = SETUP_DEFAULT_STEPS[type]): SetupGrid[] {
  const layout = setupWorkbookLayout(type, steps).filter((l) => l.included);
  return [
    instructionsGrid(type, steps),
    ...layout.map(({ sheet, columns }): SetupGrid => (sheet.kind === 'fields'
      ? { name: sheet.name, rows: [['Field', 'Value'], ...columns.map((c) => [c.header, ''])] }
      : { name: sheet.name, rows: [columns.map((c) => c.header)] })),
  ];
}

function instructionsGrid(type: SetupEventType, steps: SetupSteps): SetupGrid {
  const info = SETUP_EVENT_TYPE_INFO[type];
  const competitor = info.competitor.toLowerCase();
  const rows: string[][] = [
    [`Sportagon event setup template: ${info.label}`],
    [info.blurb],
    [],
    ['How to fill this in'],
    ['1. Event: one setting per row. Write each value in the Value column, next to its Field.'],
    ['2. Draws: one row per sport and discipline that is played (Football / Mixed).'],
    [`3. Squads: one row per squad: who it plays for (its ${competitor}), its captain, vice-captain and players. A ${competitor} enters at most one squad per draw.`],
    [`4. Staff: who runs the event. At least one Organiser or Org owner. An Official scores every match on the ground written next to them.${type === 'inter' ? ' Each organisation\'s POC goes here too, with "For organisation".' : ''}`],
    ['5. People (optional): contacts for players. A row is linked to Squads by ID, else by the exact name.'],
    ['6. Schedule (optional): your own match list for a knockout. Later rounds say "Winner of <Match ID>"; a squad with a bye simply appears in round two. Leave it empty and the draw is generated from the squads.'],
    [],
    ['Good to know'],
    ['Leave a cell blank when you do not know. NULL, NA, N/A, TBD, nil, none and - also count as blank.'],
    ['Dates as YYYY-MM-DD. Times as 14:20 or 2:20 PM. Mobiles as 10 digits.'],
    ['Keep the sheet names. Columns can be in any order; columns that are not in this template are ignored.'],
    ['The same name is read as the same person on every squad. If two different people share a name, give them IDs.'],
    ['Someone with no mobile and no email is given a placeholder login, to be replaced on registration day.'],
  ];
  const layout = setupWorkbookLayout(type, steps);
  const custom = SETUP_STEPS.some((st) => steps[st.key] !== SETUP_DEFAULT_STEPS[type][st.key]);
  rows.push([], [custom ? 'This setup: what each step does' : 'What each step does'], ['Step', 'Setting', 'What it means for this workbook']);
  for (const st of SETUP_STEPS) {
    const mode = steps[st.key];
    rows.push([stepLabel(st, type), mode === 'sheet' ? 'From sheet' : mode === 'existing' ? 'Already exists' : 'Skip', setupStepAdvice(st.key, mode)]);
  }
  const leftOut = layout.filter((l) => !l.included);
  if (leftOut.length) {
    rows.push([], ['Not in this workbook']);
    for (const l of leftOut) rows.push([`${l.sheet.name} sheet`, '', `Left out: ${l.leftOutBecause}`]);
  }
  for (const { sheet, columns: cols, required, included } of layout) {
    if (!included) continue;
    rows.push([], [`${sheet.name} sheet (${sheet.optional ? 'optional' : 'required'})`], [sheet.purpose]);
    rows.push([sheet.kind === 'fields' ? 'Field' : 'Column', 'Required', 'What to enter', 'Allowed values', 'Example']);
    for (const group of runsOf(cols)) {
      const c = group[0];
      const label = group.length > 1 ? `${c.header} … ${group[group.length - 1].header}` : c.header;
      rows.push([
        label,
        required.has(c.key) ? 'Yes' : 'No',
        c.hint,
        (c.allowed ?? []).join(', '),
        setupExample(c, type),
      ]);
    }
    if (sheet.name === 'Squads' && steps.people !== 'skip') {
      rows.push(['More players', 'No', 'Add Player 13, Substitute 5 … columns if a squad has more people.', '', 'Player 13']);
      rows.push(["A player's own contacts", 'No', 'Add "Player 3 mobile", "Player 3 email" or "Player 3 ID" columns next to the player.', '', 'Player 3 mobile']);
    }
  }
  return { name: SETUP_INSTRUCTIONS_SHEET, rows };
}

/** Player 1..12 and Substitute 1..4 read as one line each; every other column is its own. */
function runsOf(cols: SetupTemplateColumn[]): SetupTemplateColumn[][] {
  const runs: SetupTemplateColumn[][] = [];
  const family = (c: SetupTemplateColumn) => c.key.match(/^(player|substitute)_\d+$/)?.[1] ?? null;
  for (const c of cols) {
    const last = runs[runs.length - 1];
    if (last && family(c) && family(last[0]) === family(c)) last.push(c);
    else runs.push([c]);
  }
  return runs;
}

// ===========================================================================
// the sample
// ===========================================================================
interface SampleSquad {
  name: string;
  code: string;
  competitor: string;
  players: string[];
  substitute: string;
}

const PLAYERS: string[][] = [
  ['Aarav Shah', 'Neha Kulkarni', 'Rohan Mehta', 'Simran Kaur', 'Kabir Rao', 'Isha Nair', 'Dev Joshi'],
  ['Priya Iyer', 'Arjun Menon', 'Kavya Reddy', 'Sneha Patil', 'Aditya Verma', 'Meera Pillai', 'Rahul Desai'],
  ['Ananya Gupta', 'Karan Malhotra', 'Pooja Bhat', 'Siddharth Jain', 'Nisha Thomas', 'Varun Chopra', 'Tanvi Shetty'],
  ['Ishaan Kapoor', 'Riya Sen', 'Manish Yadav', 'Divya Krishnan', 'Amit Saxena', 'Shreya Ghosh', 'Nikhil Bansal'],
  ['Harsh Agarwal', 'Tara Fernandes', 'Yash Thakur', 'Lavanya Murthy', 'Gaurav Sinha', 'Pallavi Dutta', 'Omkar Pawar'],
  ['Zoya Khan', 'Rishi Arora', 'Anjali Mishra', 'Kunal Bose', 'Naina Chawla', 'Sameer Naik', 'Farhan Qureshi'],
];

const COMPETING: Record<SetupEventType, Array<[squad: string, code: string, competitor: string]>> = {
  intra: [
    ['Finance Falcons', 'FIN', 'Finance'], ['HR Hawks', 'HRH', 'HR'], ['Ops Owls', 'OPS', 'Operations'],
    ['Tech Titans', 'TEC', 'Technology'], ['Sales Sharks', '', 'Sales'], ['Legal Lions', '', 'Legal'],
  ],
  campus: [
    ['Mumbai Mavericks', 'MUM', 'Mumbai Office'], ['Pune Panthers', 'PUN', 'Pune Office'],
    ['Bengaluru Blasters', 'BLR', 'Bengaluru Office'], ['Delhi Dynamos', 'DEL', 'Delhi Office'],
    ['Chennai Chargers', '', 'Chennai Office'], ['Hyderabad Hunters', '', 'Hyderabad Office'],
  ],
  inter: [
    ['Beta Strikers', 'BETA', 'Beta Industries'], ['Gamma Rangers', 'GAM', 'Gamma Labs'],
    ['Delta Rovers', 'DEL', 'Delta Motors'], ['Epsilon United', 'EPS', 'Epsilon Foods'],
    ['Zeta Warriors', '', 'Zeta Bank'], ['Eta Royals', '', 'Eta Pharma'],
  ],
};

const POCS = ['Ritu Sharma', 'Vivek Rathore', 'Sunita Pillai', 'Mohan Das', 'Leela Bhatt', 'Arvind Rawat'];

const emailOf = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
const mobile = (n: number) => `98${String(76000000 + n).padStart(8, '0')}`;

/**
 * A small, complete, valid workbook for an event type and a setup's step switches -
 * validates with no errors under those same switches. Sheets and columns the switches
 * leave out are left out here too.
 */
export function setupSampleGrids(type: SetupEventType, steps: SetupSteps = SETUP_DEFAULT_STEPS[type]): SetupGrid[] {
  const squads: SampleSquad[] = COMPETING[type].map(([name, code, competitor], i) => ({
    name, code, competitor, players: PLAYERS[i].slice(0, 6), substitute: PLAYERS[i][6],
  }));
  const host = 'Acme Corp';
  const eventName = { intra: 'Acme Football Cup 2026', campus: 'Acme Inter-Office Cup 2026', inter: 'Acme Invitational Football 2026' }[type];

  const event: Record<string, string> = {
    event_name: eventName, host_org: host, host_short: 'ACME', city: 'Pune', campus: 'Pune', unit_label: 'Batch',
    start_date: '2026-10-17', end_date: '2026-10-18', day_dates: 'Day 1=2026-10-17; Day 2=2026-10-18',
    venue: 'Acme Sports Ground', grounds: 'Turf 1, Turf 2', ground_type: 'field',
    visibility: type === 'inter' ? 'public' : 'private',
    points_winner: '10', points_runner_up: '7', points_semi: '4', points_participation: '1',
  };

  const draws: Record<string, string> = {
    sport: 'Football', discipline: 'Mixed', format: 'Knockout', squad_min: '6', squad_max: '10',
    match_minutes: '20', extra_time_minutes: '5', penalty_kicks: '5', third_place: 'No', scoring_preset: '',
  };

  const squadRows = squads.map((s, i): Record<string, string> => {
    const row: Record<string, string> = {
      squad_name: s.name, short_code: s.code, sport: 'Football', discipline: 'Mixed', competitor: s.competitor,
      section: '',
      captain_name: s.players[0], captain_id: `E${10101 + i * 10}`, captain_mobile: mobile(i * 10 + 1),
      captain_email: i % 2 === 0 ? emailOf(s.players[0]) : '',
      vc_name: s.players[1], vc_id: `E${10102 + i * 10}`, vc_mobile: i < 4 ? mobile(i * 10 + 2) : '', vc_email: '',
      substitute_1: s.substitute,
    };
    s.players.forEach((p, j) => { row[`player_${j + 1}`] = p; });
    return row;
  });

  // A few contacts for players who are not captains, linked by exact name.
  const people = [
    { name: squads[0].players[2], id: '', mobile: mobile(901), email: emailOf(squads[0].players[2]), gender: 'Male' },
    { name: squads[1].players[2], id: '', mobile: mobile(902), email: '', gender: 'Female' },
    { name: squads[2].players[3], id: 'E10399', mobile: '', email: emailOf(squads[2].players[3]), gender: 'Male' },
  ];

  const staff: Array<Record<string, string>> = [
    { name: 'Priya Desai', role: 'Org owner', mobile: mobile(951), email: 'priya.desai@example.com', ground: '', competitor: '' },
    { name: 'Rohit Bhatia', role: 'Organiser', mobile: mobile(952), email: 'rohit.bhatia@example.com', ground: '', competitor: '' },
    { name: 'Suresh Kumar', role: 'Official', mobile: mobile(953), email: '', ground: 'Turf 1', competitor: '' },
    { name: 'Deepa Menon', role: 'Official', mobile: mobile(954), email: '', ground: 'Turf 2', competitor: '' },
  ];
  if (type === 'inter') {
    squads.forEach((s, i) => staff.push({
      name: POCS[i], role: 'POC', mobile: mobile(961 + i), email: emailOf(POCS[i]), ground: '', competitor: s.competitor,
    }));
  }

  // Six squads, a bracket of eight: two first-round matches, two byes into the semis.
  const [a, b, c, d, e, f] = squads.map((s) => s.name);
  const schedule: Array<Record<string, string>> = [
    { match_id: 'M1', date: '2026-10-17', kickoff: '09:00', end: '09:25', ground: 'Turf 1', side_1: a, side_2: b, round: 'Round 1' },
    { match_id: 'M2', date: '2026-10-17', kickoff: '09:00', end: '09:25', ground: 'Turf 2', side_1: c, side_2: d, round: 'Round 1' },
    { match_id: 'M3', date: 'Day 1', kickoff: '10:00 AM', end: '', ground: 'Turf 1', side_1: 'Winner of M1', side_2: e, round: 'Semi-final' },
    { match_id: 'M4', date: 'Day 1', kickoff: '10:00 AM', end: '', ground: 'Turf 2', side_1: f, side_2: 'Winner of M2', round: 'Semi-final' },
    { match_id: 'M5', date: 'Day 2', kickoff: '4:00 PM', end: '', ground: 'Turf 1', side_1: 'Winner of M3', side_2: 'Winner of M4', round: KNOCKOUT_ROUND.final },
  ].map((r) => ({ ...r, sport: 'Football', discipline: 'Mixed', section: '' }));

  const grids = setupTemplateGrids(type, steps);
  const layout = setupWorkbookLayout(type, steps);
  const fill = (name: SetupSheetName, records: Array<Record<string, string>>) => {
    const { sheet, columns: cols, included } = layout.find((l) => l.sheet.name === name)!;
    const grid = grids.find((g) => g.name === name);
    if (!included || !grid) return;
    if (sheet.kind === 'fields') {
      grid.rows = [['Field', 'Value'], ...cols.map((col) => [col.header, records[0][col.key] ?? ''])];
    } else {
      grid.rows = [cols.map((col) => col.header), ...records.map((r) => cols.map((col) => r[col.key] ?? ''))];
    }
  };
  fill('Event', [event]);
  fill('Draws', [draws]);
  fill('Squads', squadRows);
  fill('People', people);
  fill('Staff', staff);
  fill('Schedule', schedule);
  return grids;
}
