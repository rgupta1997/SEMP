/*
 * THE STANDARD EVENT SETUP TEMPLATE — the workbook a client fills in, described once.
 *
 * The dashboard builds the downloadable .xlsx from SETUP_TEMPLATE_SHEETS; the
 * validator (validate.ts) reads an uploaded one back through the same description,
 * so the two can never disagree about a column. Headers are matched loosely (case,
 * spaces and punctuation ignored, plus each column's `aliases`), so a client who
 * renames "Captain mobile" to "Captain Mobile No." is still read.
 */
import type { SetupEventType, SetupStepKey, SetupStepMode, SetupSteps } from './blueprint.js';

// ---------------------------------------------------------------------------
// event types and steps
// ---------------------------------------------------------------------------
export const SETUP_EVENT_TYPE_INFO: Record<SetupEventType, {
  label: string; entryLevel: 'organization' | 'campus' | 'department'; competitor: string; blurb: string;
}> = {
  intra: {
    label: 'Intra · units of one organisation', entryLevel: 'department', competitor: 'Batch / department',
    blurb: 'The batches, departments or processes of one organisation compete. Example: WNS Football 2026.',
  },
  inter: {
    label: 'Inter · organisations', entryLevel: 'organization', competitor: 'Organisation',
    blurb: 'Separate organisations compete; each sends its own squads and a POC.',
  },
  campus: {
    label: 'Campus tournament', entryLevel: 'campus', competitor: 'Campus',
    blurb: 'The campuses or offices of one organisation compete.',
  },
};

export interface SetupStepInfo {
  key: SetupStepKey;
  label: string | Record<SetupEventType, string>;
  /** How "Already exists" and reuse find it on the platform. */
  foundBy: string;
  /** Which workbook sheet feeds it, if any. */
  sheet?: SetupSheetName;
}

export const SETUP_STEPS: SetupStepInfo[] = [
  { key: 'org', label: 'Host organisation', foundBy: 'name, any case', sheet: 'Event' },
  { key: 'campus', label: 'Campus', foundBy: 'name under the organisation', sheet: 'Event' },
  {
    key: 'competitors',
    label: { intra: 'Batches / departments', inter: 'Competing organisations', campus: 'Campuses' },
    foundBy: 'name (under the campus for batches, platform-wide for organisations)', sheet: 'Squads',
  },
  { key: 'people', label: 'People', foundBy: 'member id in the organisation, then real mobile + first name, then email', sheet: 'Squads' },
  { key: 'staff', label: 'Staff and roles', foundBy: 'email, then mobile', sheet: 'Staff' },
  { key: 'championship', label: 'Championship', foundBy: 'name under the host organisation', sheet: 'Event' },
  { key: 'venue', label: 'Venue and grounds', foundBy: 'name under the championship', sheet: 'Event' },
  { key: 'draws', label: 'Sports and draws', foundBy: 'sport + discipline in the championship', sheet: 'Draws' },
  { key: 'squads', label: 'Squads and entries', foundBy: 'competitor + sport + name', sheet: 'Squads' },
  { key: 'fixtures', label: 'Fixtures', foundBy: 'any fixture already on the draw', sheet: 'Schedule' },
];

export const stepLabel = (step: SetupStepInfo, type: SetupEventType) =>
  (typeof step.label === 'string' ? step.label : step.label[type]);

const all = (mode: SetupStepMode): SetupSteps =>
  Object.fromEntries(SETUP_STEPS.map((s) => [s.key, mode])) as SetupSteps;

/** What each event type usually ticks. The dashboard starts from these. */
export const SETUP_DEFAULT_STEPS: Record<SetupEventType, SetupSteps> = {
  intra: all('sheet'),
  inter: { ...all('sheet'), campus: 'skip' },
  campus: { ...all('sheet'), campus: 'skip' },
};

