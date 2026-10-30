/*
 * THE STANDARD TEMPLATE'S VALIDATOR - a filled-in workbook in, issues and a
 * blueprint out.
 *
 * Pure and deterministic: no database, no clock, no randomness. It never throws on
 * bad data; every problem becomes a SetupIssue that says what is wrong, where (sheet,
 * Excel row, template column) and how to fix it. The API adds what only the
 * platform can answer (does this organisation / person / campus already exist).
 *
 * The rules are the ones the WNS sheet taught (docs/event-setup-template.md):
 * the same name is the same person, a unit fields one squad per draw, a number on
 * several people is nobody's, a schedule sheet is a bracket.
 */
import { matchPresetByKey } from '../match-format.js';
import {
  SETUP_EVENT_TYPES, SETUP_STEP_KEYS, SETUP_STEP_MODES,
  type EventSetupBlueprint, type SetupCompetitorSpec, type SetupDrawFormat, type SetupDrawSpec,
  type SetupEventType, type SetupFixtureSpec, type SetupMatchRowSpec, type SetupMatchSide,
  type SetupPersonSpec, type SetupSquadSpec, type SetupStaffSpec, type SetupSteps, type SetupVenueSpec,
} from './blueprint.js';
import { KnockoutSheetError, knockoutFromRows } from './knockout.js';
import { setupGroundsUnused, setupSheetLayout, setupSquadsNeeded } from './layout.js';
import {
  type IssueSink, type TableRead,
  clock, dateIsAmbiguous, findSheet, maskPhone, parseAmount, parseDate, parseEmail, parseMobile, parseTime,
  parseWhole, parseYesNo, readFields, readTable, templateSheet,
} from './read.js';
import { displayName, idKey, looseKey, nameKey, namesLookAlike, orgShortName, shortCode, slug, tidy } from './names.js';
import {
  SETUP_DEFAULT_STEPS, SETUP_EVENT_TYPE_INFO, SETUP_STEPS, setupColumnsFor, stepLabel,
  type SetupIssue, type SetupIssueSeverity, type SetupSheetName, type SetupValidationResult,
  type SetupValidationSummary, type SetupWorkbookInput,
} from './template.js';

/** Schedules are local Indian time. */
const UTC_OFFSET = '+05:30';
/** Football draws with no preset get the fest format the WNS event used. */
const FOOTBALL_KNOCKOUT_PRESET = 'fest_2x10_ko';
const FOOTBALL_LEAGUE_PRESET = 'fest_2x10';

