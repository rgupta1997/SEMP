/*
 * THE EVENT SETUP BLUEPRINT — one plain object that says what an event needs, step
 * by step, and for each step whether a run builds it, finds it, or leaves it alone.
 *
 * It is the contract between three things that never import each other:
 *   - a sheet reader (the standard template's validator in validate.ts, or a
 *     per-client adapter) that turns rows into a blueprint and says what it found;
 *   - the engine (apps/api/src/modules/event-setup) that turns a blueprint into rows;
 *   - the super-admin Event Setup dashboard that shows both.
 *
 * Every step carries a MODE:
 *   sheet     build it from the blueprint — reuse what already exists (matched by
 *             name, member code, phone), create only what is missing
 *   existing  it is already on the platform — look it up, fail if it is not there
 *   skip      this run does not touch it (a later run, or a person, does)
 */

export const SETUP_EVENT_TYPES = ['intra', 'inter', 'campus'] as const;
export type SetupEventType = (typeof SETUP_EVENT_TYPES)[number];

export const SETUP_STEP_KEYS = [
  'org', 'campus', 'competitors', 'people', 'staff',
  'championship', 'venue', 'draws', 'squads', 'fixtures',
] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export const SETUP_STEP_MODES = ['sheet', 'existing', 'skip'] as const;
export type SetupStepMode = (typeof SETUP_STEP_MODES)[number];
export type SetupSteps = Record<SetupStepKey, SetupStepMode>;

/** The host organisation: the one that runs the event (and, intra, the one whose units compete). */
export interface SetupOrgSpec {
  name: string;
  shortName: string;
  city?: string;
  country?: string;
  /** The nouns the product uses for the two unit levels in this organisation. */
  unitLabels: { campus: string; department: string };
  /** Granted (not billed) if the organisation has no active plan. */
  plan?: 'free' | 'pro' | 'max';
}

/**
 * WHO COMPETES. One shape for all three event types:
 *   intra   kind 'department' — a batch / process / department under `campus`
 *   campus  kind 'campus'     — a campus of the host organisation
 *   inter   kind 'organization' — a separate organisation
 * A competitor fields at most ONE squad per draw (the database enforces it).
 */
export interface SetupCompetitorSpec {
  key: string;
  name: string;
  kind: 'department' | 'campus' | 'organization';
  code?: string;
}

export interface SetupPersonSpec {
  key: string;
  name: string;
  /** Employee / student id; becomes the organisation member code. */
  memberCode?: string;
  /** A real 10-digit mobile. Absent means a placeholder is minted. */
  phone?: string;
  /** A real email. Absent means a placeholder is minted. */
  email?: string;
  gender?: 'male' | 'female' | 'other';
}

export type SetupStaffRole = 'organiser' | 'official' | 'poc';

export interface SetupStaffSpec {
  key: string;
  name: string;
  /** An account that already exists on the platform, found by this email. */
  existingEmail?: string;
  phone?: string;
  email?: string;
  orgRole?: 'owner' | 'admin' | 'member';
  eventRole?: SetupStaffRole;
  /** Official assigned to every fixture on this ground. */
  groundKey?: string;
  /** Inter events: the competing organisation this POC speaks for (made its owner). */
  competitorKey?: string;
  note?: string;
}

export interface SetupChampionshipSpec {
  name: string;
  description?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  /** organization = inter; campus / department = the host's own units compete. */
  entryLevel: 'organization' | 'campus' | 'department';
  /** Confine a department event to the campus in `campus`. */
  scopeToCampus: boolean;
  visibility: 'public' | 'private';
  status: 'draft' | 'registration_open' | 'ongoing' | 'completed';
  type: 'single_sport' | 'multi_sport' | 'inter_college' | 'inter_programme' | 'open';
  /** Placement points for the standings table. */
  placement: { winner: number; runner_up: number; semi_finalist: number; participation: number };
}

export interface SetupVenueSpec {
  name: string;
  city?: string;
  grounds: Array<{ key: string; name: string; type: 'court' | 'field' | 'pool' | 'track' | 'ring' | 'table' }>;
}

export const SETUP_DRAW_FORMATS = ['Knockout', 'League', 'Groups+Knockout'] as const;
export type SetupDrawFormat = (typeof SETUP_DRAW_FORMATS)[number];

export interface SetupDrawSpec {
  key: string;
  sport: string;
  /** Catalogue discipline name; created for this championship only if the catalogue lacks it. */
  discipline: string;
  format: SetupDrawFormat;
  squadMin: number;
  squadMax: number;
  thirdPlace: boolean;
  /**
   * An org-saved scoring format built from a catalogue preset. Absent = the sport's
   * default. `matchMinutes` is the WHOLE match (two halves of 10 = 20): the console
   * divides it by the number of periods.
   */
  scoring?: {
    presetKey: string;
    name: string;
    matchMinutes?: number;
    extraTimeMinutes?: number;
    penaltyKicks?: number;
  };
}

export interface SetupSquadSpec {
  key: string;
  drawKey: string;
  name: string;
  /** Scoreboard code, 12 characters at most. */
  shortName: string;
  competitorKey: string;
  /** The sheet's bracket / section / pool label, for reporting. */
  section?: string;
  members: Array<{ personKey: string; role: 'captain' | 'vice_captain' | 'player' | 'substitute' }>;
}

/** One side of a scheduled match: a squad, or the winner of an earlier match. */
export type SetupMatchSide = { squadKey: string } | { winnerOf: string };

export interface SetupMatchRowSpec {
  /** The client's own match id ("B1-R55-1"), kept on the fixture as "Match <id>". */
  matchId: string;
  date: string;      // YYYY-MM-DD, local
  kickoff: string;   // HH:MM, 24h local
  minutes: number;   // kickoff to final whistle
  groundKey: string;
  home: SetupMatchSide;
  away: SetupMatchSide;
}

/**
 * FIXTURES. Either the client's own match list, read back into a bracket
 * ('knockout-rows' — first-round pairings, later rounds as "Winner of <match>", a
 * squad appearing one round up is a bye), or the product's generator over the
 * draw's squads in sheet order ('generate').
 */
export type SetupFixtureSpec =
  | { kind: 'knockout-rows'; drawKey: string; utcOffset: string; rows: SetupMatchRowSpec[] }
  | { kind: 'generate'; drawKey: string };

export interface SetupFinding {
  severity: 'blocker' | 'fix' | 'review' | 'info';
  topic: string;
  detail: string;
  rows?: string[];
}

export interface EventSetupBlueprint {
  /** Names the manifest; stable across re-runs of one event. */
  key: string;
  eventType: SetupEventType;
  steps: SetupSteps;
  org: SetupOrgSpec;
  /** Intra: the campus whose departments compete. Campus/inter: unused (null). */
  campus: { key: string; name: string; code?: string } | null;
  competitors: SetupCompetitorSpec[];
  people: SetupPersonSpec[];
  staff: SetupStaffSpec[];
  championship: SetupChampionshipSpec;
  venue: SetupVenueSpec;
  draws: SetupDrawSpec[];
  squads: SetupSquadSpec[];
  fixtures: SetupFixtureSpec[];
  placeholder: {
    /** Stem of placeholder logins: <name>-<stem>-<n>@placeholder.invalid */
    emailStem: string;
  };
  /** What the sheet reader found that a person should look at. */
  findings: SetupFinding[];
}