// ---------------------------------------------------------------------------
// the workbook
// ---------------------------------------------------------------------------
export const SETUP_SHEET_NAMES = ['Event', 'Draws', 'Squads', 'People', 'Staff', 'Schedule'] as const;
export type SetupSheetName = (typeof SETUP_SHEET_NAMES)[number];

export interface SetupTemplateColumn {
  /** Stable key the validator uses. */
  key: string;
  /** The header written into the template. */
  header: string;
  /** Required for these event types (true = all). */
  required: boolean | SetupEventType[];
  /** Only shown for these event types (default all). */
  only?: SetupEventType[];
  /** One line for the Instructions sheet and the column's note. */
  hint: string;
  /** Other headers that mean the same column. */
  aliases?: string[];
  /** The example row's value, per event type when it differs. */
  example?: string | Partial<Record<SetupEventType, string>>;
  /** A fixed list of allowed values (matched case-insensitively). */
  allowed?: string[];
}

export interface SetupTemplateSheet {
  name: SetupSheetName;
  /** 'fields' = two columns, Field | Value, one setting per row. 'table' = a header row then records. */
  kind: 'fields' | 'table';
  optional: boolean;
  purpose: string;
  columns: SetupTemplateColumn[];
}

const PLAYER_COLUMNS: SetupTemplateColumn[] = [
  ...Array.from({ length: 12 }, (_, i): SetupTemplateColumn => ({
    key: `player_${i + 1}`, header: `Player ${i + 1}`, required: false,
    hint: 'Full name. Include the captain and vice-captain here too if they play.',
    example: i < 6 ? ['Aarav Shah', 'Neha Kulkarni', 'Rohan Mehta', 'Simran Kaur', 'Kabir Rao', 'Isha Nair'][i] : '',
  })),
  ...Array.from({ length: 4 }, (_, i): SetupTemplateColumn => ({
    key: `substitute_${i + 1}`, header: `Substitute ${i + 1}`, required: false,
    aliases: [`Substitute Player ${i + 1}`, `Sub ${i + 1}`],
    hint: 'Full name of a substitute.', example: i === 0 ? 'Dev Joshi' : '',
  })),
];