type Role = SetupSquadSpec['members'][number]['role'];
const RANK: Record<Role, number> = { captain: 0, vice_captain: 1, player: 2, substitute: 3 };
const ROLE_WORD: Record<Role, string> = { captain: 'captain', vice_captain: 'vice-captain', player: 'player', substitute: 'substitute' };
type GroundType = SetupVenueSpec['grounds'][number]['type'];
type Where = { sheet?: SetupSheetName; row?: number; column?: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 8) =>
  (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "10/11/2026" was read day-first; say so, and how to write the other reading. */
function ambiguousDateText(raw: string, iso: string): string {
  const swapped = `${iso.slice(0, 4)}-${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
  return `"${raw}" was read as ${longDate(iso)} (day first). If you meant ${longDate(swapped)}, write ${swapped}; YYYY-MM-DD can only be read one way.`;
}
const rowsText = (rows: number[]) => (rows.length === 1 ? `row ${rows[0]}` : `rows ${list(rows.map(String), 10)}`);

export function emptySetupSummary(): SetupValidationSummary {
  return {
    draws: 0, competitors: 0, squads: 0, people: 0, peopleWithMobile: 0, peopleOnPlaceholder: 0,
    peopleInSeveralSquads: 0, staff: 0, grounds: 0, matches: 0, byes: 0,
  };
}

/**
 * Read a filled-in standard template and say how well it was filled in.
 * Pure: no database. The API adds what only the platform can answer
 * (does this organisation / person / campus already exist).
 */
export function validateSetupWorkbook(input: SetupWorkbookInput): SetupValidationResult {
  const issues: SetupIssue[] = [];
  try {
    return run(input, issues);
  } catch (err) {
    issues.push({
      severity: 'error', code: 'validator_failed',
      message: `The workbook could not be fully checked (${err instanceof Error ? err.message : String(err)}). Nothing will be set up from it. Send the workbook to the Sportagon team to look at.`,
    });
    return { ok: false, issues, summary: emptySetupSummary(), blueprint: null };
  }
}

// ===========================================================================
interface Ground { key: string; name: string; norm: string }

interface EventInfo {
  name: string; hostOrg: string; hostShort: string; hostShortGiven: string;
  city?: string; campus?: string; unitLabel: string;
  start: string; end: string; days: Map<number, string>;
  venue: string; grounds: Ground[]; groundType: GroundType; visibility: 'public' | 'private';
  placement: { winner: number; runner_up: number; semi_finalist: number; participation: number };
}

interface DrawRec {
  spec: SetupDrawSpec;
  row: number;
  label: string;
  sportNorm: string;
  discNorm: string;
  minutes?: number;
  minGiven: boolean;
  maxGiven: boolean;
}

interface SquadRec {
  key: string;
  row: number;
  draw: DrawRec | null;
  name: string;
  nameNorm: string;
  codeGiven: string;
  shortName: string;
  competitor: string;
  compNorm: string;
  /** Intra: the squad's own unit when its competitor fields several squads in a draw. */
  splitUnit?: string;
  section?: string;
  mentions: number[];
  members: SetupSquadSpec['members'];
  competitorKey: string;
}

interface Mention {
  squad: number;
  role: Role;
  name: string;
  key: string;
  id?: string;
  idk?: string;
  phoneRaw?: string;
  emailRaw?: string;
  row: number;
  column: string;
  phoneColumn?: string;
  emailColumn?: string;
}

interface Contact<T> { value: T; where: string; sheet: SetupSheetName; row: number; column: string }

interface PersonRec {
  key: string;
  name: string;
  nameKeys: Set<string>;
  ids: string[];
  idks: string[];
  mentions: number[];
  squads: Set<number>;
  comps: Set<string>;
  phones: Contact<string>[];
  emails: Contact<string>[];
  gender?: SetupPersonSpec['gender'];
  phone?: string;
  email?: string;
}

interface SchedRow {
  row: number;
  draw: DrawRec;
  matchId: string;
  idNorm: string;
  date?: string;
  start?: number;
  minutes?: number;
  ground?: Ground;
  sides: Array<SetupMatchSide | null>;
  sideRaw: string[];
  /** Match id and both sides read; the row can go into a bracket. */
  shapeOk: boolean;
  /** A repeat of an earlier row's match id: never written to the blueprint. */
  dupId?: boolean;
}

// ===========================================================================
function run(input: SetupWorkbookInput, issues: SetupIssue[]): SetupValidationResult {
  const sink: IssueSink = (i) => issues.push(i);
  const say = (severity: SetupIssueSeverity, code: string, message: string, where: Where = {}) => {
    const issue: SetupIssue = { severity, code, message };
    if (where.sheet) issue.sheet = where.sheet;
    if (where.row) issue.row = where.row;
    if (where.column) issue.column = where.column;
    issues.push(issue);
  };
  const error = (code: string, message: string, where?: Where) => say('error', code, message, where);
  const warn = (code: string, message: string, where?: Where) => say('warning', code, message, where);
  const info = (code: string, message: string, where?: Where) => say('info', code, message, where);
  const ambiguousSeen = new Set<string>();

  const type = input?.eventType as SetupEventType;
  if (!SETUP_EVENT_TYPES.includes(type)) {
    error('bad_event_type', `"${String(input?.eventType)}" is not an event type. Pick intra, inter or campus.`);
    return { ok: false, issues, summary: emptySetupSummary(), blueprint: null };
  }
  const steps = resolveSteps(type, input.steps);
  const sheets = (input.sheets && typeof input.sheets === 'object' ? input.sheets : {}) as Record<string, unknown>;
  const typeInfo = SETUP_EVENT_TYPE_INFO[type];
  const competitorWord = type === 'intra' ? 'batch / department' : type === 'campus' ? 'campus' : 'organisation';
  const peopleSkipped = steps.people === 'skip';
  let unusable = false;

  // ---- which sheets ------------------------------------------------------
  const squadsNeeded = setupSquadsNeeded(steps);
  const groundsUnused = setupGroundsUnused(steps);
  const staffNeeded = steps.staff !== 'skip';
  const located = {
    Event: findSheet(sheets, 'Event'), Draws: findSheet(sheets, 'Draws'), Squads: findSheet(sheets, 'Squads'),
    People: findSheet(sheets, 'People'), Staff: findSheet(sheets, 'Staff'), Schedule: findSheet(sheets, 'Schedule'),
  };
  const needed: Array<[SetupSheetName, boolean]> = [['Event', true], ['Draws', true], ['Squads', squadsNeeded], ['Staff', staffNeeded]];
  for (const [name, need] of needed) {
    if (!need) continue;
    const at = located[name];
    if (!at) {
      error('missing_sheet', `The workbook has no "${name}" sheet. ${templateSheet(name).purpose} Add a sheet named "${name}" (the template has its columns).`, { sheet: name });
      if (name !== 'Staff') unusable = true;
    } else if (at.grid.every((r) => r.every((c) => String(c ?? '').trim() === ''))) {
      error('empty_sheet', `The "${name}" sheet is empty. ${templateSheet(name).purpose}`, { sheet: name });
      if (name !== 'Staff') unusable = true;
    }
  }

  // ======================================================================
  // EVENT
  // ======================================================================
  const ev = readEvent(located.Event?.grid ?? null, type, sink, error, warn, setupSheetLayout(type, steps, 'Event').required);

  // ======================================================================
  // DRAWS
  // ======================================================================
  const draws: DrawRec[] = [];
  if (located.Draws) {
    const t = readTable(located.Draws.grid, templateSheet('Draws'), type, sink);
    if (t.missing.length) unusable = true;
    readDraws(t, draws, { error, warn, info });
    if (!t.missing.length && t.rows.length === 0 && located.Draws.grid.some((r) => r.some((c) => String(c ?? '').trim()))) {
      error('no_draws', 'The Draws sheet has headers but no rows. Add one row per sport and discipline that is played.', { sheet: 'Draws' });
    }
  }
  const drawFor = (sport: string, disc: string): DrawRec | undefined => {
    const s = looseKey(sport); const d = looseKey(disc);
    const exact = draws.find((x) => x.sportNorm === s && x.discNorm === d);
    if (exact) return exact;
    if (s && !d) { const c = draws.filter((x) => x.sportNorm === s); if (c.length === 1) return c[0]; }
    return undefined;
  };
  const drawsText = () => (draws.length ? draws.map((d) => d.label).join('; ') : 'none');

  // ======================================================================
  // SQUADS
  // ======================================================================
  const squads: SquadRec[] = [];
  const mentions: Mention[] = [];
  let squadsTable: TableRead | null = null;
  if (located.Squads && squadsNeeded) {
    squadsTable = readTable(located.Squads.grid, templateSheet('Squads'), type, sink, squadExtraColumn, false, setupSheetLayout(type, steps, 'Squads').required);
    if (squadsTable.missing.length) unusable = true;
  } else if (located.Squads) {
    info('sheet_ignored', 'Squads, batches and people are all set to Skip, so the Squads sheet was not read.', { sheet: 'Squads' });
  }
  if (squadsTable && !squadsTable.missing.length) {
    const t = squadsTable;
    const slots = [...t.headers.keys()]
      .map((k) => k.match(/^(player|substitute)_(\d+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ key: m[0], role: (m[1] === 'player' ? 'player' : 'substitute') as Role, n: Number(m[2]) }))
      .sort((a, b) => (a.role === b.role ? a.n - b.n : a.role === 'player' ? -1 : 1));
    const onlyDrawRows: number[] = [];

    for (const r of t.rows) {
      const sport = r.get('sport'); const disc = r.get('discipline');
      let draw: DrawRec | null = null;
      if (sport || disc) {
        draw = drawFor(sport, disc) ?? null;
        if (!draw && draws.length) {
          error('unknown_draw', `Squads row ${r.row} is for "${[sport, disc].filter(Boolean).join(' / ')}", which is not a row on Draws (Draws has: ${drawsText()}). Fix the Sport and Discipline here, or add that draw to Draws.`, { sheet: 'Squads', row: r.row, column: 'Sport' });
        }
      } else if (draws.length === 1) {
        draw = draws[0];
        onlyDrawRows.push(r.row);
      } else if (draws.length > 1) {
        error('missing_value', `Squads row ${r.row} has no Sport or Discipline, and there is more than one draw (${drawsText()}). Fill in which draw this squad plays in.`, { sheet: 'Squads', row: r.row, column: 'Sport' });
      }

      const compRaw = r.get('competitor');
      let name = tidy(r.get('squad_name'));
      let competitor = tidy(compRaw);
      if (!competitor) {
        error('missing_value', `Squads row ${r.row}${name ? ` ("${name}")` : ''} does not say who it plays for. Fill in "Plays for" with its ${competitorWord}.`, { sheet: 'Squads', row: r.row, column: 'Plays for' });
        competitor = name || `Row ${r.row}`;
      }
      if (!name) {
        if (compRaw) {
          warn('squad_name_missing', `Squads row ${r.row} has no squad name, so it is named after what it plays for: "${competitor}". Fill in Squad name to choose another.`, { sheet: 'Squads', row: r.row, column: 'Squad name' });
        }
        name = competitor;
      }
      const section = tidy(r.get('section')) || undefined;
      const sq: SquadRec = {
        key: `s${r.row}`, row: r.row, draw, name, nameNorm: looseKey(name),
        codeGiven: tidy(r.get('short_code')), shortName: '', competitor, compNorm: looseKey(competitor),
        section, mentions: [], members: [], competitorKey: '',
      };
      const si = squads.push(sq) - 1;

      const mention = (role: Role, nameRaw: string, column: string, extra: Partial<Mention> = {}) => {
        const nm = tidy(nameRaw);
        // People skipped: nobody is created, so names and contacts are not read.
        if (!nm || peopleSkipped) return;
        const key = nameKey(nm);
        if (!key) {
          warn('not_a_name', `Squads row ${r.row}, ${column}: "${nm}" has no letters, so it is not read as a person. Write the person's name there.`, { sheet: 'Squads', row: r.row, column });
          return;
        }
        const m: Mention = { squad: si, role, name: displayName(nm), key, row: r.row, column, ...extra };
        if (m.id !== undefined) { m.id = tidy(m.id); m.idk = idKey(m.id) || undefined; if (!m.idk) m.id = undefined; }
        sq.mentions.push(mentions.push(m) - 1);
      };

      const captain = r.get('captain_name');
      if (!captain && !peopleSkipped) {
        error('missing_value', `Squad "${name}" (Squads row ${r.row}) has no captain. Write the captain's name in Captain name.`, { sheet: 'Squads', row: r.row, column: 'Captain name' });
      }
      mention('captain', captain, 'Captain name', {
        id: r.get('captain_id') || undefined, phoneRaw: r.get('captain_mobile'), emailRaw: r.get('captain_email'),
        phoneColumn: 'Captain mobile', emailColumn: 'Captain email',
      });
      mention('vice_captain', r.get('vc_name'), 'Vice-captain name', {
        id: r.get('vc_id') || undefined, phoneRaw: r.get('vc_mobile'), emailRaw: r.get('vc_email'),
        phoneColumn: 'Vice-captain mobile', emailColumn: 'Vice-captain email',
      });
      for (const s of slots) {
        const col = slotHeader(s.key);
        mention(s.role, r.get(s.key), col, {
          id: r.get(`${s.key}_id`) || undefined, phoneRaw: r.get(`${s.key}_mobile`), emailRaw: r.get(`${s.key}_email`),
          phoneColumn: `${col} mobile`, emailColumn: `${col} email`,
        });
      }
    }
    if (onlyDrawRows.length) {
      info('only_draw_used', `${plural(onlyDrawRows.length, 'squad')} on Squads ${onlyDrawRows.length === 1 ? 'has' : 'have'} no Sport / Discipline and ${onlyDrawRows.length === 1 ? 'is' : 'are'} entered in ${draws[0].label}, the only draw.`, { sheet: 'Squads' });
    }
    if (!t.rows.length && t.headerRow > 0) {
      error('no_squads', 'The Squads sheet has headers but no rows. Add one row per squad.', { sheet: 'Squads' });
    }
  }

  // ---- squad names and codes, per draw -----------------------------------
  const byDraw = new Map<DrawRec, SquadRec[]>();
  for (const s of squads) if (s.draw) byDraw.set(s.draw, [...(byDraw.get(s.draw) ?? []), s]);
  for (const [draw, group] of byDraw) {
    const seen = new Map<string, SquadRec>();
    for (const s of group) {
      const had = seen.get(s.nameNorm);
      if (had) {
        error('duplicate_squad_name', `Two squads in ${draw.label} are called "${s.name}" (Squads rows ${had.row} and ${s.row}). Squad names must be unique in a draw - rename one, for example by adding its ${competitorWord} ("${s.name} (${s.competitor})").`, { sheet: 'Squads', row: s.row, column: 'Squad name' });
      } else seen.set(s.nameNorm, s);
    }
    const codes = new Map<string, SquadRec>();
    for (const s of group) {
      if (!s.codeGiven) continue;
      let code = s.codeGiven;
      if (code.length > 12) {
        code = code.slice(0, 12).trim();
        warn('short_code_too_long', `Short code "${s.codeGiven}" (Squads row ${s.row}) is longer than 12 characters; it is cut to "${code}". Write a shorter code to choose your own.`, { sheet: 'Squads', row: s.row, column: 'Short code' });
      }
      const had = codes.get(code.toUpperCase());
      if (had) {
        error('duplicate_short_code', `"${s.name}" and "${had.name}" in ${draw.label} both have the short code "${code}" (Squads rows ${had.row} and ${s.row}). Give each squad its own code, or leave it blank to have one made up.`, { sheet: 'Squads', row: s.row, column: 'Short code' });
      } else codes.set(code.toUpperCase(), s);
      s.shortName = code;
    }
    for (const s of group) {
      if (s.shortName) continue;
      const base = shortCode(s.name);
      let code = base;
      for (let n = 2; codes.has(code.toUpperCase()); n++) code = `${base.slice(0, 12 - String(n).length)}${n}`;
      codes.set(code.toUpperCase(), s);
      s.shortName = code;
    }
  }
  for (const s of squads) if (!s.shortName) s.shortName = (s.codeGiven || shortCode(s.name)).slice(0, 12);

  // ---- one squad per competitor per draw ----------------------------------
  const unitWord = type === 'intra' ? ev.unitLabel.toLowerCase() : competitorWord;
  const originalCompetitors = new Map<string, string>();
  for (const s of squads) if (!originalCompetitors.has(s.compNorm)) originalCompetitors.set(s.compNorm, s.competitor);
  /** Split unit name -> the competitor it came from, so one name never means two things. */
  const splitNames = new Map<string, string>();
  const splitName = (s: SquadRec) => {
    const base = `${s.competitor} · ${s.name}`;
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base} (${n})`;
      const norm = looseKey(name);
      const owner = splitNames.get(norm);
      // The same competitor + squad name in another draw is the same unit: reuse it.
      if (owner === s.compNorm) return name;
      if (!owner && !originalCompetitors.has(norm)) { splitNames.set(norm, s.compNorm); return name; }
    }
  };
  for (const [draw, group] of byDraw) {
    const byComp = new Map<string, SquadRec[]>();
    for (const s of group) byComp.set(s.compNorm, [...(byComp.get(s.compNorm) ?? []), s]);
    for (const same of byComp.values()) {
      if (same.length < 2) continue;
      if (type === 'intra') {
        for (const s of same.slice(1)) {
          s.splitUnit = splitName(s);
          warn('competitor_split', `"${s.competitor}" fields ${same.length} squads in ${draw.label} (Squads ${rowsText(same.map((x) => x.row))}), but a ${unitWord} can enter only one squad per draw. "${s.name}" is given its own ${unitWord}, "${s.splitUnit}". If that is wrong, change its "Plays for".`, { sheet: 'Squads', row: s.row, column: 'Plays for' });
        }
      } else {
        error('competitor_squad_clash', `"${same[0].competitor}" fields ${same.length} squads in ${draw.label} (Squads ${rowsText(same.map((x) => x.row))}: ${same.map((x) => `"${x.name}"`).join(', ')}), but ${type === 'inter' ? 'an organisation' : 'a campus'} can enter only one squad per draw. Remove the extra squads, or enter them in another draw.`, { sheet: 'Squads', row: same[1].row, column: 'Plays for' });
      }
    }
  }

  // ---- competitors ----------------------------------------------------------
  const competitorKind: SetupCompetitorSpec['kind'] = type === 'intra' ? 'department' : type === 'campus' ? 'campus' : 'organization';
  const competitors: SetupCompetitorSpec[] = [];
  const compByNorm = new Map<string, SetupCompetitorSpec>();
  const usedCompKeys = new Set<string>();
  const competitorFor = (name: string, code?: string): SetupCompetitorSpec => {
    const norm = looseKey(name);
    const had = compByNorm.get(norm);
    if (had) return had;
    const base = `c-${slug(name) || competitors.length + 1}`;
    let key = base;
    for (let n = 2; usedCompKeys.has(key); n++) key = `${base}-${n}`;
    usedCompKeys.add(key);
    const spec: SetupCompetitorSpec = { key, name, kind: competitorKind };
    if (code) spec.code = code;
    competitors.push(spec);
    compByNorm.set(norm, spec);
    return spec;
  };
  for (const s of squads) {
    if (!s.draw) continue;
    s.competitorKey = (s.splitUnit ? competitorFor(s.splitUnit, s.shortName) : competitorFor(s.competitor)).key;
  }

  // ======================================================================
  // PEOPLE: who is the same person
  // ======================================================================
  const parent = mentions.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const where = (m: Mention) => `Squads row ${m.row}, ${m.column}`;

  const byIdk = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  mentions.forEach((m, i) => {
    if (m.idk) byIdk.set(m.idk, [...(byIdk.get(m.idk) ?? []), i]);
    byName.set(m.key, [...(byName.get(m.key) ?? []), i]);
  });
  for (const group of byIdk.values()) for (const i of group.slice(1)) union(group[0], i);
  for (const group of byName.values()) {
    const ids = [...new Set(group.map((i) => mentions[i].idk).filter((x): x is string => !!x))];
    if (ids.length <= 1) { for (const i of group.slice(1)) union(group[0], i); continue; }
    const orphans: number[] = [];
    for (const i of group) {
      const m = mentions[i];
      if (m.idk) continue;
      const sameSquad = group.filter((j) => mentions[j].idk && mentions[j].squad === m.squad);
      const squadIds = new Set(sameSquad.map((j) => mentions[j].idk));
      if (squadIds.size === 1) union(sameSquad[0], i);
      else orphans.push(i);
    }
    for (const i of orphans.slice(1)) union(orphans[0], i);
    const first = mentions[group[0]];
    const shown = ids.map((idk) => {
      const m = mentions[group.find((i) => mentions[i].idk === idk)!];
      return `${m.id} (${where(m)})`;
    });
    warn('same_name_different_ids', `"${first.name}" appears with ${ids.length} different IDs: ${shown.join('; ')}. They are kept as ${ids.length} different people.${orphans.length ? ` Where the name appears without an ID (${list(orphans.map((i) => where(mentions[i])), 4)}), it is read as one more person.` : ''} If they are one person, use one ID everywhere.`, { sheet: 'Squads', row: first.row, column: first.column });
  }

  const persons: PersonRec[] = [];
  const personOfRoot = new Map<number, PersonRec>();
  const usedPersonKeys = new Set<string>();
  mentions.forEach((m, i) => {
    const root = find(i);
    let p = personOfRoot.get(root);
    if (!p) {
      p = {
        key: '', name: mentions[root].name, nameKeys: new Set(), ids: [], idks: [], mentions: [],
        squads: new Set(), comps: new Set(), phones: [], emails: [],
      };
      personOfRoot.set(root, p);
      persons.push(p);
    }
    p.mentions.push(i);
    p.nameKeys.add(m.key);
    p.squads.add(m.squad);
    p.comps.add(squads[m.squad].compNorm);
    if (m.idk && !p.idks.includes(m.idk)) { p.idks.push(m.idk); p.ids.push(m.id!); }
  });
  for (const p of persons) {
    const base = p.idks[0] ?? mentions[p.mentions[0]].key;
    let key = base;
    for (let n = 2; usedPersonKeys.has(key); n++) key = `${base}#${n}`;
    usedPersonKeys.add(key);
    p.key = key;
    if (p.nameKeys.size > 1) {
      const spellings = [...p.nameKeys].map((k) => {
        const m = mentions[p.mentions.find((i) => mentions[i].key === k)!];
        return `"${m.name}" (${where(m)})`;
      });
      const m0 = mentions[p.mentions[0]];
      warn('same_id_different_names', `ID ${p.ids[0] ?? ''} is used for ${spellings.join(' and ')}. They are read as one person, named "${p.name}". If they are different people, correct the ID.`, { sheet: 'Squads', row: m0.row, column: m0.column });
    }
    if (p.idks.length > 1) {
      const m0 = mentions[p.mentions[0]];
      warn('two_ids_one_person', `"${p.name}" has two IDs (${p.ids.join(', ')}); ${p.ids[0]} is used as the member code. Use one ID for one person.`, { sheet: 'Squads', row: m0.row, column: m0.column });
    }
  }
  const personOf = (mi: number) => personOfRoot.get(find(mi))!;

  // ---- members, per squad -------------------------------------------------
  for (const s of squads) {
    const roles = new Map<PersonRec, Role>();
    const listedAt = new Map<PersonRec, Mention>();
    const order: PersonRec[] = [];
    const listed = s.mentions.filter((i) => mentions[i].role === 'player' || mentions[i].role === 'substitute');
    const leaders = s.mentions.filter((i) => mentions[i].role === 'captain' || mentions[i].role === 'vice_captain');
    for (const i of listed) {
      const m = mentions[i]; const p = personOf(i);
      const had = listedAt.get(p);
      if (had) {
        warn('duplicate_in_squad', `"${m.name}" is listed twice in "${s.name}" (${had.column} and ${m.column}, Squads row ${s.row}). They are kept once${RANK[m.role] < RANK[roles.get(p)!] ? `, as a ${ROLE_WORD[m.role]}` : ''}. Delete the repeat.`, { sheet: 'Squads', row: s.row, column: m.column });
      } else { listedAt.set(p, m); order.push(p); }
      if (!roles.has(p) || RANK[m.role] < RANK[roles.get(p)!]) roles.set(p, m.role);
    }
    const leaderOf = new Map<Role, PersonRec>();
    for (const i of leaders) {
      const m = mentions[i]; const p = personOf(i);
      leaderOf.set(m.role, p);
      if (!listedAt.has(p)) {
        info('captain_not_listed', `The ${ROLE_WORD[m.role]} of "${s.name}", ${m.name}, is not in its player list, and is added to the squad as ${ROLE_WORD[m.role]}.`, { sheet: 'Squads', row: s.row, column: m.column });
      }
      if (!roles.has(p) || RANK[m.role] < RANK[roles.get(p)!]) roles.set(p, m.role);
    }
    const cap = leaderOf.get('captain'); const vc = leaderOf.get('vice_captain');
    if (cap && vc && cap === vc) {
      warn('captain_is_vice_captain', `"${s.name}" (Squads row ${s.row}) has ${cap.name} as both captain and vice-captain. They are kept as captain; name a different vice-captain or leave it blank.`, { sheet: 'Squads', row: s.row, column: 'Vice-captain name' });
    }
    const ordered = [cap, vc, ...order].filter((p): p is PersonRec => !!p);
    s.members = [...new Set(ordered)].map((p) => ({ personKey: p.key, role: roles.get(p)! }));
  }

  // ---- draw sizes, defaults ---------------------------------------------------
  for (const d of draws) {
    const group = byDraw.get(d) ?? [];
    const largest = Math.max(0, ...group.map((s) => s.members.length));
    if (!d.maxGiven) d.spec.squadMax = Math.max(largest, d.spec.squadMin, 1);
    if (!d.minGiven || !d.maxGiven) {
      info('squad_limits_defaulted', `${d.label}: ${!d.minGiven && !d.maxGiven ? 'Squad min and Squad max are' : !d.minGiven ? 'Squad min is' : 'Squad max is'} blank, so squads of ${d.spec.squadMin} to ${d.spec.squadMax} people are allowed${!d.maxGiven && !peopleSkipped ? ' (the largest squad on the sheet)' : ''}. Fill them in on Draws to set the real limits.`, { sheet: 'Draws', row: d.row });
    }
    for (const s of d.spec.squadMin > d.spec.squadMax || peopleSkipped ? [] : group) {
      const n = s.members.length;
      if (d.minGiven && n < d.spec.squadMin) {
        warn('squad_too_small', `"${s.name}" (Squads row ${s.row}) has ${plural(n, 'person', 'people')}, fewer than the ${d.spec.squadMin} that ${d.label} needs. Add players, or lower Squad min on Draws.`, { sheet: 'Squads', row: s.row });
      } else if (d.maxGiven && n > d.spec.squadMax) {
        warn('squad_too_large', `"${s.name}" (Squads row ${s.row}) has ${plural(n, 'person', 'people')}, more than the ${d.spec.squadMax} that ${d.label} allows. Remove some, or raise Squad max on Draws.`, { sheet: 'Squads', row: s.row });
      }
    }
    if (located.Squads && squadsNeeded && squadsTable && !squadsTable.missing.length) {
      if (!group.length) {
        warn('draw_without_squads', `No squad on the Squads sheet plays ${d.label}. Add its squads, or delete the draw from Draws.`, { sheet: 'Draws', row: d.row });
      } else if (group.length === 1) {
        warn('too_few_squads', `Only one squad plays ${d.label}, so there is nobody to play. Add squads or delete the draw.`, { sheet: 'Draws', row: d.row });
      }
    }
  }

  // ======================================================================
  // CONTACTS on Squads (People adds more below)
  // ======================================================================
  function badMobile(raw: string, who: string, at: Where) {
    warn('bad_mobile', `${who}'s mobile "${raw}" (${at.sheet} row ${at.row}, ${at.column}) is not a 10-digit Indian mobile, so they get a placeholder until it is fixed. Write it as 10 digits starting 6, 7, 8 or 9.`, at);
  }
  function badEmail(raw: string, who: string, at: Where) {
    warn('bad_email', `${who}'s email "${raw}" (${at.sheet} row ${at.row}, ${at.column}) is not a valid email address, so it is not used. Fix it or leave it blank.`, at);
  }
  mentions.forEach((m, i) => {
    const p = personOf(i);
    if (m.phoneRaw) {
      const ph = parseMobile(m.phoneRaw);
      if (ph.bad) badMobile(m.phoneRaw, m.name, { sheet: 'Squads', row: m.row, column: m.phoneColumn });
      if (ph.phone) p.phones.push({ value: ph.phone, where: `Squads row ${m.row}`, sheet: 'Squads', row: m.row, column: m.phoneColumn ?? '' });
    }
    if (m.emailRaw) {
      const em = parseEmail(m.emailRaw);
      if (em.bad) badEmail(m.emailRaw, m.name, { sheet: 'Squads', row: m.row, column: m.emailColumn });
      if (em.email) p.emails.push({ value: em.email, where: `Squads row ${m.row}`, sheet: 'Squads', row: m.row, column: m.emailColumn ?? '' });
    }
  });

  // ======================================================================
  // PEOPLE sheet: contacts by ID, then exact name
  // ======================================================================
  if (located.People && steps.people === 'skip') {
    info('sheet_ignored', 'People is set to Skip, so the People sheet was not read.', { sheet: 'People' });
  } else if (located.People) {
    const t = readTable(located.People.grid, templateSheet('People'), type, sink, undefined, true);
    if (!t.missing.length) {
      const byPersonIdk = new Map<string, PersonRec>();
      for (const p of persons) for (const k of p.idks) byPersonIdk.set(k, p);
      for (const r of t.rows) {
        const nm = tidy(r.get('name'));
        const id = tidy(r.get('id'));
        const idk = idKey(id);
        if (!nm && !id) {
          warn('missing_value', `People row ${r.row} has no name, so it is not used. Fill in Name, exactly as on Squads.`, { sheet: 'People', row: r.row, column: 'Name' });
          continue;
        }
        let target = idk ? byPersonIdk.get(idk) : undefined;
        if (!target) {
          const nk = nameKey(nm);
          const cands = nk ? persons.filter((p) => p.nameKeys.has(nk)) : [];
          if (cands.length > 1) {
            warn('people_row_ambiguous', `People row ${r.row} ("${nm}") matches ${cands.length} different people on Squads (${cands.map((p) => p.ids[0] ?? 'no ID').join(', ')}), so its contacts are not used. Give it the right ID.`, { sheet: 'People', row: r.row, column: 'Name' });
            continue;
          }
          if (cands.length === 1 && idk && cands[0].idks.length && !cands[0].idks.includes(idk)) {
            warn('people_id_mismatch', `People row ${r.row} has "${nm}" with ID ${id}, but Squads gives ${nm} the ID ${cands[0].ids[0]}. Its contacts are not used until the IDs agree.`, { sheet: 'People', row: r.row, column: 'ID' });
            continue;
          }
          target = cands[0];
        }
        if (!target) {
          warn('people_row_unmatched', `People row ${r.row} ("${nm || id}") is not on any squad, so it is not used. People only adds contacts to squad members - check the spelling matches Squads, or add the person to a squad.`, { sheet: 'People', row: r.row, column: 'Name' });
          continue;
        }
        if (idk && !target.idks.includes(idk)) { target.idks.push(idk); target.ids.push(id); byPersonIdk.set(idk, target); }
        const ph = parseMobile(r.get('mobile'));
        if (ph.bad) badMobile(r.get('mobile'), target.name, { sheet: 'People', row: r.row, column: 'Mobile' });
        if (ph.phone) target.phones.push({ value: ph.phone, where: `People row ${r.row}`, sheet: 'People', row: r.row, column: 'Mobile' });
        const em = parseEmail(r.get('email'));
        if (em.bad) badEmail(r.get('email'), target.name, { sheet: 'People', row: r.row, column: 'Email' });
        if (em.email) target.emails.push({ value: em.email, where: `People row ${r.row}`, sheet: 'People', row: r.row, column: 'Email' });
        const g = r.get('gender').toLowerCase();
        if (g) {
          const gender = g === 'm' || g === 'male' ? 'male' : g === 'f' || g === 'female' ? 'female' : g === 'other' ? 'other' : null;
          if (gender) target.gender = gender;
          else warn('bad_value', `People row ${r.row}: Gender "${r.get('gender')}" is not Male, Female or Other, so it is left blank.`, { sheet: 'People', row: r.row, column: 'Gender' });
        }
      }
    }
  }

  // ---- one contact, one person ---------------------------------------------
  resolveShared('mobile', persons, (p) => p.phones, maskPhone, warn);
  resolveShared('email', persons, (p) => p.emails, (e) => e, warn);
  for (const p of persons) {
    p.phone = pickOne('mobile', p, p.phones, maskPhone, warn);
    p.email = pickOne('email', p, p.emails, (e) => e, warn);
  }

  // ---- same person in several squads; possibly one person written two ways ----
  const multi = persons.filter((p) => p.squads.size > 1);
  if (multi.length) {
    const shown = multi.map((p) => `${p.name} (${[...p.squads].map((i) => squads[i].name).join(', ')})`);
    info('same_person_several_squads', `${plural(multi.length, 'person is', 'people are')} on more than one squad and ${multi.length === 1 ? 'is' : 'are'} read as one person each (the same name is the same person): ${list(shown, 10)}. Playing for several squads is allowed. If two of them are different people, give each their own ID.`, { sheet: 'Squads' });
  }
  const pairSeen = new Set<string>();
  const compGroups = new Map<string, PersonRec[]>();
  for (const p of persons) for (const c of p.comps) compGroups.set(c, [...(compGroups.get(c) ?? []), p]);
  for (const [comp, group] of compGroups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]; const b = group[j];
        if (a.idks.length && b.idks.length && !a.idks.some((k) => b.idks.includes(k))) continue;
        const ka = mentions[a.mentions[0]].key; const kb = mentions[b.mentions[0]].key;
        if (ka === kb || !namesLookAlike(ka, kb)) continue;
        const pair = [a.key, b.key].sort().join('|');
        if (pairSeen.has(pair)) continue;
        pairSeen.add(pair);
        const ma = mentions[a.mentions[0]]; const mb = mentions[b.mentions[0]];
        warn('possible_same_person', `"${a.name}" (${where(ma)}) and "${b.name}" (${where(mb)}), both in ${originalCompetitors.get(comp) ?? comp}, may be the same person. They are read as two people. If they are one person, write the name the same way in both places.`, { sheet: 'Squads', row: mb.row, column: mb.column });
      }
    }
  }

  // ======================================================================
  // STAFF
  // ======================================================================
  const staff: SetupStaffSpec[] = [];
  if (located.Staff && steps.staff === 'skip') {
    info('sheet_ignored', 'Staff and roles is set to Skip, so the Staff sheet was not read and nobody is given a role.', { sheet: 'Staff' });
  } else if (located.Staff) {
    const t = readTable(located.Staff.grid, templateSheet('Staff'), type, sink);
    if (!t.missing.length) {
      const seen = new Map<string, number>();
      for (const r of t.rows) {
        const nm = tidy(r.get('name'));
        const roleRaw = r.get('role');
        if (!nm) {
          error('missing_value', `Staff row ${r.row} has no name. Fill in Name, or delete the row.`, { sheet: 'Staff', row: r.row, column: 'Name' });
          continue;
        }
        if (!roleRaw) {
          error('missing_value', `Staff row ${r.row} (${nm}) has no role. Write Organiser, Official, POC, Org owner or Org admin.`, { sheet: 'Staff', row: r.row, column: 'Role' });
          continue;
        }
        const role = staffRole(roleRaw);
        if (!role) {
          error('bad_role', `Staff row ${r.row} (${nm}): "${roleRaw}" is not a role. Write Organiser, Official (or Referee), POC, Org owner or Org admin.`, { sheet: 'Staff', row: r.row, column: 'Role' });
          continue;
        }
        const spec: SetupStaffSpec = { key: `st${r.row}`, name: displayName(nm) };
        if (role.orgRole) spec.orgRole = role.orgRole;
        if (role.eventRole) spec.eventRole = role.eventRole;
        const ph = parseMobile(r.get('mobile'));
        if (ph.bad) badMobile(r.get('mobile'), spec.name, { sheet: 'Staff', row: r.row, column: 'Mobile' });
        if (ph.phone) spec.phone = ph.phone;
        const em = parseEmail(r.get('email'));
        if (em.bad) badEmail(r.get('email'), spec.name, { sheet: 'Staff', row: r.row, column: 'Email' });
        if (em.email) spec.email = em.email;

        const groundRaw = r.get('ground');
        if (groundRaw && groundsUnused) {
          info('ground_ignored', `Staff row ${r.row}: Venue and Fixtures are both set to Skip, so no grounds are set up and ${spec.name}'s ground (${groundRaw}) is not used.`, { sheet: 'Staff', row: r.row, column: 'Ground' });
        } else if (groundRaw) {
          const g = groundFor(ev.grounds, groundRaw);
          if (!g) {
            error('unknown_ground', `Staff row ${r.row} (${spec.name}): ground "${groundRaw}" is not one of the Grounds on the Event sheet (${ev.grounds.map((x) => x.name).join(', ') || 'none'}). Use one of those names.`, { sheet: 'Staff', row: r.row, column: 'Ground' });
          } else if (role.eventRole === 'official') {
            spec.groundKey = g.key;
            spec.note = `Scores every match on ${g.name}`;
          } else {
            info('ground_ignored', `Staff row ${r.row}: ${spec.name} is not an official, so their ground (${g.name}) is not used.`, { sheet: 'Staff', row: r.row, column: 'Ground' });
          }
        } else if (role.eventRole === 'official' && !groundsUnused) {
          warn('official_without_ground', `Staff row ${r.row}: official ${spec.name} has no ground, so they are not assigned to any match. Fill in the ground they score.`, { sheet: 'Staff', row: r.row, column: 'Ground' });
        }

        const compRaw = r.get('competitor');
        if (role.eventRole === 'poc') {
          if (type !== 'inter') {
            warn('poc_not_inter', `Staff row ${r.row}: ${spec.name} is a POC, a role meant for inter events (the person who speaks for a competing organisation). In a ${type} event make them an Organiser, or delete the row.`, { sheet: 'Staff', row: r.row, column: 'Role' });
          } else if (!compRaw) {
            error('missing_value', `Staff row ${r.row}: POC ${spec.name} does not say which organisation they speak for. Fill in "For organisation" with one of the organisations on Squads.`, { sheet: 'Staff', row: r.row, column: 'For organisation' });
          } else {
            const comp = compByNorm.get(looseKey(compRaw));
            const isOriginal = originalCompetitors.has(looseKey(compRaw));
            if (!comp || !isOriginal) {
              error('unknown_competitor', `Staff row ${r.row}: POC ${spec.name} is for "${compRaw}", which no squad plays for. Use an organisation from "Plays for" on Squads (${list([...originalCompetitors.values()], 6) || 'none'}).`, { sheet: 'Staff', row: r.row, column: 'For organisation' });
            } else spec.competitorKey = comp.key;
          }
        } else if (compRaw) {
          info('competitor_ignored', `Staff row ${r.row}: "For organisation" is only used for POCs, so it is ignored for ${spec.name}.`, { sheet: 'Staff', row: r.row, column: 'For organisation' });
        }

        const dupKey = `${nameKey(nm)}|${role.label}|${spec.groundKey ?? ''}`;
        const had = seen.get(dupKey);
        if (had) {
          warn('duplicate_staff', `${spec.name} is on the Staff sheet twice with the same role (rows ${had} and ${r.row}). Delete the repeat.`, { sheet: 'Staff', row: r.row, column: 'Name' });
          continue;
        }
        seen.set(dupKey, r.row);
        staff.push(spec);
      }
      if (t.headerRow > 0 && !staff.some((s) => s.eventRole === 'organiser')) {
        error('no_organiser', 'Nobody on the Staff sheet is an Organiser or Org owner, and the event needs at least one to run it. Add a row with Role "Organiser" or "Org owner".', { sheet: 'Staff', column: 'Role' });
      }
    }
  }

  // ======================================================================
  // SCHEDULE
  // ======================================================================
  const fixtures: SetupFixtureSpec[] = [];
  let byes = 0;
  const schedRows: SchedRow[] = [];
  const scheduledDraws = new Set<DrawRec>();
  /** The Schedule has rows but not the columns to read them: generating instead would hide that. */
  let scheduleUnreadable = false;
  if (located.Schedule && steps.fixtures === 'skip') {
    info('sheet_ignored', 'Fixtures is set to Skip, so the Schedule sheet was not read.', { sheet: 'Schedule' });
  } else if (located.Schedule) {
    const t = readTable(located.Schedule.grid, templateSheet('Schedule'), type, sink, undefined, true);
    if (t.missing.length) scheduleUnreadable = true;
    else readSchedule(t);
  }
  function readSchedule(t: TableRead) {
    const refused = new Set<DrawRec>();
    for (const r of t.rows) {
      const sport = r.get('sport'); const disc = r.get('discipline');
      let draw: DrawRec | undefined;
      if (sport || disc) {
        draw = drawFor(sport, disc);
        if (!draw) {
          if (draws.length) error('unknown_draw', `Schedule row ${r.row} is for "${[sport, disc].filter(Boolean).join(' / ')}", which is not a row on Draws (Draws has: ${drawsText()}). Fix the Sport and Discipline here.`, { sheet: 'Schedule', row: r.row, column: 'Sport' });
          continue;
        }
      } else if (draws.length === 1) draw = draws[0];
      else {
        if (draws.length) error('missing_value', `Schedule row ${r.row} has no Sport or Discipline, and there is more than one draw (${drawsText()}). Fill in which draw the match is in.`, { sheet: 'Schedule', row: r.row, column: 'Sport' });
        continue;
      }
      if (draw.spec.format !== 'Knockout') {
        if (!refused.has(draw)) {
          refused.add(draw);
          error('schedule_needs_knockout', `The Schedule sheet has matches for ${draw.label}, which is a ${draw.spec.format} draw. A schedule sheet can only describe a knockout. Delete those Schedule rows and the fixtures are generated from the squads, or change the draw's Format to Knockout.`, { sheet: 'Schedule', row: r.row, column: 'Sport' });
        }
        continue;
      }
      scheduledDraws.add(draw);
      const sr: SchedRow = {
        row: r.row, draw, matchId: tidy(r.get('match_id')), idNorm: '', sides: [null, null],
        sideRaw: [r.get('side_1'), r.get('side_2')], shapeOk: true,
      };
      sr.idNorm = sr.matchId.toLowerCase().replace(/\s+/g, '');
      if (!sr.matchId) {
        error('missing_value', `Schedule row ${r.row} has no Match ID. Give every match an id (B1-R1-1, M1…); later rounds name it in "Winner of <Match ID>".`, { sheet: 'Schedule', row: r.row, column: 'Match ID' });
        sr.shapeOk = false;
      }
      // date
      const dateRaw = r.get('date');
      if (!dateRaw) {
        if (ev.start && ev.start === ev.end) sr.date = ev.start;
        else error('missing_value', `Schedule row ${r.row} has no date. Write the date (YYYY-MM-DD) or "Day 1".`, { sheet: 'Schedule', row: r.row, column: 'Date' });
      } else {
        const day = dateRaw.match(/^day\s*[-#]?\s*(\d+)\b/i);
        if (day) {
          const n = Number(day[1]);
          sr.date = ev.days.get(n);
          if (!sr.date) {
            error('unmapped_day', ev.days.size
              ? `Schedule row ${r.row} says "${dateRaw}", but Day dates on the Event sheet has no Day ${n}. Add "Day ${n}=YYYY-MM-DD" to Day dates, or write the date here.`
              : `Schedule row ${r.row} says "${dateRaw}", but Day dates on the Event sheet is blank. Fill it in (Day 1=2026-10-17; Day 2=2026-10-18), or write dates here.`,
            { sheet: 'Schedule', row: r.row, column: 'Date' });
          }
        } else {
          sr.date = parseDate(dateRaw) ?? undefined;
          if (!sr.date) error('bad_date', `Schedule row ${r.row}: "${dateRaw}" is not a date. Write it as YYYY-MM-DD (2026-10-17), or "Day 1" with Day dates set on the Event sheet.`, { sheet: 'Schedule', row: r.row, column: 'Date' });
          else if (dateIsAmbiguous(dateRaw) && !ambiguousSeen.has(dateRaw)) {
            // Once per distinct text: a 50-row schedule on one day is one question, not fifty.
            ambiguousSeen.add(dateRaw);
            warn('ambiguous_date', ambiguousDateText(dateRaw, sr.date), { sheet: 'Schedule', row: r.row, column: 'Date' });
          }
        }
        if (sr.date && ev.start && ev.end && (sr.date < ev.start || sr.date > ev.end)) {
          warn('match_outside_event', `Schedule row ${r.row} (${sr.matchId}) is on ${sr.date}, outside the event's dates (${ev.start} to ${ev.end}). Check the date, or the Start and End dates on the Event sheet.`, { sheet: 'Schedule', row: r.row, column: 'Date' });
        }
      }
      // times
      const kickRaw = r.get('kickoff');
      if (!kickRaw) error('missing_value', `Schedule row ${r.row} has no kickoff time. Write it as 14:20 or 2:20 PM.`, { sheet: 'Schedule', row: r.row, column: 'Kickoff' });
      else {
        sr.start = parseTime(kickRaw) ?? undefined;
        if (sr.start === undefined) error('bad_time', `Schedule row ${r.row}: kickoff "${kickRaw}" is not a time. Write it as 14:20 or 2:20 PM.`, { sheet: 'Schedule', row: r.row, column: 'Kickoff' });
      }
      const endRaw = r.get('end');
      if (endRaw) {
        const end = parseTime(endRaw);
        if (end === null) error('bad_time', `Schedule row ${r.row}: end "${endRaw}" is not a time. Write it as 14:45 or 2:45 PM, or leave it blank to use the draw's match minutes.`, { sheet: 'Schedule', row: r.row, column: 'End' });
        else if (sr.start !== undefined) {
          if (end <= sr.start) error('bad_end', `Schedule row ${r.row}: the match ends (${clock(end)}) before it starts (${clock(sr.start)}). Fix End or Kickoff.`, { sheet: 'Schedule', row: r.row, column: 'End' });
          else sr.minutes = end - sr.start;
        }
      } else if (draw.minutes) sr.minutes = draw.minutes;
      else {
        error('no_match_length', `Schedule row ${r.row} has no End time, and ${draw.label} has no Match minutes on Draws, so the match length is unknown. Fill in End here, or Match minutes on Draws.`, { sheet: 'Schedule', row: r.row, column: 'End' });
      }
      // ground
      const groundRaw = r.get('ground');
      if (!groundRaw) error('missing_value', `Schedule row ${r.row} has no ground. Write one of the Grounds on the Event sheet (${ev.grounds.map((g) => g.name).join(', ') || 'none yet'}).`, { sheet: 'Schedule', row: r.row, column: 'Ground' });
      else {
        sr.ground = groundFor(ev.grounds, groundRaw);
        if (!sr.ground) error('unknown_ground', `Schedule row ${r.row}: ground "${groundRaw}" is not one of the Grounds on the Event sheet (${ev.grounds.map((g) => g.name).join(', ') || 'none'}). Use one of those names, or add it to Grounds.`, { sheet: 'Schedule', row: r.row, column: 'Ground' });
      }
      // sides
      sr.sideRaw.forEach((raw, i) => {
        const column = i === 0 ? 'Side 1' : 'Side 2';
        if (!raw) {
          error('missing_value', `Schedule row ${r.row} has no ${column}. Write a squad name, or "Winner of <Match ID>".`, { sheet: 'Schedule', row: r.row, column });
          sr.shapeOk = false;
          return;
        }
        const w = raw.match(/^winners?\s+of\s*[:\-]?\s*(.+)$/i);
        if (w) { sr.sides[i] = { winnerOf: tidy(w[1]) }; return; }
        if (/^(?:bye|walk\s*-?over|w\/o)$/i.test(raw)) {
          error('bye_row', `Schedule row ${r.row} is a bye ("${raw}"). Leave byes out: a squad with a bye simply appears in its next-round match, against "Winner of …".`, { sheet: 'Schedule', row: r.row, column });
          sr.shapeOk = false;
          return;
        }
        const s = squadFor(draw!, raw, tidy(r.get('section')));
        if (s.squad) {
          sr.sides[i] = { squadKey: s.squad.key };
          if (s.how === 'prefix') info('squad_matched_by_prefix', `Schedule row ${r.row}: "${raw}" is read as the squad "${s.squad.name}" (Squads row ${s.squad.row}).`, { sheet: 'Schedule', row: r.row, column });
        } else {
          const hits = s.candidates ?? [];
          if (hits.length > 1) {
            error('ambiguous_squad', `Schedule row ${r.row}: "${raw}" could be any of ${hits.map((x) => `"${x.name}"`).join(', ')} in ${draw!.label}. Write the full squad name.`, { sheet: 'Schedule', row: r.row, column });
          } else {
            error('unknown_squad', `Schedule row ${r.row}: "${raw}" is not a squad in ${draw!.label}. Write the squad name exactly as on Squads, or "Winner of <Match ID>".`, { sheet: 'Schedule', row: r.row, column });
          }
          sr.shapeOk = false;
        }
      });
      schedRows.push(sr);
    }

    // ---- per draw: the bracket --------------------------------------------
    for (const draw of draws) {
      if (!scheduledDraws.has(draw)) continue;
      const rows = schedRows.filter((x) => x.draw === draw);
      const byId = new Map<string, SchedRow>();
      for (const x of rows) {
        if (!x.matchId) continue;
        const had = byId.get(x.idNorm);
        if (had) {
          error('duplicate_match_id', `Match ID "${x.matchId}" is used twice in ${draw.label} (Schedule rows ${had.row} and ${x.row}). Give each match its own id.`, { sheet: 'Schedule', row: x.row, column: 'Match ID' });
          x.shapeOk = false;
          x.dupId = true;
        } else byId.set(x.idNorm, x);
      }
      const resolveRef = (ref: string) => {
        const n = ref.toLowerCase().replace(/\s+/g, '');
        return byId.get(n) ?? byId.get(n.replace(/^(?:match|m\.?)(?=.)/, '')) ?? byId.get(n.replace(/^(?:match)?#?/, ''));
      };
      const feeds = new Map<SchedRow, SchedRow[]>();
      for (const x of rows) {
        x.sides.forEach((s, i) => {
          if (!s || !('winnerOf' in s)) return;
          const target = resolveRef(s.winnerOf);
          const column = i === 0 ? 'Side 1' : 'Side 2';
          if (!target) {
            error('unknown_match_ref', `Schedule row ${x.row}: "${x.sideRaw[i]}" names a match that is not in ${draw.label}'s schedule. Use the Match ID of an earlier match in the same draw.`, { sheet: 'Schedule', row: x.row, column });
            x.shapeOk = false;
            return;
          }
          if (target === x) {
            error('bad_bracket', `Schedule row ${x.row}: match ${x.matchId} takes its own winner. Name the earlier match it follows.`, { sheet: 'Schedule', row: x.row, column });
            x.shapeOk = false;
            return;
          }
          x.sides[i] = { winnerOf: target.matchId };
          feeds.set(target, [...(feeds.get(target) ?? []), x]);
        });
      }
      for (const [target, users] of feeds) {
        if (users.length > 1) {
          error('winner_used_twice', `The winner of ${target.matchId} (Schedule row ${target.row}) is named in ${users.length} matches (Schedule ${rowsText(users.map((u) => u.row))}). In a knockout each winner plays exactly one next match.`, { sheet: 'Schedule', row: users[1].row });
          for (const u of users) u.shapeOk = false;
        }
      }
      const squadRows = new Map<string, SchedRow[]>();
      for (const x of rows) for (const s of x.sides) if (s && 'squadKey' in s) squadRows.set(s.squadKey, [...(squadRows.get(s.squadKey) ?? []), x]);
      for (const [key, at] of squadRows) {
        const uniq = [...new Set(at)];
        if (uniq.length > 1 || at.length > 1) {
          const sq = squads.find((s) => s.key === key)!;
          error('squad_twice_in_schedule', `"${sq.name}" is named in ${uniq.length > 1 ? `${uniq.length} matches` : 'both sides of one match'} in ${draw.label} (Schedule ${rowsText(uniq.map((u) => u.row))}). A squad is named only in its first match; later rounds say "Winner of <Match ID>".`, { sheet: 'Schedule', row: uniq[uniq.length - 1].row });
          for (const u of uniq) u.shapeOk = false;
        }
      }
      // feeder timing
      for (const x of rows) {
        for (const s of x.sides) {
          if (!s || !('winnerOf' in s)) continue;
          const f = resolveRef(s.winnerOf);
          if (!f || x.date === undefined || x.start === undefined || f.date === undefined || f.start === undefined || f.minutes === undefined) continue;
          const fEnd = absMinutes(f.date, f.start + f.minutes);
          if (absMinutes(x.date, x.start) < fEnd) {
            error('starts_before_feeder', `Schedule row ${x.row}: ${x.matchId} takes the winner of ${f.matchId}, but starts (${x.date} ${clock(x.start)}) before ${f.matchId} ends (${f.date} ${clock((f.start + f.minutes) % 1440)}). Move it later.`, { sheet: 'Schedule', row: x.row, column: 'Kickoff' });
          }
        }
      }

      const allShaped = rows.every((x) => x.shapeOk);
      if (allShaped && rows.length) {
        const fed = new Set<SchedRow>(feeds.keys());
        const roots = rows.filter((x) => !fed.has(x));
        if (roots.length > 1) {
          error('two_finals', `${draw.label}'s schedule has ${roots.length} matches that no later match follows (${roots.map((x) => `${x.matchId}, row ${x.row}`).join('; ')}), so it has more than one final. Every match except the final must be named in a later "Winner of <Match ID>".`, { sheet: 'Schedule', row: roots[1].row, column: 'Match ID' });
        } else if (roots.length === 0) {
          error('bad_bracket', `${draw.label}'s schedule has no final: every match feeds another, which makes a loop. Check the "Winner of" names.`, { sheet: 'Schedule', row: rows[0].row });
        } else {
          try {
            const layout = knockoutFromRows(rows.map(toMatchRow));
            byes += layout.pairs.filter((p) => p.home === null || p.away === null).length;
          } catch (err) {
            if (!(err instanceof KnockoutSheetError)) throw err;
            const at = err.matchId ? rows.find((x) => x.matchId === err.matchId) : undefined;
            error('bad_bracket', `${draw.label}: ${err.message}. Every match after the first round must take the winner of a match in the round just before it; a squad may skip only the first round (a bye).`, { sheet: 'Schedule', row: at?.row, column: 'Match ID' });
          }
        }
      }
      if (rows.every((x) => x.sides.every((s) => s !== null))) {
        const named = new Set(squadRows.keys());
        for (const s of byDraw.get(draw) ?? []) {
          if (!named.has(s.key)) {
            error('squad_not_in_schedule', `"${s.name}" (Squads row ${s.row}) is in ${draw.label} but not in its schedule. Add its first match to the Schedule sheet, or remove the squad.`, { sheet: 'Schedule', column: 'Side 1' });
          }
        }
      }
      // The blueprint carries only rows that are whole, and never a "Winner of" that
      // points at a row left out - so it stays self-consistent even while errors stand.
      let kept = rows.filter((x) => isComplete(x) && !x.dupId);
      for (let before = -1; before !== kept.length;) {
        before = kept.length;
        const ids = new Set(kept.map((x) => x.matchId));
        kept = kept.filter((x) => x.sides.every((s) => !s || !('winnerOf' in s) || ids.has(s.winnerOf)));
      }
      fixtures.push({ kind: 'knockout-rows', drawKey: draw.spec.key, utcOffset: UTC_OFFSET, rows: kept.map(toMatchRow) });
    }

    // ---- clashes across every draw ------------------------------------------
    const timed = schedRows.filter((x) => x.date !== undefined && x.start !== undefined && x.minutes !== undefined)
      .map((x) => ({ x, from: absMinutes(x.date!, x.start!), to: absMinutes(x.date!, x.start! + x.minutes!) }))
      .sort((a, b) => a.from - b.from || a.x.row - b.x.row);
    const membersOf = new Map<string, Set<string>>();
    for (const s of squads) membersOf.set(s.key, new Set(s.members.map((m) => m.personKey)));
    const personName = new Map(persons.map((p) => [p.key, p.name]));
    // One person on both sides of one match.
    for (const x of peopleSkipped ? [] : schedRows) {
      const [h, a] = x.sides;
      if (!h || !a || !('squadKey' in h) || !('squadKey' in a) || h.squadKey === a.squadKey) continue;
      const both = [...(membersOf.get(h.squadKey) ?? [])].filter((pk) => membersOf.get(a.squadKey)?.has(pk));
      if (both.length) {
        warn('person_clash', `${list(both.map((k) => personName.get(k) ?? k), 5)} ${both.length === 1 ? 'is' : 'are'} in both squads of match ${x.matchId} (Schedule row ${x.row}), so cannot play for both sides. Check the squads, or whether they are really the same ${both.length === 1 ? 'person' : 'people'}.`, { sheet: 'Schedule', row: x.row, column: 'Side 2' });
      }
    }
    const span = (t: { x: SchedRow; from: number; to: number }) => `${clock(t.x.start!)}–${clock((t.x.start! + t.x.minutes!) % 1440)}`;
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length && timed[j].from < timed[i].to; j++) {
        const a = timed[i]; const b = timed[j];
        if (a.x.ground && a.x.ground === b.x.ground) {
          error('ground_clash', `Schedule rows ${a.x.row} and ${b.x.row} are both on ${a.x.ground.name} at the same time (${a.x.date} ${span(a)} and ${span(b)}). Move one to another ground or time.`, { sheet: 'Schedule', row: b.x.row, column: 'Ground' });
        }
        const sa = a.x.sides.flatMap((s) => (s && 'squadKey' in s ? [s.squadKey] : []));
        const sb = b.x.sides.flatMap((s) => (s && 'squadKey' in s ? [s.squadKey] : []));
        for (const k of sa) {
          if (sb.includes(k)) {
            const sq = squads.find((s) => s.key === k)!;
            error('squad_clash', `"${sq.name}" plays two matches at the same time (Schedule rows ${a.x.row} and ${b.x.row}, ${a.x.date} ${span(a)} and ${span(b)}). Move one of them.`, { sheet: 'Schedule', row: b.x.row, column: 'Kickoff' });
          }
        }
        if (peopleSkipped) continue;
        const shared = new Set<string>();
        for (const ka of sa) for (const kb of sb) {
          if (ka === kb) continue;
          for (const pk of membersOf.get(ka) ?? []) if (membersOf.get(kb)?.has(pk)) shared.add(pk);
        }
        if (shared.size) {
          const names = [...shared].map((k) => personName.get(k) ?? k);
          warn('person_clash', `${list(names, 5)} ${shared.size === 1 ? 'is' : 'are'} in squads that play at the same time (Schedule rows ${a.x.row} and ${b.x.row}, ${a.x.date} ${span(a)} and ${span(b)}), so cannot play both. Move a match, or check they are really the same ${shared.size === 1 ? 'person' : 'people'}.`, { sheet: 'Schedule', row: b.x.row, column: 'Kickoff' });
        }
      }
    }
  }

  // ---- draws with no schedule are generated ---------------------------------
  if (steps.fixtures !== 'skip' && !scheduleUnreadable) {
    const generated = draws.filter((d) => !scheduledDraws.has(d));
    for (const d of generated) fixtures.push({ kind: 'generate', drawKey: d.spec.key });
    if (generated.length) {
      info('fixtures_generated', `${list(generated.map((d) => d.label))}: no schedule on the sheet, so ${generated.length === 1 ? 'its' : 'their'} fixtures are generated from the squads, in sheet order, when the event is set up.`, located.Schedule ? { sheet: 'Schedule' } : {});
    }
    fixtures.sort((a, b) => draws.findIndex((d) => d.spec.key === a.drawKey) - draws.findIndex((d) => d.spec.key === b.drawKey));
  }

  // ======================================================================
  // STEPS
  // ======================================================================
  for (const s of SETUP_STEPS) {
    if (steps[s.key] === 'existing') {
      info('step_existing', `${stepLabel(s, type)} is set to "Already exists": it is looked up on Sportagon by ${s.foundBy}, and the run stops if it is not there.`);
    }
  }
  if (steps.people === 'skip' && steps.squads !== 'skip') {
    warn('squads_without_people', 'People is set to Skip, so squads are set up with no players. Set Squads to Skip as well, or People to From sheet.');
  }
  if (steps.competitors === 'skip' && steps.squads === 'sheet') {
    warn('squads_need_competitors', `${stepLabel(SETUP_STEPS.find((s) => s.key === 'competitors')!, type)} is set to Skip, but every squad needs its ${competitorWord} on Sportagon. Set it to From sheet or Already exists.`);
  }
  if (steps.squads === 'skip' && steps.fixtures === 'sheet' && fixtures.some((f) => f.kind === 'knockout-rows')) {
    warn('fixtures_need_squads', 'Squads is set to Skip, but the schedule names squads. Set Squads to From sheet or Already exists, or Fixtures to Skip.');
  }

  // ======================================================================
  // BLUEPRINT
  // ======================================================================
  const includedSquads = squads.filter((s) => s.draw);
  const peopleIn = new Set(includedSquads.flatMap((s) => s.members.map((m) => m.personKey)));
  const personSpecs: SetupPersonSpec[] = persons.filter((p) => peopleIn.has(p.key)).map((p) => {
    const spec: SetupPersonSpec = { key: p.key, name: p.name };
    if (p.ids[0]) spec.memberCode = p.ids[0];
    if (p.phone) spec.phone = p.phone;
    if (p.email) spec.email = p.email;
    if (p.gender) spec.gender = p.gender;
    return spec;
  });
  const people = steps.people === 'skip' ? [] : personSpecs;
  const squadSpecs: SetupSquadSpec[] = includedSquads.map((s) => {
    const spec: SetupSquadSpec = {
      key: s.key, drawKey: s.draw!.spec.key, name: s.name, shortName: s.shortName,
      competitorKey: s.competitorKey, members: steps.people === 'skip' ? [] : s.members,
    };
    if (s.section) spec.section = s.section;
    return spec;
  });
  const finalFixtures = steps.fixtures === 'skip' ? [] : fixtures;
  const finalStaff = steps.staff === 'skip' ? [] : staff;
  const unitLabels = type === 'intra'
    ? { campus: 'Campus', department: ev.unitLabel }
    : { campus: 'Campus', department: 'Department' };
  const nameSlug = slug(ev.name) || 'event';
  const year = ev.start.slice(0, 4);
  const blueprint: EventSetupBlueprint = {
    key: year && !ev.name.includes(year) ? `${nameSlug}-${year}` : nameSlug,
    eventType: type,
    steps,
    org: { name: ev.hostOrg, shortName: ev.hostShort, unitLabels },
    campus: type === 'intra' ? { key: 'campus', name: ev.campus || ev.city || 'Main campus' } : null,
    competitors,
    people,
    staff: finalStaff,
    championship: {
      name: ev.name, startDate: ev.start, endDate: ev.end,
      entryLevel: typeInfo.entryLevel, scopeToCampus: type === 'intra',
      visibility: ev.visibility, status: 'registration_open',
      type: draws.length === 1 ? 'single_sport' : 'multi_sport',
      placement: ev.placement,
    },
    venue: { name: ev.venue, grounds: ev.grounds.map((g) => ({ key: g.key, name: g.name, type: ev.groundType })) },
    draws: draws.map((d) => d.spec),
    squads: squadSpecs,
    fixtures: finalFixtures,
    placeholder: { emailStem: slug(ev.hostShortGiven || ev.hostOrg) || nameSlug },
    findings: [],
  };
  if (ev.city) { blueprint.org.city = ev.city; blueprint.venue.city = ev.city; }

  const summary: SetupValidationSummary = {
    draws: draws.length,
    competitors: competitors.length,
    squads: squadSpecs.length,
    people: people.length,
    peopleWithMobile: people.filter((p) => p.phone).length,
    peopleOnPlaceholder: people.filter((p) => !p.phone && !p.email).length,
    peopleInSeveralSquads: steps.people === 'skip' ? 0 : persons.filter((p) => peopleIn.has(p.key) && new Set([...p.squads].filter((i) => squads[i].draw)).size > 1).length,
    staff: finalStaff.length,
    grounds: ev.grounds.length,
    matches: finalFixtures.reduce((n, f) => n + (f.kind === 'knockout-rows' ? f.rows.length : 0), 0),
    byes: steps.fixtures === 'skip' ? 0 : byes,
  };
  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues, summary, blueprint: unusable ? null : blueprint };

  // ---- helpers that close over the squads ----------------------------------
  function squadFor(draw: DrawRec, raw: string, section: string): { squad?: SquadRec; how?: 'exact' | 'prefix'; candidates?: SquadRec[] } {
    const want = looseKey(raw);
    const inDraw = squads.filter((s) => s.draw === draw);
    const one = (xs: SquadRec[]) => (xs.length === 1 ? xs[0] : undefined);
    const exact = inDraw.filter((s) => s.nameNorm === want);
    if (exact.length) return { squad: exact[0], how: 'exact' };
    const byCode = one(inDraw.filter((s) => looseKey(s.shortName) === want));
    if (byCode) return { squad: byCode, how: 'exact' };
    const byComp = one(inDraw.filter((s) => s.compNorm === want));
    if (byComp) return { squad: byComp, how: 'exact' };
    if (want.length < 3) return { candidates: [] };
    const pool = section ? inDraw.filter((s) => looseKey(s.section ?? '') === looseKey(section)) : inDraw;
    const hits = (pool.length ? pool : inDraw).filter((s) => s.nameNorm.startsWith(want));
    if (hits.length === 1) return { squad: hits[0], how: 'prefix' };
    return { candidates: hits };
  }
}

// ===========================================================================
// EVENT
// ===========================================================================
function readEvent(
  grid: unknown[][] | null, type: SetupEventType, sink: IssueSink,
  error: (code: string, message: string, where?: Where) => void,
  warn: (code: string, message: string, where?: Where) => void,
  /** The Event fields this setup needs (setupWorkbookLayout) - e.g. no venue when venue and fixtures are skipped. */
  required: ReadonlySet<string>,
): EventInfo {
  const sheet = templateSheet('Event');
  const fields = grid ? readFields(grid, sheet, type, sink) : { get: () => undefined };
  const at = (key: string): Where => ({ sheet: 'Event', row: fields.get(key)?.row, column: headerOf('Event', key) });
  const v = (key: string) => fields.get(key)?.value ?? '';

  if (grid) {
    for (const c of setupColumnsFor(sheet, type)) {
      if (!required.has(c.key)) continue;
      const f = fields.get(c.key);
      if (!f) {
        error('missing_field', `The Event sheet has no "${c.header}" row. Add a row with "${c.header}" in the Field column and its value next to it${c.hint ? ` (${c.hint})` : ''}.`, { sheet: 'Event', column: c.header });
      } else if (!f.value) {
        const example = typeof c.example === 'string' ? c.example : c.example?.[type] ?? '';
        error('missing_field', `"${c.header}" on the Event sheet is blank. Fill it in${c.hint ? ` - ${c.hint}` : '.'}${example ? ` Example: ${example}` : ''}`, at(c.key));
      }
    }
  }

  const dateOf = (key: string) => {
    const raw = v(key);
    if (!raw) return '';
    const d = parseDate(raw);
    if (!d) error('bad_date', `"${headerOf('Event', key)}" on the Event sheet reads "${raw}", which is not a date. Write it as YYYY-MM-DD, for example 2026-10-17.`, at(key));
    else if (dateIsAmbiguous(raw)) warn('ambiguous_date', ambiguousDateText(raw, d), at(key));
    return d ?? '';
  };
  const start = dateOf('start_date');
  let end = dateOf('end_date');
  if (start && end && end < start) {
    error('end_before_start', `The End date (${end}) is before the Start date (${start}) on the Event sheet. Swap or correct them.`, at('end_date'));
  }
  if (start && !end) end = start;

  const days = new Map<number, string>();
  const dayRaw = v('day_dates');
  if (dayRaw) {
    for (const part of dayRaw.split(/;|,(?=\s*day\s*\d)|\s+(?=day\s*\d)/i).map(tidy).filter(Boolean)) {
      const m = part.match(/^day\s*(\d+)\s*(?:=|:|–|-|-(?=\s))\s*(.+)$/i);
      const date = m ? parseDate(m[2]) : null;
      if (!m || !date) {
        error('bad_day_dates', `Day dates on the Event sheet has "${part}", which could not be read. Write each day as Day 1=2026-10-17, separated by semicolons.`, at('day_dates'));
        continue;
      }
      if (dateIsAmbiguous(m[2])) warn('ambiguous_date', ambiguousDateText(tidy(m[2]), date), at('day_dates'));
      const n = Number(m[1]);
      if (days.has(n) && days.get(n) !== date) {
        error('bad_day_dates', `Day dates gives Day ${n} two dates (${days.get(n)} and ${date}). Keep one.`, at('day_dates'));
        continue;
      }
      days.set(n, date);
      if (start && end && (date < start || date > end)) {
        warn('day_outside_event', `Day ${n} is ${date}, outside the event's dates (${start} to ${end}). Check Day dates, or the Start and End dates.`, at('day_dates'));
      }
    }
  }

  const grounds: Ground[] = [];
  const groundsRaw = v('grounds');
  if (groundsRaw) {
    for (const nm of groundsRaw.split(/[,;]+/).map(tidy).filter(Boolean)) {
      const norm = looseKey(nm);
      if (grounds.some((g) => g.norm === norm)) {
        warn('duplicate_ground', `"${nm}" is listed twice in Grounds on the Event sheet; it is used once. If you meant two different grounds, give them different names.`, at('grounds'));
        continue;
      }
      grounds.push({ key: `g${grounds.length + 1}`, name: nm, norm });
    }
    if (!grounds.length) {
      error('missing_field', `Grounds on the Event sheet ("${groundsRaw}") names no ground. List the pitches or courts, comma separated: Turf 1, Turf 2.`, at('grounds'));
    }
  }

  const allowedOf = (key: string, fallback: string) => {
    const raw = v(key);
    if (!raw) return fallback;
    const col = sheet.columns.find((c) => c.key === key)!;
    const hit = col.allowed?.find((a) => a.toLowerCase() === raw.toLowerCase());
    if (!hit) {
      error('bad_value', `"${col.header}" on the Event sheet is "${raw}". It must be one of: ${col.allowed?.join(', ')}.`, at(key));
      return fallback;
    }
    return hit;
  };
  const groundType = allowedOf('ground_type', 'field') as GroundType;
  const visibility = allowedOf('visibility', 'public') as 'public' | 'private';

  const points = (key: string, fallback: number) => {
    const raw = v(key);
    if (!raw) return fallback;
    const n = parseAmount(raw);
    if (n === null) {
      error('bad_number', `"${headerOf('Event', key)}" on the Event sheet is "${raw}", which is not a number of 0 or more. Write a number like ${fallback}, or leave it blank for ${fallback}.`, at(key));
      return fallback;
    }
    return n;
  };

  const hostOrg = tidy(v('host_org'));
  const shortGiven = tidy(v('host_short'));
  let hostShort = shortGiven;
  if (hostShort.length > 12) {
    hostShort = hostShort.slice(0, 12).trim();
    warn('short_name_too_long', `Host short name "${shortGiven}" is longer than 12 characters; it is cut to "${hostShort}". Write a shorter one to choose it yourself.`, at('host_short'));
  }
  if (!hostShort) hostShort = orgShortName(hostOrg);

  return {
    name: tidy(v('event_name')), hostOrg, hostShort, hostShortGiven: shortGiven ? hostShort : '',
    city: tidy(v('city')) || undefined,
    campus: type === 'intra' ? tidy(v('campus')) || undefined : undefined,
    unitLabel: (type === 'intra' && tidy(v('unit_label'))) || 'Batch',
    start, end, days, venue: tidy(v('venue')), grounds, groundType, visibility,
    placement: {
      winner: points('points_winner', 10), runner_up: points('points_runner_up', 7),
      semi_finalist: points('points_semi', 4), participation: points('points_participation', 1),
    },
  };
}