export const SETUP_TEMPLATE_SHEETS: SetupTemplateSheet[] = [
  {
    name: 'Event', kind: 'fields', optional: false,
    purpose: 'One row per setting: the event, the host organisation, dates, venue and points.',
    columns: [
      { key: 'event_name', header: 'Event name', required: true, hint: 'As players should see it.', example: 'Acme Football Cup 2026' },
      { key: 'host_org', header: 'Host organisation', required: true, hint: 'The organisation running the event. Found by name if it is already on Sportagon.', example: 'Acme Corp' },
      { key: 'host_short', header: 'Host short name', required: false, hint: 'Up to 12 characters; also its code.', example: 'ACME' },
      { key: 'city', header: 'City', required: false, hint: '', example: 'Pune' },
      { key: 'campus', header: 'Campus', required: ['intra'], only: ['intra'], hint: 'The campus whose batches / departments compete.', example: 'Pune' },
      { key: 'unit_label', header: 'What a competing unit is called', required: false, only: ['intra'], hint: 'Batch, Department, Process… Shown across the product.', example: 'Batch', aliases: ['Unit label'] },
      { key: 'start_date', header: 'Start date', required: true, hint: 'YYYY-MM-DD', example: '2026-10-17' },
      { key: 'end_date', header: 'End date', required: true, hint: 'YYYY-MM-DD', example: '2026-10-18' },
      { key: 'day_dates', header: 'Day dates', required: false, hint: 'Only if the schedule says "Day 1", "Day 2": Day 1=2026-10-17; Day 2=2026-10-18', example: 'Day 1=2026-10-17; Day 2=2026-10-18' },
      { key: 'venue', header: 'Venue', required: true, hint: 'Where it is played.', example: 'Acme Sports Ground' },
      { key: 'grounds', header: 'Grounds', required: true, hint: 'Pitches / courts, comma separated. Schedule rows name one of these.', example: 'Turf 1, Turf 2, Turf 3, Turf 4' },
      { key: 'ground_type', header: 'Ground type', required: false, hint: 'One of field, court, pool, track, ring, table.', example: 'field', allowed: ['field', 'court', 'pool', 'track', 'ring', 'table'] },
      { key: 'visibility', header: 'Visibility', required: false, hint: 'public or private.', example: 'public', allowed: ['public', 'private'] },
      { key: 'points_winner', header: 'Points: winner', required: false, hint: 'Placement points for the standings.', example: '10' },
      { key: 'points_runner_up', header: 'Points: runner-up', required: false, hint: '', example: '7' },
      { key: 'points_semi', header: 'Points: semi-finalist', required: false, hint: '', example: '4' },
      { key: 'points_participation', header: 'Points: taking part', required: false, hint: '', example: '1' },
    ],
  },
  {
    name: 'Draws', kind: 'table', optional: false,
    purpose: 'One row per sport and discipline that is played. Squads and schedule rows name one of these.',
    columns: [
      { key: 'sport', header: 'Sport', required: true, hint: 'As in the Sportagon catalogue (Football, Cricket, Badminton…).', example: 'Football' },
      { key: 'discipline', header: 'Discipline', required: true, hint: "Men's, Women's, Mixed… Created for this event if the catalogue lacks it.", example: 'Mixed' },
      { key: 'format', header: 'Format', required: true, hint: 'Knockout, League or Groups+Knockout.', example: 'Knockout', allowed: ['Knockout', 'League', 'Groups+Knockout'] },
      { key: 'squad_min', header: 'Squad min', required: false, hint: 'Fewest people a squad may have.', example: '6' },
      { key: 'squad_max', header: 'Squad max', required: false, hint: 'Most people a squad may have.', example: '10' },
      { key: 'match_minutes', header: 'Match minutes', required: false, hint: 'Whole match, all periods together (2 × 10 = 20).', example: '20' },
      { key: 'extra_time_minutes', header: 'Extra time minutes', required: false, hint: 'Knockout ties; blank = none.', example: '5' },
      { key: 'penalty_kicks', header: 'Penalty kicks', required: false, hint: 'Shoot-out kicks each; blank = none.', example: '5' },
      { key: 'third_place', header: 'Third-place match', required: false, hint: 'Yes or No.', example: 'No', allowed: ['yes', 'no'] },
      { key: 'scoring_preset', header: 'Scoring preset', required: false, hint: 'Advanced: a catalogue preset key. Blank = the sport default.', example: 'fest_2x10_ko' },
    ],
  },
  {
    name: 'Squads', kind: 'table', optional: false,
    purpose: 'One row per squad: who it plays for, the captain, vice-captain and players.',
    columns: [
      { key: 'squad_name', header: 'Squad name', required: true, hint: 'Shown on scoreboards and brackets. Unique per draw.', aliases: ['Team name', 'Team'], example: 'Acme Strikers' },
      { key: 'short_code', header: 'Short code', required: false, hint: 'Scoreboard code, up to 12 characters. Made up if blank.', example: 'ASTR' },
      { key: 'sport', header: 'Sport', required: true, hint: 'Must match a row on Draws.', example: 'Football' },
      { key: 'discipline', header: 'Discipline', required: true, hint: 'Must match a row on Draws.', example: 'Mixed' },
      {
        key: 'competitor', header: 'Plays for', required: true,
        aliases: ['Batch', 'Department', 'Process', 'Process name', 'Campus', 'Organisation', 'Organization', 'Institution', 'Unit'],
        hint: 'Intra: the batch / department. Campus: the campus. Inter: the organisation.',
        example: { intra: 'Finance', campus: 'Mumbai Office', inter: 'Beta Industries' },
      },
      { key: 'section', header: 'Section', required: false, aliases: ['Bracket', 'Pool', 'Group'], hint: 'Bracket / pool the squad is drawn into, if the client assigned one.', example: '1' },
      { key: 'captain_name', header: 'Captain name', required: true, aliases: ["Captain's name", 'Captain'], hint: '', example: 'Aarav Shah' },
      { key: 'captain_id', header: 'Captain ID', required: false, aliases: ["Captain's UID", 'Captain UID', 'Captain employee id'], hint: 'Employee / student id.', example: 'E10234' },
      { key: 'captain_mobile', header: 'Captain mobile', required: false, aliases: ['Captain phone', 'Captain mobile number'], hint: '10-digit Indian mobile. Without it the captain gets a placeholder.', example: '9876543210' },
      { key: 'captain_email', header: 'Captain email', required: false, hint: '', example: 'aarav.shah@acme.com' },
      { key: 'vc_name', header: 'Vice-captain name', required: false, aliases: ['Vice captain', 'Vice captain name', 'VC'], hint: '', example: 'Neha Kulkarni' },
      { key: 'vc_id', header: 'Vice-captain ID', required: false, aliases: ["Vice Captain's UID", 'Vice captain UID'], hint: '', example: 'E10288' },
      { key: 'vc_mobile', header: 'Vice-captain mobile', required: false, aliases: ['Vice captain mobile'], hint: '', example: '9876500000' },
      { key: 'vc_email', header: 'Vice-captain email', required: false, hint: '', example: '' },
      ...PLAYER_COLUMNS,
    ],
  },
  {
    name: 'People', kind: 'table', optional: true,
    purpose: 'Optional: contacts for players. Linked to squads by ID, else by exact name.',
    columns: [
      { key: 'name', header: 'Name', required: true, hint: 'Exactly as on Squads.', example: 'Rohan Mehta' },
      { key: 'id', header: 'ID', required: false, aliases: ['Employee ID', 'UID', 'Member code'], hint: 'Employee / student id.', example: 'E10301' },
      { key: 'mobile', header: 'Mobile', required: false, aliases: ['Phone', 'Mobile number'], hint: '10-digit Indian mobile.', example: '9876511111' },
      { key: 'email', header: 'Email', required: false, hint: '', example: 'rohan.mehta@acme.com' },
      { key: 'gender', header: 'Gender', required: false, hint: 'Male, Female or Other.', example: 'Male', allowed: ['male', 'female', 'other', 'm', 'f'] },
    ],
  },
  {
    name: 'Staff', kind: 'table', optional: false,
    purpose: 'Who runs the event: organisers, officials (one per ground scores every match on it), POCs.',
    columns: [
      { key: 'name', header: 'Name', required: true, hint: '', example: 'Priya Desai' },
      { key: 'role', header: 'Role', required: true, hint: 'Organiser, Official, POC, Org owner or Org admin.', example: 'Organiser', allowed: ['organiser', 'organizer', 'official', 'referee', 'poc', 'org owner', 'org admin'] },
      { key: 'mobile', header: 'Mobile', required: false, hint: 'Without mobile or email they get a placeholder.', example: '9876522222' },
      { key: 'email', header: 'Email', required: false, hint: 'An existing Sportagon login is found by its email.', example: 'priya.desai@acme.com' },
      { key: 'ground', header: 'Ground', required: false, hint: 'Officials: the ground they score.', example: 'Turf 1' },
      { key: 'competitor', header: 'For organisation', required: false, only: ['inter'], hint: 'Inter POCs: the organisation they speak for.', example: 'Beta Industries' },
    ],
  },
  {
    name: 'Schedule', kind: 'table', optional: true,
    purpose: 'Optional: the match list. Without it the draw is generated from the squads. Later rounds say "Winner of <Match ID>".',
    columns: [
      { key: 'match_id', header: 'Match ID', required: true, hint: 'Your own id, kept on the fixture.', example: 'B1-R1-1' },
      { key: 'sport', header: 'Sport', required: false, hint: 'Needed only when there is more than one draw.', example: 'Football' },
      { key: 'discipline', header: 'Discipline', required: false, hint: '', example: 'Mixed' },
      { key: 'date', header: 'Date', required: true, aliases: ['Day'], hint: 'YYYY-MM-DD, or "Day 1" with Day dates set on Event.', example: '2026-10-17' },
      { key: 'kickoff', header: 'Kickoff', required: true, aliases: ['Kickoff (IST)', 'Start', 'Time'], hint: '24h 14:20 or 2:20 PM, local time.', example: '09:00' },
      { key: 'end', header: 'End', required: false, aliases: ['Match End', 'Finish'], hint: 'Blank = the draw\'s match minutes.', example: '09:25' },
      { key: 'ground', header: 'Ground', required: true, aliases: ['Turf', 'Court', 'Pitch'], hint: 'One of the Grounds on Event.', example: 'Turf 1' },
      { key: 'side_1', header: 'Side 1', required: true, aliases: ['Team 1', 'Home'], hint: 'A squad name, or "Winner of <Match ID>".', example: 'Acme Strikers' },
      { key: 'side_2', header: 'Side 2', required: true, aliases: ['Team 2', 'Away'], hint: '', example: 'Finance Falcons' },
      { key: 'section', header: 'Section', required: false, aliases: ['Bracket'], hint: 'For reading only.', example: '1' },
      { key: 'round', header: 'Round', required: false, hint: 'For reading only; rounds are named from the bracket.', example: 'R1' },
    ],
  },
];