// ===========================================================================
// DRAWS
// ===========================================================================
function readDraws(
  t: TableRead, draws: DrawRec[],
  say: Record<'error' | 'warn' | 'info', (code: string, message: string, where?: Where) => void>,
) {
  if (t.missing.length) return;
  const { error, info } = say;
  const seen = new Map<string, DrawRec>();
  for (const r of t.rows) {
    const sport = tidy(r.get('sport'));
    const disc = tidy(r.get('discipline'));
    if (!sport || !disc) {
      error('missing_value', `Draws row ${r.row} has no ${!sport ? 'Sport' : 'Discipline'}. Every draw needs both (Football / Mixed).`, { sheet: 'Draws', row: r.row, column: !sport ? 'Sport' : 'Discipline' });
      continue;
    }
    const label = `${sport} / ${disc}`;
    const norm = `${looseKey(sport)}|${looseKey(disc)}`;
    const had = seen.get(norm);
    if (had) {
      error('duplicate_draw', `${label} is on Draws twice (rows ${had.row} and ${r.row}). Keep one row per sport and discipline; this row is ignored.`, { sheet: 'Draws', row: r.row, column: 'Discipline' });
      continue;
    }
    const at = (column: string): Where => ({ sheet: 'Draws', row: r.row, column });

    const formatRaw = r.get('format');
    let format: SetupDrawFormat = 'Knockout';
    if (!formatRaw) {
      error('missing_value', `${label} (Draws row ${r.row}) has no Format. Write Knockout, League or Groups+Knockout.`, at('Format'));
    } else {
      const f = drawFormat(formatRaw);
      if (!f) error('bad_value', `${label} (Draws row ${r.row}): Format "${formatRaw}" is not Knockout, League or Groups+Knockout.`, at('Format'));
      else format = f;
    }

    const whole = (key: string, column: string, positive: boolean): number | undefined => {
      const raw = r.get(key);
      if (!raw) return undefined;
      const n = parseWhole(raw);
      if (n === null || (positive && n === 0)) {
        error('bad_number', `${label} (Draws row ${r.row}): ${column} is "${raw}", which is not a whole number${positive ? ' above 0' : ''}. Fix it or leave it blank.`, at(column));
        return undefined;
      }
      return n;
    };
    const squadMin = whole('squad_min', 'Squad min', true);
    const squadMax = whole('squad_max', 'Squad max', true);
    if (squadMin !== undefined && squadMax !== undefined && squadMin > squadMax) {
      error('squad_min_over_max', `${label} (Draws row ${r.row}): Squad min (${squadMin}) is more than Squad max (${squadMax}). Swap or correct them.`, at('Squad min'));
    }
    const minutes = whole('match_minutes', 'Match minutes', true);
    const extra = whole('extra_time_minutes', 'Extra time minutes', false);
    const pens = whole('penalty_kicks', 'Penalty kicks', false);
    let thirdPlace = false;
    const tpRaw = r.get('third_place');
    if (tpRaw) {
      const yn = parseYesNo(tpRaw);
      if (yn === null) error('bad_value', `${label} (Draws row ${r.row}): Third-place match is "${tpRaw}". Write Yes or No.`, at('Third-place match'));
      else thirdPlace = yn;
    }

    const spec: SetupDrawSpec = {
      key: `d${draws.length + 1}`, sport, discipline: disc, format,
      squadMin: squadMin ?? 1, squadMax: squadMax ?? squadMin ?? 1, thirdPlace,
    };
    const presetRaw = r.get('scoring_preset');
    const isFootball = looseKey(sport) === 'football';
    const presetKey = presetRaw || (isFootball ? (format === 'League' ? FOOTBALL_LEAGUE_PRESET : FOOTBALL_KNOCKOUT_PRESET) : '');
    if (presetKey) {
      const preset = matchPresetByKey(presetKey);
      if (!preset) {
        error('unknown_preset', `${label} (Draws row ${r.row}): Scoring preset "${presetRaw}" is not a Sportagon preset. Leave it blank for the sport's default, or ask the Sportagon team for the right key.`, at('Scoring preset'));
      } else if (looseKey(preset.sport) !== looseKey(sport)) {
        error('preset_wrong_sport', `${label} (Draws row ${r.row}): Scoring preset "${presetKey}" is for ${preset.sport}, not ${sport}. Use a ${sport} preset or leave it blank.`, at('Scoring preset'));
      } else {
        const bits = [minutes ? `${minutes} min` : '', extra ? `${extra} min extra time` : '', pens ? 'penalties' : ''].filter(Boolean);
        spec.scoring = { presetKey, name: `${sport} ${disc} - ${bits.length ? bits.join(', ') : preset.name}` };
        if (minutes !== undefined) spec.scoring.matchMinutes = minutes;
        if (extra !== undefined) spec.scoring.extraTimeMinutes = extra;
        if (pens !== undefined) spec.scoring.penaltyKicks = pens;
        if (!presetRaw && format === 'Groups+Knockout') {
          info('default_preset_knockout', `${label}: with no Scoring preset, every match uses the knockout format ${presetKey}, so group matches cannot end level either. Set a Scoring preset if group matches may be drawn.`, at('Scoring preset'));
        }
      }
    } else if (minutes !== undefined || extra !== undefined || pens !== undefined) {
      info('timing_without_preset', `${label}: Match minutes, extra time and penalties only time the schedule here - the scoring format is ${sport}'s default. Set a Scoring preset to change how matches are scored.`, at('Scoring preset'));
    }

    const rec: DrawRec = {
      spec, row: r.row, label, sportNorm: looseKey(sport), discNorm: looseKey(disc),
      minGiven: squadMin !== undefined, maxGiven: squadMax !== undefined,
    };
    if (minutes !== undefined) rec.minutes = minutes;
    seen.set(norm, rec);
    draws.push(rec);
  }
}

function drawFormat(raw: string): SetupDrawFormat | null {
  const k = looseKey(raw);
  if (['knockout', 'ko', 'singleelimination', 'elimination'].includes(k)) return 'Knockout';
  if (['league', 'roundrobin', 'rr'].includes(k)) return 'League';
  if (['groupsknockout', 'groupknockout', 'groupsko', 'groupko', 'groupsandknockout', 'groupandknockout', 'poolsknockout', 'poolknockout'].includes(k)) return 'Groups+Knockout';
  return null;
}

// ===========================================================================
// shared helpers
// ===========================================================================
function resolveSteps(type: SetupEventType, given: unknown): SetupSteps {
  const steps = { ...SETUP_DEFAULT_STEPS[type] };
  if (given && typeof given === 'object') {
    for (const k of SETUP_STEP_KEYS) {
      const mode = (given as Record<string, unknown>)[k];
      if (typeof mode === 'string' && (SETUP_STEP_MODES as readonly string[]).includes(mode)) steps[k] = mode as SetupSteps[typeof k];
    }
  }
  return steps;
}

function headerOf(sheet: SetupSheetName, key: string): string {
  return templateSheet(sheet).columns.find((c) => c.key === key)?.header ?? key;
}

/** Squads columns the template does not list: Player 13, Substitute 5, Player 2 mobile / ID / email. */
function squadExtraColumn(hk: string): string | null {
  const m = hk.match(/^(player|playername|substituteplayer|substitute|sub)(\d{1,2})(name|mobile|mobileno|mobilenumber|phone|phoneno|phonenumber|contact|contactno|id|uid|empid|employeeid|memberid|email|emailid|mail)?$/);
  if (!m) return null;
  const slot = m[1].startsWith('sub') ? 'substitute' : 'player';
  const n = Number(m[2]);
  if (n < 1) return null;
  const f = m[3] ?? '';
  const field = !f || f === 'name' ? '' : /mobile|phone|contact/.test(f) ? 'mobile' : /mail/.test(f) ? 'email' : 'id';
  return field ? `${slot}_${n}_${field}` : `${slot}_${n}`;
}