export const setupColumnsFor = (sheet: SetupTemplateSheet, type: SetupEventType) =>
  sheet.columns.filter((c) => !c.only || c.only.includes(type));

export const setupColumnRequired = (c: SetupTemplateColumn, type: SetupEventType) =>
  c.required === true || (Array.isArray(c.required) && c.required.includes(type));

export const setupExample = (c: SetupTemplateColumn, type: SetupEventType) =>
  (typeof c.example === 'string' ? c.example : c.example?.[type] ?? '');

/** Header normaliser shared by the template writer and the reader. */
export const setupHeaderKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------
// validation — the contract between the validator, the API and the dashboard
// ---------------------------------------------------------------------------
/**
 * The workbook as the browser read it: every sheet as a grid of strings (SheetJS
 * `sheet_to_json(ws, { header: 1, raw: false, defval: '' })`), keyed by the sheet's
 * own name. Sheet names are matched case-insensitively to SETUP_SHEET_NAMES.
 */
export interface SetupWorkbookInput {
  eventType: SetupEventType;
  steps: SetupSteps;
  sheets: Record<string, string[][]>;
}

export type SetupIssueSeverity = 'error' | 'warning' | 'info';

export interface SetupIssue {
  severity: SetupIssueSeverity;
  /** Stable machine code, e.g. 'missing_column', 'bad_mobile', 'squad_not_in_schedule'. */
  code: string;
  message: string;
  sheet?: SetupSheetName;
  /** 1-based row number as Excel shows it. */
  row?: number;
  /** The template header of the column. */
  column?: string;
}

export interface SetupValidationSummary {
  draws: number;
  competitors: number;
  squads: number;
  people: number;
  peopleWithMobile: number;
  peopleOnPlaceholder: number;
  peopleInSeveralSquads: number;
  staff: number;
  grounds: number;
  matches: number;
  byes: number;
}

/** What the pure validator returns. `blueprint` is null when there are errors that leave nothing to build. */
export interface SetupValidationResult {
  ok: boolean;
  issues: SetupIssue[];
  summary: SetupValidationSummary;
  blueprint: import('./blueprint.js').EventSetupBlueprint | null;
}

/** What the API adds after looking at the platform (one row per step). */
export interface SetupPlatformStep {
  step: SetupStepKey;
  mode: SetupStepMode;
  /** Rows that already exist and will be reused. */
  found: number;
  /** Rows that will be created. */
  create: number;
  /** Rows marked "Already exists" that are not on the platform (each is also an error issue). */
  missing: number;
  notes: string[];
}