function slotHeader(key: string): string {
  const m = key.match(/^(player|substitute)_(\d+)$/)!;
  return `${m[1] === 'player' ? 'Player' : 'Substitute'} ${m[2]}`;
}

function staffRole(raw: string): { label: string; eventRole?: SetupStaffSpec['eventRole']; orgRole?: SetupStaffSpec['orgRole'] } | null {
  const k = looseKey(raw);
  if (['organiser', 'organizer', 'eventorganiser', 'eventorganizer', 'organisers', 'organizers'].includes(k)) return { label: 'organiser', eventRole: 'organiser' };
  if (['official', 'referee', 'umpire', 'scorer', 'matchofficial', 'ref'].includes(k)) return { label: 'official', eventRole: 'official' };
  if (['poc', 'pointofcontact', 'spoc'].includes(k)) return { label: 'poc', eventRole: 'poc' };
  if (['orgowner', 'owner', 'organisationowner', 'organizationowner'].includes(k)) return { label: 'owner', orgRole: 'owner', eventRole: 'organiser' };
  if (['orgadmin', 'admin', 'organisationadmin', 'organizationadmin'].includes(k)) return { label: 'admin', orgRole: 'admin' };
  return null;
}

function groundFor(grounds: Ground[], raw: string): Ground | undefined {
  const want = looseKey(raw);
  const exact = grounds.find((g) => g.norm === want);
  if (exact) return exact;
  if (/^\d+$/.test(tidy(raw))) {
    const n = tidy(raw);
    const hits = grounds.filter((g) => new RegExp(`(?:^|\\D)${n}$`).test(g.name));
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

function absMinutes(date: string, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 60_000 + minutes;
}

function isComplete(x: SchedRow): boolean {
  return !!x.matchId && x.date !== undefined && x.start !== undefined && x.minutes !== undefined
    && !!x.ground && x.sides.every((s) => s !== null);
}

function toMatchRow(x: SchedRow): SetupMatchRowSpec {
  return {
    matchId: x.matchId, date: x.date ?? '', kickoff: x.start === undefined ? '' : clock(x.start),
    minutes: x.minutes ?? 0, groundKey: x.ground?.key ?? '',
    home: x.sides[0] ?? { squadKey: '' }, away: x.sides[1] ?? { squadKey: '' },
  };
}

/** A contact on several different people is nobody's: it is dropped from all of them. */
function resolveShared(
  what: 'mobile' | 'email', persons: PersonRec[], get: (p: PersonRec) => Contact<string>[],
  show: (v: string) => string, warn: (code: string, message: string, where?: Where) => void,
) {
  const owners = new Map<string, PersonRec[]>();
  for (const p of persons) {
    for (const v of new Set(get(p).map((c) => c.value))) owners.set(v, [...(owners.get(v) ?? []), p]);
  }
  for (const [value, ps] of owners) {
    if (ps.length < 2) continue;
    const first = get(ps[0]).find((c) => c.value === value)!;
    const where = ps.map((p) => `${p.name} (${get(p).find((c) => c.value === value)!.where})`);
    warn(what === 'mobile' ? 'shared_mobile' : 'shared_email', `The ${what} ${show(value)} is given for ${ps.length} different people: ${list(where, 6)}. A shared ${what} is usually a coordinator's, so it is used for none of them and they get placeholders. Give each person their own ${what}, or leave it blank.`, { sheet: first.sheet, row: first.row, column: first.column });
    for (const p of ps) {
      const arr = get(p);
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].value === value) arr.splice(i, 1);
    }
  }
}

/** One person, two different contacts: the first (Squads before People) is used. */
function pickOne(
  what: 'mobile' | 'email', p: PersonRec, cs: Contact<string>[], show: (v: string) => string,
  warn: (code: string, message: string, where?: Where) => void,
): string | undefined {
  if (!cs.length) return undefined;
  const distinct = cs.filter((c, i) => cs.findIndex((d) => d.value === c.value) === i);
  if (distinct.length > 1) {
    const second = distinct[1];
    warn(what === 'mobile' ? 'conflicting_mobile' : 'conflicting_email', `${p.name} has ${distinct.length} different ${what}s: ${distinct.map((c) => `${show(c.value)} (${c.where})`).join(', ')}. The first is used. Keep one ${what} per person.`, { sheet: second.sheet, row: second.row, column: second.column });
  }
  return distinct[0].value;
}
