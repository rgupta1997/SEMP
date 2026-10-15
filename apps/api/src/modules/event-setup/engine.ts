/*
 * THE EVENT SETUP ENGINE — turns an EventSetupBlueprint into rows, step by step.
 *
 * It knows nothing about any sheet (the standard template's validator, or a
 * per-client adapter, made the blueprint) and makes no judgement calls about the
 * data. What it decides is HOW each thing is written, the way the product writes it:
 *
 *   intra   squads belong to a batch (`teams.org_unit_id`), `entry_level` department,
 *           the batch is invited, one hidden host entry row carries every entry;
 *   campus  the same, one level up: the competitor is a campus of the host;
 *   inter   each competing organisation is its own `organizations` row with an
 *           approved `championship_organizations` entry, its POC owns it, and its
 *           squads are its own teams.
 *
 * The bracket is the product's own manual-knockout (or format) generator; byes
 * advance through `propagateByes`; match numbers come from `assignMatchNos`.
 *
 * THREE RULES
 *
 * 1. FIND BEFORE CREATE. `resolvePlatform` looks everything up first - by the
 *    manifest key from a previous run, then by name / member code / phone / email -
 *    in one batched query per table, and `apply` creates only what it did not find.
 *    Plan and apply share that one resolution, so the counts a plan shows are the
 *    counts an apply makes. Run it twice and the second run changes nothing.
 * 2. RECORD WHAT IT CREATES, AND ONLY THAT. The manifest maps logical keys to ids
 *    and lists every row this engine inserted. Cleanup deletes exactly those, and
 *    refuses once a match has been played. Where the manifest lives is the caller's
 *    (a file for the CLI, the event_setups row for the API) - see ManifestStore.
 * 3. A PLAN BEFORE AN APPLY. `planPlatform` resolves everything read-only and says
 *    what would be found, created, or is missing; `applyBlueprint` does it.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma as PrismaNS } from '@prisma/client';
import {
  SETUP_STEP_KEYS, SETUP_STEPS, KnockoutSheetError, knockoutFromRows, matchFormatSchema, matchPresetByKey,
  isCricketFormat, orgIdPrefix, placeholderEmail, placeholderPhone, stepLabel, tieTemplateFor,
  type EventSetupBlueprint, type ScoringFormat, type KnockoutLayout, type MatchFormat, type SetupCompetitorSpec, type SetupDrawSpec,
  type SetupFixtureSpec, type SetupIssue, type SetupMatchSide, type SetupPlatformStep, type SetupStepKey,
  type SetupStepMode,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { equalsIgnoreCase, inIgnoreCase } from '../../shared/exact-ci.js';
import { generateFixtures, type GeneratedFixture } from '../fixtures/domain/generators/index.js';
import { generateManualKnockout, type ManualKnockoutFixture } from '../fixtures/domain/generators/manual-knockout.js';
import { computeParentPosition, propagateByes } from '../fixtures/bracket.js';
import { assignMatchNos } from '../fixtures/match-no.js';
import { mintSportagonIds } from '../iam/sportagon-id.js';
import { deriveProvisionedPassword, findUsersByPhones, phoneLast10 } from '../iam/users.helpers.js';

// ===========================================================================
// manifest
// ===========================================================================
export interface Manifest {
  /** logical key ('org', 'person:<key>', 'team:<key>', …) -> id */
  keys: Record<string, string>;
  /** table -> ids of the rows this engine inserted */
  created: Record<string, string[]>;
  runs: Array<{ at: string; mode: string }>;
}

/** Where a manifest lives. The CLI keeps a JSON file; the API keeps the event_setups row. */
export interface ManifestStore {
  load(): Promise<Manifest>;
  save(m: Manifest): Promise<void>;
}

export const emptyManifest = (): Manifest => ({ keys: {}, created: {}, runs: [] });

/** Any stored manifest (including the `{}` column default) as a full one. */
export function normaliseManifest(raw: unknown): Manifest {
  const m = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Partial<Manifest>;
  return {
    keys: { ...(m.keys ?? {}) },
    created: Object.fromEntries(Object.entries(m.created ?? {}).map(([t, ids]) => [t, [...(ids ?? [])]])),
    runs: [...(m.runs ?? [])],
  };
}

/** How many rows a manifest says this engine inserted. */
export const createdCount = (m: Manifest) => Object.values(m.created).reduce((n, ids) => n + ids.length, 0);

/**
 * The table a manifest key points into. The prefixes are the ones the WNS build
 * wrote (`unit:` for a batch or campus competitor), plus `competitor:` for an
 * organisation that competes in an inter event.
 */
export function tableOfKey(key: string): string | null {
  if (key === 'org') return 'organizations';
  if (key === 'campus') return 'org_units';
  if (key === 'championship') return 'championships';
  if (key === 'venue') return 'venues';
  const prefix = key.split(':')[0];
  return ({
    unit: 'org_units', competitor: 'organizations', person: 'users', staff: 'users',
    ground: 'venue_grounds', draw: 'tournament_disciplines', team: 'teams',
  } as Record<string, string>)[prefix] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every manifest id that still exists, in ONE round trip across all its tables. */
async function liveIds(prisma: Prisma, m: Manifest): Promise<Set<string>> {
  const byTable = new Map<string, string[]>();
  for (const [key, id] of Object.entries(m.keys)) {
    const table = tableOfKey(key);
    if (!table || !UUID_RE.test(id)) continue;
    byTable.set(table, [...(byTable.get(table) ?? []), id]);
  }
  if (!byTable.size) return new Set();
  // Table names come from tableOfKey's fixed list, never from input.
  const parts = [...byTable].map(([table, ids]) =>
    PrismaNS.sql`select id::text as id from ${PrismaNS.raw(table)} where id = any(${ids}::uuid[])`);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(PrismaNS.join(parts, ' union all '));
  return new Set(rows.map((r) => r.id));
}

// ===========================================================================
// pure helpers
// ===========================================================================
const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
export const firstName = (n: string) => lc(n).split(/\s+/)[0] ?? '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** The first of `base`, `base-2`, `base-3`… not in `taken` (compared case-insensitively). */
export function firstFree(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`.toLowerCase())) return `${base}-${n}`;
}
const candidates = (base: string, n = 40) => [base, ...Array.from({ length: n }, (_, i) => `${base}-${i + 2}`)];

export const slugOf = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';

/** A short org code from a name: "Beta Industries" -> BI, "Acme" -> ACME. */
export function orgCodeOf(name: string, code?: string): string {
  if (code?.trim()) return code.trim().toUpperCase().replace(/\s+/g, '').slice(0, 12);
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 6).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 6).toUpperCase() || 'ORG';
}

/**
 * The org-saved scoring format for a draw: a catalogue preset with the clock set to
 * the WHOLE match (`matchMinutes`, which the console divides by the periods) and the
 * tie-break built from the sheet's extra time and penalties (blank = none). Validated
 * with the product's own schema, so a format that would not save is caught here.
 */
export function buildDrawScoringFormat(
  bpKey: string,
  d: Pick<SetupDrawSpec, 'key' | 'sport' | 'scoring'>,
): { format: MatchFormat; notes: string[] } | { error: string; code: 'unknown_preset' | 'preset_sport_mismatch' | 'bad_scoring' } {
  const s = d.scoring;
  if (!s) return { error: 'no scoring', code: 'bad_scoring' };
  const base = matchPresetByKey(s.presetKey);
  if (!base) return { code: 'unknown_preset', error: `Scoring preset "${s.presetKey}" is not in the catalogue` };
  if (lc(base.sport) !== lc(d.sport)) {
    return { code: 'preset_sport_mismatch', error: `Scoring preset "${s.presetKey}" is a ${base.sport} format, but the draw is ${d.sport}` };
  }
  const notes: string[] = [];
  let format: MatchFormat;
  if (isCricketFormat(base)) {
    format = { ...base, presetKey: `${bpKey}_${d.key}`, name: s.name };
    if (s.matchMinutes || s.extraTimeMinutes || s.penaltyKicks) notes.push(`${d.sport}: match minutes, extra time and penalties do not apply to a cricket format`);
  } else {
    const rally: ScoringFormat = base;
    const periods = Math.max(1, rally.levels[rally.levels.length - 1]?.target ?? 1);
    const clock = s.matchMinutes
      ? (rally.clock
        ? { ...rally.clock, minutes: s.matchMinutes }
        : { scope: 'match' as const, minutes: s.matchMinutes, action: 'leaderWins' as const, tieRule: 'organiserDecides' as const, warningSeconds: 120, pauseOnStoppage: false })
      : rally.clock;
    const minutes = clock?.minutes;
    format = {
      ...rally,
      presetKey: `${bpKey}_${d.key}`,
      name: s.name,
      clock,
      tieBreak: s.extraTimeMinutes || s.penaltyKicks
        ? {
          ...(s.extraTimeMinutes ? { extraTime: { periods: 1, minutes: s.extraTimeMinutes } } : {}),
          ...(s.penaltyKicks ? { penalties: { kicks: s.penaltyKicks } } : {}),
        }
        : null,
      rulesSheet: {
        ...(rally.rulesSheet ?? {}),
        ...(minutes ? { duration: periods > 1 ? `${periods} periods of ${minutes / periods} minutes` : `${minutes} minutes` } : {}),
        ...(s.extraTimeMinutes ? { extraTime: `one period of ${s.extraTimeMinutes} minutes, played out` } : { extraTime: 'none' }),
        ...(s.penaltyKicks ? { shootOut: `${s.penaltyKicks} kicks each, then sudden death` } : { shootOut: 'none' }),
      },
    } as MatchFormat;
  }
  const parsed = matchFormatSchema.safeParse(format);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { code: 'bad_scoring', error: `The ${d.sport} scoring format does not validate: ${i?.path.join('.')} ${i?.message}` };
  }
  return { format, notes };
}

/** What a draw's `format_config.scoring` is: a tie sport's template, else one detailed contest. */
const drawScoringTemplate = (sport: string) =>
  tieTemplateFor(sport) ?? { fixtureType: 'single', scoringMode: 'detailed' };

export type ContactKind = 'real mobile' | 'real email' | 'placeholder';
export interface CredentialRow {
  name: string;
  role: string;
  contact: ContactKind;
  phone: string;
  email: string;
  /** Null for a placeholder: nobody can sign in to it until its contact is replaced. */
  password: string | null;
}

/**
 * The login a new account is given. A real mobile gets the product's provisioned
 * pattern (firstname@last4, what an imported player is told). Anything else gets a
 * random one: the pattern over a guessable placeholder number would be a guessable
 * password, and the shared default would be one too.
 */
export function provisionalLogin(name: string, phone: string | undefined, email: string | undefined): { contact: ContactKind; password: string } {
  if (phone) return { contact: 'real mobile', password: deriveProvisionedPassword(name, phone) };
  return { contact: email ? 'real email' : 'placeholder', password: randomBytes(9).toString('base64url') };
}

/** What is safe to keep on the setup row: a password only where the login is reachable. */
export const storableCredential = (c: CredentialRow): CredentialRow =>
  ({ ...c, password: c.contact === 'placeholder' ? null : c.password });

/** The fixture rows a knockout sheet becomes, with no database: shared by plan and apply. */
export function knockoutFixturesOf(f: Extract<SetupFixtureSpec, { kind: 'knockout-rows' }>, thirdPlace: boolean):
  { layout: KnockoutLayout; gen: ManualKnockoutFixture[]; realCount: number } {
  const layout = knockoutFromRows(f.rows);
  const gen = generateManualKnockout(layout.pairs, { thirdPlaceMatch: thirdPlace });
  const realCount = gen.filter((g) => g.status !== 'bye' && g.bracketPosition != null).length;
  if (realCount !== f.rows.length) {
    throw new KnockoutSheetError(`The bracket has ${realCount} matches but the sheet lists ${f.rows.length}`);
  }
  return { layout, gen, realCount };
}

/** The generator run for a 'generate' spec, squads in blueprint order. */
export function generatedFixturesOf(formatName: string, squadTokens: string[], thirdPlace: boolean): GeneratedFixture[] {
  return generateFixtures(formatName, squadTokens.map((teamId) => ({ teamId })), { thirdPlaceMatch: thirdPlace });
}

// ===========================================================================
// resolution — what is already on the platform, in one batched pass
// ===========================================================================
interface StepNeed {
  mode: SetupStepMode;
  found: number;
  create: number;
  missing: number;
  /** Not found under 'skip': left alone by this run. */
  absent: number;
  notes: string[];
  missingNames: string[];
}

export interface DrawResolution {
  sportId: string | null;
  disciplineId: string | null;
  formatId: string | null;
  scoring: MatchFormat | null;
  scoringFormatId: string | null;
  tsId: string | null;
  drawId: string | null;
}

export interface Resolution {
  steps: Record<SetupStepKey, StepNeed>;
  /** Platform issues: things the sheet can be right about and the platform still refuse. */
  issues: SetupIssue[];
  roles: Map<string, string>;
  org: { id: string | null; activePlan: string | null };
  campusId: string | null;
  /** competitor key -> org_unit id (department / campus) or organization id (inter). Found only. */
  competitorIds: Map<string, string>;
  personIds: Map<string, string>;
  staffIds: Map<string, string>;
  /** staff key -> person key, where a staff member is also a player on the sheet (same email). */
  staffIsPerson: Map<string, string>;
  champ: { id: string | null; tournamentId: string | null; coByOrg: Map<string, string> };
  venueId: string | null;
  groundIds: Map<string, string>;
  draws: Map<string, DrawResolution>;
  teamIds: Map<string, string>;
  /** draw key -> fixtures already on it */
  fixturesOnDraw: Map<string, number>;
}

const STEP_INFO = new Map(SETUP_STEPS.map((s) => [s.key, s]));

export async function resolvePlatform(prisma: Prisma, bp: EventSetupBlueprint, manifest: Manifest): Promise<Resolution> {
  const issues: SetupIssue[] = [];
  const steps = Object.fromEntries(SETUP_STEP_KEYS.map((k) => [k, {
    mode: bp.steps[k], found: 0, create: 0, missing: 0, absent: 0, notes: [], missingNames: [],
  }])) as unknown as Record<SetupStepKey, StepNeed>;
  const issue = (severity: SetupIssue['severity'], code: string, message: string, step?: SetupStepKey) =>
    issues.push({ severity, code, message, ...(step && STEP_INFO.get(step)?.sheet ? { sheet: STEP_INFO.get(step)!.sheet } : {}) });
  /** One row the step needs, found or not. */
  const add = (step: SetupStepKey, id: string | null | undefined, what: string) => {
    const n = steps[step];
    if (id) n.found++;
    else if (n.mode === 'sheet') n.create++;
    else if (n.mode === 'existing') { n.missing++; n.missingNames.push(what); }
    else n.absent++;
  };
  const used = (s: SetupStepKey) => bp.steps[s] !== 'skip';
  const inter = bp.eventType === 'inter';

  const competitorOf = new Map(bp.competitors.map((c) => [c.key, c]));
  const drawOf = new Map(bp.draws.map((d) => [d.key, d]));
  const orgCompetitors = bp.competitors.filter((c) => c.kind === 'organization');
  const sportNames = uniq(bp.draws.map((d) => d.sport.trim()));
  const emails = uniq([
    ...bp.people.map((p) => p.email), ...bp.staff.flatMap((s) => [s.existingEmail, s.email]),
  ].filter((e): e is string => !!e?.trim()).map(lc));
  const phones = [...bp.people.map((p) => p.phone), ...bp.staff.map((s) => s.phone)];

  // ---- round 1: nothing depends on anything ---------------------------------
  const [live, roles, formats, sports, hostByName, compOrgs, emailUsers, phoneUsers] = await Promise.all([
    liveIds(prisma, manifest),
    prisma.roles.findMany({ where: { organization_id: null }, select: { id: true, code: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    sportNames.length
      ? prisma.sports.findMany({ where: { name: inIgnoreCase(sportNames) }, select: { id: true, name: true } })
      : Promise.resolve([]),
    prisma.organizations.findFirst({
      where: { name: equalsIgnoreCase(bp.org.name), archived_at: null }, select: { id: true }, orderBy: { created_at: 'asc' },
    }),
    orgCompetitors.length
      ? prisma.organizations.findMany({
        where: { name: inIgnoreCase(uniq(orgCompetitors.map((c) => c.name.trim()))), archived_at: null },
        select: { id: true, name: true }, orderBy: { created_at: 'asc' },
      })
      : Promise.resolve([]),
    emails.length
      ? prisma.$queryRaw<Array<{ id: string; email: string; name: string }>>(PrismaNS.sql`
          select id::text as id, lower(email) as email, name from users where lower(email) = any(${emails}::text[])`)
      : Promise.resolve([]),
    findUsersByPhones(prisma, phones),
  ]);
  const kept = (key: string) => { const id = manifest.keys[key]; return id && live.has(id) ? id : null; };
  const roleIds = new Map(roles.flatMap((r) => (r.code ? [[r.code, r.id] as const] : [])));
  const formatByName = new Map(formats.map((f) => [lc(f.name), f.id]));
  const sportByName = new Map(sports.map((s) => [lc(s.name), s.id]));
  const userByEmail = new Map(emailUsers.map((u) => [u.email, u.id]));
  const byPhoneAndName = (phone: string | undefined, name: string) => {
    const hit = phone ? phoneUsers.get(phoneLast10(phone)) : undefined;
    return hit && firstName(hit.name) === firstName(name) ? hit.id : null;
  };

  // ---- org ---------------------------------------------------------------------
  const orgId = kept('org') ?? hostByName?.id ?? null;
  add('org', orgId, bp.org.name);
  steps.org.notes.push(orgId ? `found "${bp.org.name}"` : `"${bp.org.name}" is new`);
  if (!orgId && bp.steps.org === 'skip') {
    issue('error', 'needed_but_skipped', `Host organisation "${bp.org.name}" is not on the platform, and the step is skipped — every other step hangs off it`, 'org');
  }

  // ---- competitors: organisations (inter) -------------------------------------
  const competitorIds = new Map<string, string>();
  const compOrgByName = new Map<string, string>();
  for (const o of compOrgs) if (!compOrgByName.has(lc(o.name))) compOrgByName.set(lc(o.name), o.id);
  for (const c of orgCompetitors) {
    const isHost = lc(c.name) === lc(bp.org.name);
    const id = kept(`competitor:${c.key}`) ?? compOrgByName.get(lc(c.name)) ?? (isHost ? orgId : null);
    if (id) competitorIds.set(c.key, id);
  }
  const allOrgIds = uniq([orgId, ...competitorIds.values()].filter((x): x is string => !!x));

  // ---- round 2: under the host ---------------------------------------------------
  const codes = uniq(bp.people.map((p) => lc(p.memberCode)).filter(Boolean));
  const scoringNames = uniq(bp.draws.flatMap((d) => (d.scoring ? [d.scoring.name.trim()] : [])));
  const [sub, campusUnits, champByName, codeRows, scoringRows] = await Promise.all([
    orgId && bp.org.plan && bp.org.plan !== 'free'
      ? prisma.subscriptions.findFirst({ where: { organization_id: orgId, status: 'active' }, select: { plan: true } })
      : Promise.resolve(null),
    orgId
      ? prisma.org_units.findMany({ where: { organization_id: orgId, parent_id: null, type: 'campus' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    orgId
      ? prisma.championships.findFirst({ where: { host_organization_id: orgId, name: equalsIgnoreCase(bp.championship.name) }, select: { id: true } })
      : Promise.resolve(null),
    allOrgIds.length && codes.length
      ? prisma.$queryRaw<Array<{ organization_id: string; user_id: string; code: string }>>(PrismaNS.sql`
          select organization_id::text as organization_id, user_id::text as user_id, lower(member_code) as code
            from organization_members
           where organization_id = any(${allOrgIds}::uuid[]) and lower(member_code) = any(${codes}::text[])`)
      : Promise.resolve([]),
    orgId && scoringNames.length
      ? prisma.scoring_formats.findMany({ where: { organization_id: orgId, name: inIgnoreCase(scoringNames) }, select: { id: true, sport_id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const activePlan = sub?.plan ?? null;
  if (bp.org.plan && bp.org.plan !== 'free') {
    steps.org.notes.push(activePlan ? `already on plan ${activePlan}` : `plan ${bp.org.plan} to grant (annual, no charge)`);
  }

  // ---- campus --------------------------------------------------------------------
  let campusId: string | null = null;
  if (bp.campus) {
    campusId = kept('campus') ?? campusUnits.find((u) => lc(u.name) === lc(bp.campus!.name))?.id ?? null;
    add('campus', campusId, bp.campus.name);
  } else {
    steps.campus.notes.push(inter ? 'no campus: organisations compete' : 'no campus for this event type');
  }
  const deptCompetitors = bp.competitors.filter((c) => c.kind === 'department');
  if (deptCompetitors.length && !bp.campus) {
    issue('error', 'no_campus', 'Batches / departments compete, but the event names no campus to put them under', 'campus');
  } else if (deptCompetitors.length && !campusId && bp.steps.campus === 'skip') {
    issue('error', 'needed_but_skipped', `Campus "${bp.campus!.name}" is not on the platform and the step is skipped, but the batches go under it`, 'campus');
  }

  // ---- championship --------------------------------------------------------------
  const champId = kept('championship') ?? champByName?.id ?? null;
  add('championship', champId, bp.championship.name);
  const champNeeded = (['venue', 'draws', 'squads', 'fixtures'] as const).some(used);
  if (!champId && bp.steps.championship === 'skip' && champNeeded) {
    issue('error', 'needed_but_skipped', `Championship "${bp.championship.name}" is not on the platform and the step is skipped, but later steps build into it`, 'championship');
  }

  // ---- round 3: under the campus and the championship ----------------------------
  const sportIds = uniq(bp.draws.map((d) => sportByName.get(lc(d.sport))).filter((x): x is string => !!x));
  const [deptUnits, tournament, cos, venueByName, disciplines] = await Promise.all([
    orgId && campusId && deptCompetitors.length
      ? prisma.org_units.findMany({ where: { organization_id: orgId, parent_id: campusId, type: 'department' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    champId ? prisma.tournaments.findFirst({ where: { championship_id: champId }, select: { id: true } }) : Promise.resolve(null),
    champId
      ? prisma.championship_organizations.findMany({ where: { championship_id: champId, org_unit_id: null }, select: { id: true, organization_id: true } })
      : Promise.resolve([]),
    champId
      ? prisma.venues.findFirst({ where: { championship_id: champId, name: equalsIgnoreCase(bp.venue.name) }, select: { id: true } })
      : Promise.resolve(null),
    sportIds.length
      ? prisma.disciplines.findMany({
        where: { sport_id: { in: sportIds }, OR: [{ championship_id: null }, ...(champId ? [{ championship_id: champId }] : [])] },
        select: { id: true, sport_id: true, name: true, championship_id: true },
      })
      : Promise.resolve([]),
  ]);

  // ---- competitors: units ----------------------------------------------------------
  const unitsByName = (rows: Array<{ id: string; name: string }>) => {
    const m = new Map<string, string>();
    for (const r of rows) if (!m.has(lc(r.name))) m.set(lc(r.name), r.id);
    return m;
  };
  const deptByName = unitsByName(deptUnits);
  const campusByName = unitsByName(campusUnits);
  for (const c of bp.competitors) {
    if (c.kind === 'department') {
      const id = kept(`unit:${c.key}`) ?? deptByName.get(lc(c.name)) ?? null;
      if (id) competitorIds.set(c.key, id);
    } else if (c.kind === 'campus') {
      const id = kept(`unit:${c.key}`) ?? campusByName.get(lc(c.name)) ?? null;
      if (id) competitorIds.set(c.key, id);
    }
    const isHost = c.kind === 'organization' && lc(c.name) === lc(bp.org.name);
    add('competitors', competitorIds.get(c.key) ?? (isHost ? 'host' : null), c.name);
  }
  if (orgCompetitors.some((c) => lc(c.name) === lc(bp.org.name))) steps.competitors.notes.push('the host organisation competes too');
  const competitorNeeded = used('squads');
  if (bp.steps.competitors === 'skip' && competitorNeeded) {
    const absent = bp.competitors.filter((c) => !competitorIds.has(c.key) && !(c.kind === 'organization' && lc(c.name) === lc(bp.org.name)));
    if (absent.length) issue('error', 'needed_but_skipped', `${plural(absent.length, 'competitor')} not on the platform and the step is skipped, but squads play for them: ${absent.slice(0, 8).map((c) => c.name).join(', ')}`, 'competitors');
  }

  // ---- people ------------------------------------------------------------------------
  const codeOwner = new Map(codeRows.map((r) => [`${r.organization_id}|${r.code}`, r.user_id]));
  const orgsOfPerson = personOrgResolver(bp, orgId, competitorIds);
  const personIds = new Map<string, string>();
  for (const p of bp.people) {
    const byCode = p.memberCode
      ? orgsOfPerson(p.key).map((o) => codeOwner.get(`${o}|${lc(p.memberCode)}`)).find(Boolean)
      : undefined;
    const id = kept(`person:${p.key}`) ?? byCode ?? byPhoneAndName(p.phone, p.name) ?? (p.email ? userByEmail.get(lc(p.email)) : undefined) ?? null;
    if (id) personIds.set(p.key, id);
    add('people', id, p.name);
  }
  {
    const mobile = bp.people.filter((p) => p.phone).length;
    const emailOnly = bp.people.filter((p) => !p.phone && p.email).length;
    const none = bp.people.length - mobile - emailOnly;
    steps.people.notes.push(`${mobile} with a real mobile${emailOnly ? `, ${emailOnly} with an email only` : ''}, ${none} on placeholders`);
  }
  const seenCode = new Map<string, string>();
  for (const p of bp.people) {
    if (!p.memberCode) continue;
    const prev = seenCode.get(lc(p.memberCode));
    if (prev && prev !== p.key) issue('error', 'duplicate_member_code', `Member ID ${p.memberCode} is given to two different people`, 'people');
    seenCode.set(lc(p.memberCode), p.key);
  }

  // ---- staff ---------------------------------------------------------------------------
  const staffIds = new Map<string, string>();
  const staffIsPerson = new Map<string, string>();
  const personByEmail = new Map(bp.people.filter((p) => p.email).map((p) => [lc(p.email), p.key]));
  for (const s of bp.staff) {
    if (s.existingEmail && !userByEmail.has(lc(s.existingEmail)) && !kept(`staff:${s.key}`)) {
      issue('error', 'not_on_platform', `Staff ${s.name}: no account with the email ${s.existingEmail}`, 'staff');
    }
    let id = kept(`staff:${s.key}`)
      ?? (s.existingEmail ? userByEmail.get(lc(s.existingEmail)) : undefined)
      ?? (s.email ? userByEmail.get(lc(s.email)) : undefined)
      ?? null;
    if (s.competitorKey && !competitorOf.has(s.competitorKey)) {
      issue('error', 'unknown_competitor', `POC ${s.name} speaks for "${s.competitorKey}", which is not a competitor on the sheet`, 'staff');
    }
    const pk = !id && s.email ? personByEmail.get(lc(s.email)) : undefined;
    if (pk && (personIds.has(pk) || bp.steps.people === 'sheet')) {
      // The same person as a player on the sheet: one account, made (or found) by the people step.
      staffIsPerson.set(s.key, pk);
      const pid = personIds.get(pk);
      if (pid) staffIds.set(s.key, pid);
      steps.staff.found++;
      continue;
    }
    id ??= byPhoneAndName(s.phone, s.name);
    if (id) staffIds.set(s.key, id);
    add('staff', id, s.name);
  }
  if (staffIsPerson.size) steps.staff.notes.push(`${plural(staffIsPerson.size, 'staff member is', 'staff members are')} also on a squad`);
  // Event roles are granted by catalogue code; a missing one would stop an apply
  // halfway, after the accounts were made - so it stops the plan instead.
  if (bp.steps.staff === 'sheet') {
    for (const code of uniq(bp.staff.flatMap((s) => (s.eventRole ? [s.eventRole] : [])))) {
      if (!roleIds.has(code)) issue('error', 'unknown_role', `The role "${code}" is not in the platform's role catalogue`, 'staff');
    }
  }
  // An inter POC is made the owner of the organisation they speak for. Of one this
  // setup creates, that is the point; of one already on the platform, it hands a
  // stranger the keys to somebody else's organisation - so it is said out loud first.
  if (inter && bp.steps.staff === 'sheet') {
    for (const s of bp.staff) {
      if (s.eventRole !== 'poc' || !s.competitorKey) continue;
      const c = competitorOf.get(s.competitorKey);
      if (c && competitorIds.has(c.key)) {
        issue('warning', 'poc_owns_existing_org', `POC ${s.name} will be made an owner of "${c.name}", which is already on the platform (left as is if they are a member already)`, 'staff');
      }
    }
  }

  // Emails are unique: two NEW accounts cannot share one, and the database would refuse the second.
  const newEmails = new Map<string, string[]>();
  for (const p of bp.people) if (!personIds.has(p.key) && p.email) newEmails.set(lc(p.email), [...(newEmails.get(lc(p.email)) ?? []), p.name]);
  for (const s of bp.staff) {
    if (staffIds.has(s.key) || staffIsPerson.has(s.key) || !s.email) continue;
    newEmails.set(lc(s.email), [...(newEmails.get(lc(s.email)) ?? []), s.name]);
  }
  for (const [email, names] of newEmails) {
    if (names.length > 1) issue('error', 'duplicate_email', `${names.join(' and ')} share the email ${email}; an email can belong to one account`, 'people');
  }

  // ---- venue -----------------------------------------------------------------------------
  const venueId = kept('venue') ?? venueByName?.id ?? null;

  // ---- round 4: grounds, tournament sports, teams ------------------------------------------
  const tournamentId = tournament?.id ?? null;
  const teamOrgIds = inter ? [...new Set([...competitorIds.values()])] : (orgId ? [orgId] : []);
  const [groundRows, tsRows, teamRows] = await Promise.all([
    venueId ? prisma.venue_grounds.findMany({ where: { venue_id: venueId }, select: { id: true, name: true } }) : Promise.resolve([]),
    tournamentId && sportIds.length
      ? prisma.tournament_sports.findMany({ where: { tournament_id: tournamentId, sport_id: { in: sportIds } }, select: { id: true, sport_id: true } })
      : Promise.resolve([]),
    teamOrgIds.length && sportIds.length
      ? prisma.teams.findMany({
        where: { organization_id: { in: teamOrgIds }, sport_id: { in: sportIds } },
        select: { id: true, organization_id: true, org_unit_id: true, sport_id: true, name: true },
      })
      : Promise.resolve([]),
  ]);
  if (used('venue')) {
    add('venue', venueId, bp.venue.name);
  }
  const groundIds = new Map<string, string>();
  const groundByName = unitsByName(groundRows);
  for (const g of bp.venue.grounds) {
    const id = kept(`ground:${g.key}`) ?? groundByName.get(lc(g.name)) ?? null;
    if (id) groundIds.set(g.key, id);
    if (used('venue')) add('venue', id, g.name);
  }

  // ---- draws --------------------------------------------------------------------------------
  const tsBySport = new Map(tsRows.map((t) => [t.sport_id, t.id]));
  const tdRows = tsRows.length
    ? await prisma.tournament_disciplines.findMany({
      where: { tournament_sport_id: { in: tsRows.map((t) => t.id) } },
      select: { id: true, tournament_sport_id: true, discipline_id: true },
    })
    : [];
  const draws = new Map<string, DrawResolution>();
  for (const d of bp.draws) {
    const sportId = sportByName.get(lc(d.sport)) ?? null;
    if (!sportId) issue('error', 'unknown_sport', `Sport "${d.sport}" is not in the Sportagon catalogue`, 'draws');
    const discs = disciplines.filter((x) => x.sport_id === sportId && lc(x.name) === lc(d.discipline));
    const disciplineId = (discs.find((x) => x.championship_id) ?? discs[0])?.id ?? null;
    const formatId = formatByName.get(lc(d.format)) ?? null;
    if (!formatId) issue('error', 'unknown_format', `Format "${d.format}" is not in the tournament formats catalogue`, 'draws');
    let scoring: MatchFormat | null = null;
    let scoringFormatId: string | null = null;
    if (d.scoring) {
      const built = buildDrawScoringFormat(bp.key, d);
      if ('error' in built) issue('error', built.code, `${d.sport} · ${d.discipline}: ${built.error}`, 'draws');
      else {
        scoring = built.format;
        steps.draws.notes.push(...built.notes);
        scoringFormatId = scoringRows.find((r) => r.sport_id === sportId && lc(r.name) === lc(d.scoring!.name))?.id ?? null;
      }
    }
    const tsId = sportId ? tsBySport.get(sportId) ?? null : null;
    const drawId = kept(`draw:${d.key}`)
      ?? (tsId && disciplineId ? tdRows.find((t) => t.tournament_sport_id === tsId && t.discipline_id === disciplineId)?.id : null)
      ?? null;
    draws.set(d.key, { sportId, disciplineId, formatId, scoring, scoringFormatId, tsId, drawId });
    if (used('draws')) add('draws', drawId, `${d.sport} · ${d.discipline}`);
    if (!drawId && used('draws')) {
      if (!disciplineId) steps.draws.notes.push(`discipline "${d.discipline}" to create for this championship only`);
      if (d.scoring && !scoringFormatId && scoring) steps.draws.notes.push(`scoring format "${d.scoring.name}" to save on the organisation`);
    }
    steps.draws.notes.push(`${d.sport} · ${d.discipline} · ${d.format}${d.scoring ? ` · ${d.scoring.name}` : ''}`);
  }
  if (bp.steps.draws === 'skip' && (used('squads') || used('fixtures'))) {
    const absent = bp.draws.filter((d) => !draws.get(d.key)?.drawId);
    if (absent.length) issue('error', 'needed_but_skipped', `${plural(absent.length, 'draw')} not on the platform and the step is skipped, but squads or fixtures go into them: ${absent.map((d) => `${d.sport} · ${d.discipline}`).join(', ')}`, 'draws');
  }

  // ---- squads ---------------------------------------------------------------------------------
  const teamByKey = new Map<string, string>();
  for (const t of teamRows) {
    const k = `${t.organization_id}|${t.org_unit_id ?? ''}|${t.sport_id}|${lc(t.name)}`;
    if (!teamByKey.has(k)) teamByKey.set(k, t.id);
  }
  const teamIds = new Map<string, string>();
  for (const s of bp.squads) {
    const c = competitorOf.get(s.competitorKey);
    const sportId = draws.get(s.drawKey)?.sportId;
    if (!c) issue('error', 'unknown_competitor', `Squad ${s.name} plays for "${s.competitorKey}", which is not a competitor`, 'squads');
    if (!drawOf.has(s.drawKey)) issue('error', 'unknown_draw', `Squad ${s.name} is in a draw that is not on the sheet`, 'squads');
    let id = kept(`team:${s.key}`);
    if (!id && c && sportId) {
      const cid = competitorIds.get(c.key);
      const owner = inter ? cid : orgId;
      const unit = inter ? '' : cid;
      if (owner && unit !== undefined) id = teamByKey.get(`${owner}|${unit}|${sportId}|${lc(s.name)}`) ?? null;
    }
    if (id) teamIds.set(s.key, id);
    if (used('squads')) add('squads', id, s.name);
  }
  if (used('squads')) {
    const places = bp.squads.reduce((n, s) => n + s.members.length, 0);
    steps.squads.notes.push(`${places} roster places, ${bp.squads.length} entries`);
    if (bp.steps.people === 'skip') {
      const out = bp.squads.flatMap((s) => s.members).filter((m) => !personIds.has(m.personKey)).length;
      if (out) issue('warning', 'roster_left_out', `${plural(out, 'roster place')} will be left out: those people are not on the platform and the People step is skipped`, 'squads');
    }
  }

  // ---- fixtures ----------------------------------------------------------------------------------
  const drawIds = uniq([...draws.values()].map((d) => d.drawId).filter((x): x is string => !!x));
  const counts = drawIds.length
    ? await prisma.fixtures.groupBy({ by: ['tournament_discipline_id'], where: { tournament_discipline_id: { in: drawIds } }, _count: { _all: true } })
    : [];
  const countOn = new Map(counts.map((c) => [c.tournament_discipline_id, c._count._all]));
  const fixturesOnDraw = new Map<string, number>();
  for (const f of bp.fixtures) {
    const d = drawOf.get(f.drawKey);
    const drawId = draws.get(f.drawKey)?.drawId;
    const existing = drawId ? countOn.get(drawId) ?? 0 : 0;
    fixturesOnDraw.set(f.drawKey, existing);
    if (!d) { issue('error', 'unknown_draw', 'A schedule names a draw that is not on the sheet', 'fixtures'); continue; }
    const label = `${d.sport} · ${d.discipline}`;
    let planned = 0;
    try {
      if (f.kind === 'knockout-rows') {
        if (lc(d.format) !== 'knockout') throw new KnockoutSheetError(`a match list builds a knockout, but the draw is ${d.format}`);
        const { layout, gen, realCount } = knockoutFixturesOf(f, d.thirdPlace);
        const drawn = new Set(layout.squads);
        const missing = bp.squads.filter((s) => s.drawKey === f.drawKey && !drawn.has(s.key)).map((s) => s.name);
        if (missing.length) issue('error', 'squad_not_in_schedule', `${label}: entered but not in the schedule: ${missing.join(', ')}`, 'fixtures');
        const unknown = layout.squads.filter((k) => !bp.squads.some((s) => s.key === k && s.drawKey === f.drawKey));
        if (unknown.length) issue('error', 'unknown_squad', `${label}: the schedule names squads that are not in this draw`, 'fixtures');
        planned = gen.length;
        steps.fixtures.notes.push(`${label}: ${realCount} matches + ${gen.length - realCount} byes, ${layout.rounds} rounds (${2 ** layout.rounds}-slot bracket)`);
      } else {
        const tokens = bp.squads.filter((s) => s.drawKey === f.drawKey).map((s) => s.key);
        const gen = generatedFixturesOf(d.format, tokens, d.thirdPlace);
        planned = gen.length;
        const byes = gen.filter((g) => g.status === 'bye').length;
        steps.fixtures.notes.push(`${label}: ${d.format} generated over ${tokens.length} squads — ${gen.length - byes} matches${byes ? ` + ${byes} byes` : ''}, no times or grounds`);
      }
    } catch (e) {
      issue('error', 'bad_bracket', `${label}: ${(e as Error).message}`, 'fixtures');
      continue;
    }
    if (!used('fixtures')) continue;
    if (existing) {
      steps.fixtures.found += existing;
      steps.fixtures.notes.push(`${label}: the draw already has ${existing} fixtures — left as they are`);
    } else if (bp.steps.fixtures === 'sheet') steps.fixtures.create += planned;
    else if (bp.steps.fixtures === 'existing') { steps.fixtures.missing += 1; steps.fixtures.missingNames.push(label); }
    else steps.fixtures.absent += 1;
  }

  // ---- what is missing, said once per step ----------------------------------------------------------
  for (const k of SETUP_STEP_KEYS) {
    const n = steps[k];
    const label = stepLabel(STEP_INFO.get(k)!, bp.eventType);
    if (n.missing) {
      const list = n.missingNames.slice(0, 10).join(', ') + (n.missingNames.length > 10 ? `, and ${n.missingNames.length - 10} more` : '');
      issue('error', 'not_on_platform', `${label}: ${plural(n.missing, 'row')} marked "Already exists" ${n.missing === 1 ? 'is' : 'are'} not on the platform: ${list}`, k);
    }
    if (n.absent && n.mode === 'skip') n.notes.push(`${n.absent} not on the platform — left alone (step skipped)`);
  }

  return {
    steps, issues, roles: roleIds,
    org: { id: orgId, activePlan },
    campusId, competitorIds, personIds, staffIds, staffIsPerson,
    champ: { id: champId, tournamentId, coByOrg: new Map(cos.map((c) => [c.organization_id, c.id])) },
    venueId, groundIds, draws, teamIds, fixturesOnDraw,
  };
}

/** The organisations a person belongs to: the host, or (inter) the orgs of their squads. */
function personOrgResolver(bp: EventSetupBlueprint, hostId: string | null, competitorIds: Map<string, string>) {
  const competitorsOf = new Map<string, string[]>();
  for (const s of bp.squads) {
    for (const m of s.members) competitorsOf.set(m.personKey, uniq([...(competitorsOf.get(m.personKey) ?? []), s.competitorKey]));
  }
  return (personKey: string): string[] => {
    const keys = bp.eventType === 'inter' ? competitorsOf.get(personKey) : undefined;
    // Not on any squad (or not inter): the host. On squads: only THOSE organisations -
    // never the host as a stand-in for one not built yet, or a member code from one
    // organisation could match somebody else's in another.
    if (!keys?.length) return hostId ? [hostId] : [];
    return uniq(keys.map((k) => competitorIds.get(k)).filter((x): x is string => !!x));
  };
}

/** The dashboard's view of a resolution: one row per step, plus the platform issues. */
export function platformPlanOf(res: Resolution): { steps: SetupPlatformStep[]; issues: SetupIssue[] } {
  return {
    steps: SETUP_STEP_KEYS.map((k) => {
      const n = res.steps[k];
      return { step: k, mode: n.mode, found: n.found, create: n.mode === 'sheet' ? n.create : 0, missing: n.missing, notes: [...n.notes] };
    }),
    issues: [...res.issues],
  };
}

/** Read-only: what an apply would find, create, and is missing. */
export async function planPlatform(prisma: Prisma, bp: EventSetupBlueprint, store: ManifestStore) {
  const res = await resolvePlatform(prisma, bp, await store.load());
  return { ...platformPlanOf(res), resolution: res };
}

// ===========================================================================
// apply
// ===========================================================================
export interface StepReport { step: SetupStepKey; mode: SetupStepMode; found: number; created: number; notes: string[] }

export interface FixtureView { draw: string; matchId: string; round: string; date: string; kickoff: string; ground?: string; home: string; away: string }

export interface ApplyOptions {
  /** Who is running it: the fallback organiser on rows that need one (the super admin, from the API). */
  actorId?: string | null;
  /** Filled as accounts are created, so a caller still has them if a later step fails. */
  credentials?: CredentialRow[];
}

export interface ApplyResult {
  reports: StepReport[];
  ids: { orgId: string; campusId: string | null; champId: string | null; venueId: string | null; draws: Record<string, string> };
  fixtureView: FixtureView[];
  credentials: CredentialRow[];
}

/** Thrown when the platform refuses the blueprint before anything is written. */
export class SetupRefusedError extends Error {
  constructor(readonly issues: SetupIssue[]) {
    super(`Apply refused: ${issues.filter((i) => i.severity === 'error').map((i) => i.message).slice(0, 3).join(' · ')}`);
  }
}

export async function applyBlueprint(prisma: Prisma, bp: EventSetupBlueprint, store: ManifestStore, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const m = await store.load();
  const res = await resolvePlatform(prisma, bp, m);
  const errors = res.issues.filter((i) => i.severity === 'error');
  if (errors.length) throw new SetupRefusedError(errors);

  m.runs.push({ at: new Date().toISOString(), mode: 'apply' });
  const created = async (table: string, ids: string[]) => {
    if (!ids.length) return;
    (m.created[table] ??= []).push(...ids);
    await store.save(m);
  };
  const remember = (key: string, id: string) => { m.keys[key] = id; };
  const reports: StepReport[] = [];
  const report = (s: SetupStepKey) => {
    const r: StepReport = { step: s, mode: bp.steps[s], found: 0, created: 0, notes: [] };
    reports.push(r);
    return r;
  };
  const sheet = (s: SetupStepKey) => bp.steps[s] === 'sheet';
  const used = (s: SetupStepKey) => bp.steps[s] !== 'skip';
  const inter = bp.eventType === 'inter';
  const credentials = opts.credentials ?? [];
  const newCredentials: CredentialRow[] = [];
  const roleId = (code: string) => {
    const id = res.roles.get(code);
    if (!id) throw new Error(`role not in catalogue: ${code}`);
    return id;
  };

  // ---- org ---------------------------------------------------------------------------
  const rOrg = report('org');
  let orgId = res.org.id;
  if (orgId) { rOrg.found++; rOrg.notes.push(`found "${bp.org.name}"`); }
  else {
    const base = bp.org.shortName.toUpperCase();
    const taken = await prisma.organizations.findMany({ where: { code: { in: candidates(base) } }, select: { code: true } });
    const code = firstFree(base, taken.map((t) => t.code ?? ''));
    orgId = randomUUID();
    await prisma.organizations.create({
      data: {
        id: orgId, name: bp.org.name, short_name: bp.org.shortName, code, city: bp.org.city,
        country: bp.org.country ?? 'India', status: true, kind: 'institution', verified: true,
        settings: { unit_labels: bp.org.unitLabels },
      },
    });
    await created('organizations', [orgId]);
    rOrg.created++;
    rOrg.notes.push(`created "${bp.org.name}" (code ${code})`);
  }
  remember('org', orgId);
  if (bp.org.plan && bp.org.plan !== 'free') {
    if (res.org.activePlan) rOrg.notes.push(`already on plan ${res.org.activePlan}`);
    else if (sheet('org')) {
      const id = randomUUID();
      const now = new Date();
      await prisma.subscriptions.create({
        data: {
          id, ladder: 'org', organization_id: orgId, plan: bp.org.plan, period: 'annual', status: 'active',
          current_period_start: now, current_period_end: new Date(now.getTime() + 365 * 864e5), provider: 'none',
        },
      });
      await created('subscriptions', [id]);
      rOrg.notes.push(`granted plan ${bp.org.plan} (annual, no charge)`);
    }
  }

  // ---- campus --------------------------------------------------------------------------
  const rCampus = report('campus');
  let campusId = res.campusId;
  if (bp.campus) {
    if (campusId) rCampus.found++;
    else if (sheet('campus')) {
      campusId = randomUUID();
      await prisma.org_units.create({ data: { id: campusId, organization_id: orgId, parent_id: null, type: 'campus', name: bp.campus.name, code: bp.campus.code, display_order: 0, status: 'ACTIVE' } });
      await created('org_units', [campusId]);
      rCampus.created++;
    }
    if (campusId) remember('campus', campusId);
  } else rCampus.notes.push(...res.steps.campus.notes);

  // ---- competitors ------------------------------------------------------------------------
  const rComp = report('competitors');
  const competitorIdOf = new Map(res.competitorIds);
  {
    const units: any[] = [];
    const orgs: any[] = [];
    const orgCodes = bp.competitors.filter((c) => c.kind === 'organization' && !competitorIdOf.has(c.key) && lc(c.name) !== lc(bp.org.name))
      .map((c) => orgCodeOf(c.name, c.code));
    const takenCodes = orgCodes.length
      ? (await prisma.organizations.findMany({ where: { code: { in: orgCodes.flatMap((c) => candidates(c)) } }, select: { code: true } })).map((t) => t.code ?? '')
      : [];
    for (const [i, c] of bp.competitors.entries()) {
      let id = competitorIdOf.get(c.key) ?? null;
      if (!id && c.kind === 'organization' && lc(c.name) === lc(bp.org.name)) id = orgId;
      if (id) { rComp.found++; competitorIdOf.set(c.key, id); continue; }
      if (!sheet('competitors')) continue;
      id = randomUUID();
      competitorIdOf.set(c.key, id);
      rComp.created++;
      if (c.kind === 'organization') {
        const code = firstFree(orgCodeOf(c.name, c.code), takenCodes);
        takenCodes.push(code);
        orgs.push({
          id, name: c.name, short_name: orgCodeOf(c.name, c.code), code, city: bp.org.city ?? null,
          country: bp.org.country ?? 'India', status: true, kind: 'institution', verified: true, settings: {},
        });
      } else {
        units.push({
          id, organization_id: orgId, parent_id: c.kind === 'department' ? campusId : null, type: c.kind,
          name: c.name, code: c.code ?? null, display_order: i + 1, status: 'ACTIVE',
        });
      }
    }
    if (units.some((u) => u.type === 'department' && !u.parent_id)) throw new Error('competitors: batches need a campus to go under');
    if (orgs.length) { await prisma.organizations.createMany({ data: orgs }); await created('organizations', orgs.map((o) => o.id)); }
    if (units.length) { await prisma.org_units.createMany({ data: units }); await created('org_units', units.map((u) => u.id)); }
    for (const c of bp.competitors) {
      const id = competitorIdOf.get(c.key);
      if (id) remember(c.kind === 'organization' ? `competitor:${c.key}` : `unit:${c.key}`, id);
    }
    rComp.notes.push(...res.steps.competitors.notes);
  }
  const orgNameOf = new Map<string, string>([[orgId, bp.org.name]]);
  for (const c of bp.competitors) if (c.kind === 'organization' && competitorIdOf.get(c.key)) orgNameOf.set(competitorIdOf.get(c.key)!, c.name);

  // ---- people + staff: one batch of new accounts --------------------------------------------
  const rPeople = report('people');
  const rStaff = report('staff');
  const userIdOf = new Map(res.personIds);
  const staffIdOf = new Map(res.staffIds);
  const orgsOfPerson = personOrgResolver(bp, orgId, competitorIdOf);
  const competitorOrgOfStaff = (s: EventSetupBlueprint['staff'][number]) =>
    (inter && s.eventRole === 'poc' && s.competitorKey ? competitorIdOf.get(s.competitorKey) ?? null : null);

  type NewUser = { id: string; name: string; email: string; phone: string; password: string; contact: ContactKind; role: string; orgId: string; accountType: string; gender?: string };
  const newUsers: NewUser[] = [];
  const needsMint = bp.people.some((p) => !userIdOf.has(p.key)) || bp.staff.some((s) => !staffIdOf.has(s.key) && !res.staffIsPerson.has(s.key));
  let placeholderSeq = 0;
  if (needsMint && (sheet('people') || sheet('staff'))) {
    // Placeholder numbers continue after the highest one already on the platform, so
    // two events never mint the same one. Read off the emails too: once a player's
    // placeholder phone is replaced on registration day, the phone alone would hand
    // the top number out a second time.
    const [{ top_phone, top_email }] = await prisma.$queryRaw<Array<{ top_phone: string | null; top_email: number | null }>>`
      select
        (select max(right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10)) from users
          where right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) like '50000%') as top_phone,
        (select max((substring(email from '-([0-9]{1,5})@placeholder\\.invalid$'))::int) from users
          where email like '%@placeholder.invalid') as top_email`;
    placeholderSeq = Math.max(top_phone ? Number(top_phone.slice(5)) : 0, Number(top_email ?? 0));
  }
  const mint = (name: string, phone: string | undefined, email: string | undefined, role: string, org: string, accountType: string, gender?: string): NewUser => {
    const seq = ++placeholderSeq;
    const login = provisionalLogin(name, phone, email);
    return {
      id: randomUUID(), name, role, orgId: org, accountType, gender,
      phone: phone ?? placeholderPhone(seq),
      email: email ? lc(email) : placeholderEmail(`${name} ${bp.placeholder.emailStem} ${seq}`),
      password: login.password, contact: login.contact,
    };
  };

  for (const p of bp.people) {
    if (userIdOf.has(p.key)) { rPeople.found++; continue; }
    if (!sheet('people')) continue;
    const u = mint(p.name, p.phone, p.email, 'player', orgsOfPerson(p.key)[0] ?? orgId, 'participant', p.gender);
    newUsers.push(u);
    userIdOf.set(p.key, u.id);
    rPeople.created++;
  }
  rPeople.notes.push(...res.steps.people.notes);
  for (const s of bp.staff) {
    const asPerson = res.staffIsPerson.get(s.key);
    if (asPerson && userIdOf.has(asPerson)) { staffIdOf.set(s.key, userIdOf.get(asPerson)!); rStaff.found++; continue; }
    if (staffIdOf.has(s.key)) { rStaff.found++; continue; }
    if (!sheet('staff')) continue;
    const u = mint(s.name, s.phone, s.email, s.eventRole ?? s.orgRole ?? 'staff', competitorOrgOfStaff(s) ?? orgId, 'institution');
    newUsers.push(u);
    staffIdOf.set(s.key, u.id);
    rStaff.created++;
  }

  if (newUsers.length) {
    // Sportagon IDs per stamping organisation; hashing (the slow part, ~70ms each) in
    // parallel chunks and outside any transaction.
    const idsFor = new Map<string, string[]>();
    for (const org of uniq(newUsers.map((u) => u.orgId))) {
      const n = newUsers.filter((u) => u.orgId === org).length;
      idsFor.set(org, await mintSportagonIds(prisma, orgIdPrefix(orgNameOf.get(org) ?? bp.org.name), n));
    }
    const rows: any[] = [];
    for (let i = 0; i < newUsers.length; i += 25) {
      const chunk = newUsers.slice(i, i + 25);
      // A placeholder account gets NO password hash: its random password is never
      // handed to anyone (credentials drop it), and password sign-in refuses an
      // account with none, so hashing it was most of an apply's time on Lambda
      // (332 of WNS's 388 accounts). Phone OTP works once the contact is replaced.
      const hashes = await Promise.all(chunk.map((u) => (u.contact === 'placeholder' ? null : bcrypt.hash(u.password, 10))));
      chunk.forEach((u, j) => rows.push({
        id: u.id, name: u.name, email: u.email, phone: u.phone, password_hash: hashes[j],
        organization_id: u.orgId, account_type: u.accountType, must_change_password: true,
        sportagon_id: idsFor.get(u.orgId)!.shift(), gender: u.gender ?? null,
      }));
    }
    await prisma.users.createMany({ data: rows });
    await created('users', rows.map((r) => r.id));
    for (const u of newUsers) {
      const c: CredentialRow = { name: u.name, role: u.role, contact: u.contact, phone: u.phone, email: u.email, password: u.contact === 'placeholder' ? null : u.password };
      newCredentials.push(c);
      credentials.push(c);
    }
  }
  for (const [k, id] of userIdOf) remember(`person:${k}`, id);
  for (const [k, id] of staffIdOf) remember(`staff:${k}`, id);

  // Memberships: every player a verified member of their organisation(s) with the
  // employee id as member code; staff with their org role; an inter POC the owner of
  // the organisation they speak for. Then (intra) the campus for everyone.
  if (sheet('people') || sheet('staff')) {
    const owner = bp.staff.find((s) => s.orgRole === 'owner');
    const verifier = owner ? staffIdOf.get(owner.key) ?? null : null;
    const memberRows: Array<{ org: string; user_id: string; role: string; member_code: string | null }> = [];
    if (sheet('people')) {
      for (const p of bp.people) {
        const uid = userIdOf.get(p.key);
        if (uid) for (const org of orgsOfPerson(p.key)) memberRows.push({ org, user_id: uid, role: 'member', member_code: p.memberCode ?? null });
      }
    }
    if (sheet('staff')) {
      for (const s of bp.staff) {
        const uid = staffIdOf.get(s.key);
        if (!uid) continue;
        if (s.orgRole) memberRows.push({ org: orgId, user_id: uid, role: s.orgRole, member_code: null });
        const pocOrg = competitorOrgOfStaff(s);
        if (pocOrg) memberRows.push({ org: pocOrg, user_id: uid, role: 'owner', member_code: null });
      }
    }
    // One row per person per organisation: the senior role, and the member code from
    // whichever row carried one (a player who is also a POC keeps their employee id).
    const RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };
    const merged = new Map<string, (typeof memberRows)[number]>();
    for (const r of memberRows) {
      const k = `${r.org}|${r.user_id}`;
      const had = merged.get(k);
      merged.set(k, had
        ? { ...had, role: (RANK[r.role] ?? 0) > (RANK[had.role] ?? 0) ? r.role : had.role, member_code: had.member_code ?? r.member_code }
        : r);
    }
    const unique = [...merged.values()];
    const have = unique.length
      ? new Set((await prisma.organization_members.findMany({
        where: { organization_id: { in: uniq(unique.map((r) => r.org)) }, user_id: { in: uniq(unique.map((r) => r.user_id)) } },
        select: { organization_id: true, user_id: true },
      })).map((x) => `${x.organization_id}|${x.user_id}`))
      : new Set<string>();
    const fresh = unique.filter((r) => !have.has(`${r.org}|${r.user_id}`)).map((r) => ({
      id: randomUUID(), organization_id: r.org, user_id: r.user_id, role: r.role, status: 'active',
      verification: 'verified', verified_by: verifier, verified_at: new Date(), member_code: r.member_code,
    }));
    let added = 0;
    if (fresh.length) {
      const { count } = await prisma.organization_members.createMany({ data: fresh, skipDuplicates: true });
      added = count;
      // A row the database skipped (its member ID is already somebody else's in that
      // organisation) is not this setup's to delete - record only what landed.
      const landed = count === fresh.length
        ? fresh.map((r) => r.id)
        : (await prisma.organization_members.findMany({ where: { id: { in: fresh.map((r) => r.id) } }, select: { id: true } })).map((r) => r.id);
      await created('organization_members', landed);
      if (count < fresh.length) rPeople.notes.push(`${fresh.length - count} memberships not added: the member ID is already taken in that organisation`);
    }
    rPeople.notes.push(`${added} memberships added`);
    if (campusId) {
      const hostMembers = uniq(unique.filter((r) => r.org === orgId).map((r) => r.user_id));
      await insertUnitMembers(prisma, hostMembers.map((user_id) => ({ id: randomUUID(), organization_id: orgId!, org_unit_id: campusId!, user_id })), created);
    }
  }

  // ---- championship ------------------------------------------------------------------------------
  const rChamp = report('championship');
  const c = bp.championship;
  const ownerKey = bp.staff.find((s) => s.orgRole === 'owner')?.key;
  const organiserKey = bp.staff.find((s) => s.eventRole === 'organiser')?.key;
  const by = (ownerKey ? staffIdOf.get(ownerKey) : undefined) ?? (organiserKey ? staffIdOf.get(organiserKey) : undefined) ?? opts.actorId ?? null;
  let champId = res.champ.id;
  let tournamentId = res.champ.tournamentId;
  const coByOrg = new Map(res.champ.coByOrg);
  if (champId) rChamp.found++;
  else if (sheet('championship')) {
    if (!by) throw new Error('championship: needs an owner or organiser among the staff (or someone running the setup) to stand behind it');
    const base = slugOf(c.name);
    const takenSlugs = await prisma.championships.findMany({ where: { slug: { in: candidates(base) } }, select: { slug: true } });
    const slug = firstFree(base, takenSlugs.map((t) => t.slug ?? ''));
    champId = randomUUID();
    await prisma.championships.create({
      data: {
        id: champId, name: c.name, slug, description: c.description, venue: bp.venue.name,
        start_date: new Date(c.startDate), end_date: new Date(c.endDate), status: c.status,
        visibility: c.visibility, type: c.type, country: bp.org.country ?? 'India', region: 'asia',
        allow_individual_entry: false, host_organization_id: orgId,
        entry_level: c.entryLevel, entry_scope_unit_id: c.scopeToCampus && c.entryLevel === 'department' ? campusId : null,
      },
    });
    await created('championships', [champId]);
    tournamentId = randomUUID();
    await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
    await created('tournaments', [tournamentId]);
    const ruleId = randomUUID();
    await prisma.standings_rules.create({
      data: {
        id: ruleId, championship_id: champId, scope_type: 'championship', scope_id: null,
        config: { scheme: 'placement', points: { winner: c.placement.winner, runner_up: c.placement.runner_up, semi_finalist: c.placement.semi_finalist }, participation: c.placement.participation },
      },
    });
    await created('standings_rules', [ruleId]);
    rChamp.created++;
  }
  if (champId) remember('championship', champId);
  if (champId && !tournamentId && (used('draws') || used('squads'))) {
    // A championship made in the UI may not have its tournament yet.
    tournamentId = randomUUID();
    await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
    await created('tournaments', [tournamentId]);
  }

  /**
   * The entry row squads hang off. Intra and campus events have exactly one, the
   * host's own, never shown: it exists because team_entries hangs off an entry, and
   * the competitor is the unit. Inter events have one per competing organisation.
   */
  const ensureCo = async (org: string) => {
    const have = coByOrg.get(org);
    if (have) return have;
    if (!by) throw new Error('championship: an entry needs someone to stand behind it (an owner or organiser among the staff)');
    const id = randomUUID();
    await prisma.championship_organizations.create({
      data: { id, championship_id: champId!, organization_id: org, applied_by: by, status: 'approved', reviewed_by: by, reviewed_at: new Date() },
    });
    await created('championship_organizations', [id]);
    coByOrg.set(org, id);
    return id;
  };
  if (champId && sheet('championship') && rChamp.created && !inter) await ensureCo(orgId);

  // Event roles and officials.
  if (champId && sheet('staff')) {
    const ucr: any[] = [];
    const officials: any[] = [];
    for (const s of bp.staff) {
      const uid = staffIdOf.get(s.key);
      if (!uid || !s.eventRole) continue;
      ucr.push({ id: randomUUID(), user_id: uid, championship_id: champId, role_id: roleId(s.eventRole), assigned_by: by });
      if (s.eventRole === 'official') officials.push({ id: randomUUID(), championship_id: champId, user_id: uid, assigned_by: by, is_active: true, notes: s.note ?? null });
    }
    const [haveRoles, haveOff] = await Promise.all([
      prisma.user_championship_roles.findMany({ where: { championship_id: champId }, select: { user_id: true, role_id: true } }),
      prisma.championship_officials.findMany({ where: { championship_id: champId }, select: { user_id: true } }),
    ]);
    const roleSet = new Set(haveRoles.map((h) => `${h.user_id}|${h.role_id}`));
    const newRoles = [...new Map(ucr.filter((r) => !roleSet.has(`${r.user_id}|${r.role_id}`)).map((r) => [`${r.user_id}|${r.role_id}`, r])).values()];
    if (newRoles.length) { await prisma.user_championship_roles.createMany({ data: newRoles }); await created('user_championship_roles', newRoles.map((r) => r.id)); }
    const offSet = new Set(haveOff.map((h) => h.user_id));
    const newOff = [...new Map(officials.filter((o) => !offSet.has(o.user_id)).map((o) => [o.user_id, o])).values()];
    if (newOff.length) { await prisma.championship_officials.createMany({ data: newOff }); await created('championship_officials', newOff.map((o) => o.id)); }
    rStaff.notes.push(`${newRoles.length} event roles, ${newOff.length} officials granted`);
  }
  rStaff.notes.push(...res.steps.staff.notes);

  // ---- venue + grounds ---------------------------------------------------------------------------
  const rVenue = report('venue');
  const groundIdOf = new Map(res.groundIds);
  let venueId = res.venueId;
  if (used('venue') && champId) {
    if (venueId) rVenue.found++;
    else if (sheet('venue')) {
      venueId = randomUUID();
      await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: bp.venue.name, city: bp.venue.city } });
      await created('venues', [venueId]);
      rVenue.created++;
    }
    if (venueId) remember('venue', venueId);
    const grounds: any[] = [];
    for (const [i, g] of bp.venue.grounds.entries()) {
      if (groundIdOf.has(g.key)) { rVenue.found++; continue; }
      if (!sheet('venue') || !venueId) continue;
      const id = randomUUID();
      grounds.push({ id, venue_id: venueId, name: g.name, ground_type: g.type, display_order: i, is_active: true });
      groundIdOf.set(g.key, id);
      rVenue.created++;
    }
    if (grounds.length) { await prisma.venue_grounds.createMany({ data: grounds }); await created('venue_grounds', grounds.map((g) => g.id)); }
  }
  for (const [k, id] of groundIdOf) remember(`ground:${k}`, id);

  // ---- draws -----------------------------------------------------------------------------------------
  const rDraws = report('draws');
  const drawIdOf = new Map<string, string>();
  const sportIdOf = new Map<string, string>();
  const tsBySport = new Map<string, string>();
  for (const [, d] of res.draws) if (d.sportId && d.tsId) tsBySport.set(d.sportId, d.tsId);
  for (const d of bp.draws) {
    const r = res.draws.get(d.key)!;
    if (r.sportId) sportIdOf.set(d.key, r.sportId);
    if (r.drawId) {
      drawIdOf.set(d.key, r.drawId);
      remember(`draw:${d.key}`, r.drawId);
      if (used('draws')) rDraws.found++;
      continue;
    }
    if (!sheet('draws') || !champId || !tournamentId || !r.sportId || !r.formatId) continue;

    let disciplineId = r.disciplineId;
    if (!disciplineId) {
      disciplineId = randomUUID();
      await prisma.disciplines.create({ data: { id: disciplineId, sport_id: r.sportId, name: d.discipline, entry_type: 'team', squad_min: d.squadMin, squad_max: d.squadMax, championship_id: champId } });
      await created('disciplines', [disciplineId]);
      rDraws.notes.push(`created discipline "${d.discipline}" for this championship only`);
    }
    let formatId = r.scoringFormatId;
    if (!formatId && d.scoring && r.scoring) {
      formatId = randomUUID();
      await prisma.scoring_formats.create({ data: { id: formatId, organization_id: orgId, sport_id: r.sportId, name: d.scoring.name, preset_key: d.scoring.presetKey, config: r.scoring as unknown as object, is_system: false } });
      await created('scoring_formats', [formatId]);
    }
    let tsId = tsBySport.get(r.sportId);
    if (!tsId) {
      tsId = randomUUID();
      await prisma.tournament_sports.create({ data: { id: tsId, tournament_id: tournamentId, sport_id: r.sportId, format_id: r.formatId, format_config: { thirdPlaceMatch: d.thirdPlace }, display_order: tsBySport.size } });
      await created('tournament_sports', [tsId]);
      tsBySport.set(r.sportId, tsId);
    }
    const drawId = randomUUID();
    await prisma.tournament_disciplines.create({
      data: {
        id: drawId, tournament_sport_id: tsId, discipline_id: disciplineId, format_id: r.formatId,
        venue_id: venueId, status: 'upcoming', display_order: drawIdOf.size, squad_min: d.squadMin, squad_max: d.squadMax,
        format_config: { thirdPlaceMatch: d.thirdPlace, scoring: drawScoringTemplate(d.sport) } as object,
        scoring_format_id: formatId ?? null,
      },
    });
    await created('tournament_disciplines', [drawId]);
    drawIdOf.set(d.key, drawId);
    remember(`draw:${d.key}`, drawId);
    rDraws.created++;
  }
  rDraws.notes.push(...bp.draws.map((d) => `${d.sport} · ${d.discipline} · ${d.format}${d.scoring ? ` · ${d.scoring.name}` : ''}`));

  // ---- squads ----------------------------------------------------------------------------------------
  // Team, roster, unit placement, the invitation that lets the unit enter, the entry.
  // `org_unit_id` on BOTH the team and the entry is what keeps intra squads apart in
  // the standings; without it every squad resolves to the organisation.
  const rSquads = report('squads');
  const teamIdOf = new Map(res.teamIds);
  if (used('squads')) {
    const competitorOf = new Map<string, SetupCompetitorSpec>(bp.competitors.map((x) => [x.key, x]));
    const teams: any[] = []; const members: any[] = []; const unitMembers: any[] = []; const invites: any[] = []; const entries: any[] = [];
    let leftOut = 0;
    for (const s of bp.squads) {
      const comp = competitorOf.get(s.competitorKey)!;
      const cid = competitorIdOf.get(s.competitorKey);
      const sportId = sportIdOf.get(s.drawKey);
      const drawId = drawIdOf.get(s.drawKey);
      const teamOrg = inter ? cid : orgId;
      const unitId = inter ? null : cid ?? null;
      let teamId = teamIdOf.get(s.key) ?? null;
      if (teamId) rSquads.found++;
      else if (sheet('squads')) {
        if (!cid || !sportId || !drawId || !teamOrg) throw new Error(`squads: ${s.name} is missing its competitor or draw`);
        teamId = randomUUID();
        teamIdOf.set(s.key, teamId);
        teams.push({ id: teamId, sport_id: sportId, organization_id: teamOrg, org_unit_id: unitId, name: s.name, short_name: s.shortName, status: 'approved' });
        rSquads.created++;
      }
      if (!teamId || !sheet('squads')) continue;
      for (const mbr of s.members) {
        const uid = userIdOf.get(mbr.personKey);
        if (!uid) { leftOut++; continue; }
        members.push({ id: randomUUID(), team_id: teamId, user_id: uid, role: mbr.role, is_active: true });
        if (unitId) unitMembers.push({ id: randomUUID(), organization_id: orgId, org_unit_id: unitId, user_id: uid });
      }
      if (!champId || !drawId || !teamOrg) continue;
      if (unitId) invites.push({ id: randomUUID(), championship_id: champId, org_name: comp.name, org_unit_id: unitId, status: 'accepted', invited_by: by, accepted_by: by, responded_at: new Date() });
      entries.push({ team_id: teamId, organization_id: teamOrg, championship_id: champId, tournament_discipline_id: drawId, status: 'approved', org_unit_id: unitId });
    }
    if (sheet('squads')) {
      if (teams.length) { await prisma.teams.createMany({ data: teams }); await created('teams', teams.map((t) => t.id)); }
      // The sheet is the source of truth for a squad's name: a found squad whose name
      // or scoreboard code has since changed on the sheet is renamed, not duplicated.
      const current = await prisma.teams.findMany({ where: { id: { in: [...teamIdOf.values()] } }, select: { id: true, name: true, short_name: true } });
      const byId = new Map(current.map((t) => [t.id, t]));
      let renamed = 0;
      for (const s of bp.squads) {
        const row = byId.get(teamIdOf.get(s.key) ?? '');
        if (!row || (row.name === s.name && row.short_name === s.shortName)) continue;
        await prisma.teams.update({ where: { id: row.id }, data: { name: s.name, short_name: s.shortName, updated_at: new Date() } });
        renamed++;
      }
      if (renamed) rSquads.notes.push(`${renamed} squads renamed to the sheet`);
      const haveMembers = new Set((await prisma.team_members.findMany({ where: { team_id: { in: [...teamIdOf.values()] } }, select: { team_id: true, user_id: true } })).map((x) => `${x.team_id}|${x.user_id}`));
      const newMembers = [...new Map(members.filter((x) => !haveMembers.has(`${x.team_id}|${x.user_id}`)).map((x) => [`${x.team_id}|${x.user_id}`, x])).values()];
      if (newMembers.length) { await prisma.team_members.createMany({ data: newMembers }); await created('team_members', newMembers.map((x) => x.id)); }
      await insertUnitMembers(prisma, unitMembers, created);
      let newInv: any[] = [];
      let newEntries: any[] = [];
      if (champId) {
        if (invites.length) {
          if (!by) throw new Error('squads: inviting a unit needs an owner or organiser among the staff');
          const haveInv = new Set((await prisma.championship_invitations.findMany({ where: { championship_id: champId }, select: { org_unit_id: true } })).map((x) => x.org_unit_id));
          newInv = [...new Map(invites.filter((x) => !haveInv.has(x.org_unit_id)).map((x) => [x.org_unit_id, x])).values()];
          if (newInv.length) { await prisma.championship_invitations.createMany({ data: newInv }); await created('championship_invitations', newInv.map((x) => x.id)); }
        }
        const haveEntry = new Set((await prisma.team_entries.findMany({ where: { championship_id: champId }, select: { team_id: true } })).map((x) => x.team_id));
        const pending = entries.filter((x) => !haveEntry.has(x.team_id));
        for (const org of uniq(pending.map((e) => e.organization_id as string))) await ensureCo(org);
        newEntries = pending.map((e) => ({ id: randomUUID(), ...e, championship_organization_id: coByOrg.get(e.organization_id) }));
        if (newEntries.length) { await prisma.team_entries.createMany({ data: newEntries }); await created('team_entries', newEntries.map((x) => x.id)); }
      }
      rSquads.notes.push(`${newMembers.length} roster places, ${newInv.length} ${inter ? 'invitations' : 'unit invitations'}, ${newEntries.length} entries`);
      if (leftOut) rSquads.notes.push(`${leftOut} roster places left out: those people are not on the platform`);
    }
    for (const [k, id] of teamIdOf) remember(`team:${k}`, id);
  }

  // ---- fixtures ----------------------------------------------------------------------------------------
  const rFix = report('fixtures');
  const fixtureView: FixtureView[] = [];
  for (const f of used('fixtures') ? bp.fixtures : []) {
    const drawId = drawIdOf.get(f.drawKey);
    const draw = bp.draws.find((d) => d.key === f.drawKey)!;
    const label = `${draw.sport} · ${draw.discipline}`;
    const existing = res.fixturesOnDraw.get(f.drawKey) ?? 0;
    const team = (k: string | null | undefined) => (k ? teamIdOf.get(k) ?? null : null);
    let rows: any[];
    if (f.kind === 'knockout-rows') {
      const { layout, gen, realCount } = knockoutFixturesOf(f, draw.thirdPlace);
      const rowAt = new Map<number, (typeof f.rows)[number]>();
      for (const r of f.rows) rowAt.set(layout.positionOf.get(r.matchId)!, r);
      const officialOn = new Map(bp.staff.filter((s) => s.groundKey).map((s) => [s.groundKey!, staffIdOf.get(s.key) ?? null]));
      rows = gen.map((g) => {
        const sheetRow = g.bracketPosition != null ? rowAt.get(g.bracketPosition) : undefined;
        return {
          id: randomUUID(), tournament_discipline_id: drawId,
          home_team_id: team(g.entrantHome), away_team_id: team(g.entrantAway), winner_team_id: team(g.winnerToken),
          round: g.round, pool_number: null, bracket_position: g.bracketPosition, status: g.status,
          scheduled_at: sheetRow ? new Date(`${sheetRow.date}T${sheetRow.kickoff}:00${f.utcOffset}`) : null,
          duration_minutes: sheetRow?.minutes ?? null,
          venue_ground_id: sheetRow ? groundIdOf.get(sheetRow.groundKey) ?? null : null,
          official_id: sheetRow ? officialOn.get(sheetRow.groundKey) ?? null : null,
          notes: sheetRow ? `Match ${sheetRow.matchId}` : null,
          match_no: sheetRow ? f.rows.indexOf(sheetRow) + 1 : null,
        };
      });
      const name = (side: SetupMatchSide, entrant: string | null) =>
        ('winnerOf' in side ? `Winner of ${side.winnerOf}` : bp.squads.find((s) => s.key === entrant)?.name ?? '?');
      for (const r of f.rows) {
        const g = gen.find((x) => x.bracketPosition === layout.positionOf.get(r.matchId))!;
        fixtureView.push({ draw: label, matchId: r.matchId, round: g.round, date: r.date, kickoff: r.kickoff, ground: bp.venue.grounds.find((x) => x.key === r.groundKey)?.name, home: name(r.home, g.entrantHome), away: name(r.away, g.entrantAway) });
      }
      rFix.notes.push(`${label}: ${f.rows.length} matches + ${gen.length - realCount} byes, ${layout.rounds} rounds (${2 ** layout.rounds}-slot bracket)`);
    } else {
      const squads = bp.squads.filter((s) => s.drawKey === f.drawKey);
      const gen = generatedFixturesOf(draw.format, squads.map((s) => s.key), draw.thirdPlace);
      rows = gen.map((g) => ({
        id: randomUUID(), tournament_discipline_id: drawId,
        home_team_id: team(g.homeTeamId), away_team_id: team(g.awayTeamId), winner_team_id: team(g.winnerTeamId),
        round: g.round, pool_number: g.poolNumber, bracket_position: g.bracketPosition, status: g.status,
      }));
      rFix.notes.push(`${label}: ${draw.format} generated over ${squads.length} squads (${rows.length} fixtures)`);
    }
    if (existing) { rFix.found += existing; rFix.notes.push(`${label}: the draw already has ${existing} fixtures — left as they are`); continue; }
    if (!sheet('fixtures')) continue;
    if (!drawId || !champId) throw new Error(`fixtures: the ${label} draw was not built`);
    const unbuilt = bp.squads.filter((s) => s.drawKey === f.drawKey && !teamIdOf.has(s.key)).map((s) => s.name);
    if (unbuilt.length) throw new Error(`fixtures: ${label} draws squads that were not built: ${unbuilt.slice(0, 5).join(', ')}`);
    await prisma.fixtures.createMany({ data: rows });
    await created('fixtures', rows.map((r) => r.id));
    rFix.created += rows.length;
    await propagateByes(prisma, drawId);
    await assignMatchNos(prisma, champId);
  }

  await store.save(m);
  return {
    reports, fixtureView, credentials: newCredentials,
    ids: { orgId, campusId, champId, venueId, draws: Object.fromEntries(drawIdOf) },
  };
}

async function insertUnitMembers(prisma: Prisma, rows: any[], created: (t: string, ids: string[]) => Promise<void>) {
  if (!rows.length) return;
  const unique = [...new Map(rows.map((r) => [`${r.org_unit_id}|${r.user_id}`, r])).values()];
  const have = new Set((await prisma.org_unit_members.findMany({
    where: { org_unit_id: { in: uniq(unique.map((r) => r.org_unit_id)) }, user_id: { in: uniq(unique.map((r) => r.user_id)) } },
    select: { org_unit_id: true, user_id: true },
  })).map((x) => `${x.org_unit_id}|${x.user_id}`));
  const fresh = unique.filter((r) => !have.has(`${r.org_unit_id}|${r.user_id}`));
  if (!fresh.length) return;
  await prisma.org_unit_members.createMany({ data: fresh, skipDuplicates: true });
  await created('org_unit_members', fresh.map((r) => r.id));
}

// ===========================================================================
// verify — read the built event back and check it against the blueprint
// ===========================================================================
/**
 * Every scheduled match, checked on what a person would check on the day: the date
 * and kickoff, the ground, the official, the two sides, and — for "Winner of" sides —
 * that the earlier match really feeds this one, using the product's own advancement
 * arithmetic rather than this file's. Generated draws are checked for every squad
 * being drawn; every squad for its entry in its draw.
 */
export async function verifyBlueprint(prisma: Prisma, bp: EventSetupBlueprint, store: ManifestStore) {
  const m = await store.load();
  const failures: string[] = [];
  let checked = 0;

  const champId = m.keys.championship;
  if (champId && bp.squads.length && bp.steps.squads !== 'skip') {
    const entries = await prisma.team_entries.findMany({ where: { championship_id: champId }, select: { team_id: true, tournament_discipline_id: true } });
    const entered = new Set(entries.map((e) => `${e.team_id}|${e.tournament_discipline_id}`));
    const missing = bp.squads.filter((s) => !entered.has(`${m.keys[`team:${s.key}`]}|${m.keys[`draw:${s.drawKey}`]}`));
    if (missing.length) failures.push(`${plural(missing.length, 'squad has', 'squads have')} no entry in their draw: ${missing.slice(0, 5).map((s) => s.name).join(', ')}`);
  }

  for (const f of bp.fixtures) {
    const drawId = m.keys[`draw:${f.drawKey}`];
    if (!drawId) { failures.push(`${f.drawKey}: never built`); continue; }
    const rows = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: drawId },
      select: { id: true, notes: true, bracket_position: true, scheduled_at: true, venue_ground_id: true, official_id: true, home_team_id: true, away_team_id: true, status: true, winner_team_id: true },
    });
    if (f.kind === 'generate') {
      checked += rows.length;
      if (!rows.length) { failures.push(`${f.drawKey}: no fixtures`); continue; }
      const drawn = new Set(rows.flatMap((r) => [r.home_team_id, r.away_team_id, r.winner_team_id]));
      for (const s of bp.squads.filter((x) => x.drawKey === f.drawKey)) {
        if (!drawn.has(m.keys[`team:${s.key}`])) failures.push(`${s.name} is not drawn in any fixture`);
      }
      continue;
    }
    const positioned = rows.filter((r) => r.bracket_position != null).length;
    const byMatch = new Map(rows.filter((r) => r.notes?.startsWith('Match ')).map((r) => [r.notes!.slice(6), r]));
    const officialOn = new Map(bp.staff.filter((s) => s.groundKey).map((s) => [s.groundKey!, m.keys[`staff:${s.key}`]]));
    for (const r of f.rows) {
      checked++;
      const fx = byMatch.get(r.matchId);
      if (!fx) { failures.push(`${r.matchId}: no fixture`); continue; }
      const want = new Date(`${r.date}T${r.kickoff}:00${f.utcOffset}`).getTime();
      if (fx.scheduled_at?.getTime() !== want) failures.push(`${r.matchId}: kickoff ${fx.scheduled_at?.toISOString()} is not ${r.date} ${r.kickoff}`);
      if (fx.venue_ground_id !== (m.keys[`ground:${r.groundKey}`] ?? null)) failures.push(`${r.matchId}: wrong ground`);
      if (officialOn.has(r.groundKey) && fx.official_id !== officialOn.get(r.groundKey)) failures.push(`${r.matchId}: official is not the ${r.groundKey} official`);
      for (const side of ['home', 'away'] as const) {
        const s = r[side];
        if ('winnerOf' in s) {
          const child = byMatch.get(s.winnerOf);
          const parent = child?.bracket_position != null ? computeParentPosition(positioned, child.bracket_position) : null;
          if (!parent || parent.parentPos !== fx.bracket_position || parent.slot !== side) failures.push(`${r.matchId}: the winner of ${s.winnerOf} does not advance into its ${side} side`);
        } else if ((side === 'home' ? fx.home_team_id : fx.away_team_id) !== m.keys[`team:${s.squadKey}`]) {
          failures.push(`${r.matchId}: ${side} side is not ${bp.squads.find((q) => q.key === s.squadKey)?.name}`);
        }
      }
    }
    const stuck = rows.filter((r) => r.status === 'bye' && !r.winner_team_id);
    if (stuck.length) failures.push(`${stuck.length} byes have not advanced their squad`);
  }
  return { checked, failures };
}

// ===========================================================================
// cleanup — exactly what was created, in FK order, and never after play starts
// ===========================================================================
export const CLEANUP_ORDER = [
  'fixtures', 'team_entries', 'championship_invitations', 'team_members', 'teams',
  'tournament_disciplines', 'tournament_sports', 'scoring_formats', 'disciplines',
  'venue_grounds', 'venues', 'championship_officials', 'user_championship_roles',
  'standings_rules', 'tournaments', 'championship_organizations', 'championships',
  'org_unit_members', 'organization_members', 'users', 'org_units', 'subscriptions', 'organizations',
] as const;

export class CleanupRefusedError extends Error {}

export async function cleanupBlueprint(prisma: Prisma, store: ManifestStore, opts: { apply: boolean }) {
  const m = await store.load();
  const fx = m.created.fixtures ?? [];
  const draws = m.created.tournament_disciplines ?? [];
  if (fx.length || draws.length) {
    // Any played match on a draw this setup built, whoever made the fixture.
    const played = await prisma.fixtures.count({
      where: {
        OR: [{ id: { in: fx } }, { tournament_discipline_id: { in: draws } }],
        AND: [{ OR: [{ status: { in: ['live', 'completed', 'walkover'] } }, { locked_at: { not: null } }] }],
      },
    });
    if (played) throw new CleanupRefusedError(`Undo refused: ${plural(played, 'match has', 'matches have')} been played. Results are not deleted by a setup.`);
  }
  const unknown = Object.keys(m.created).filter((t) => !(CLEANUP_ORDER as readonly string[]).includes(t) && m.created[t].length);
  if (unknown.length) throw new Error(`cleanup: the manifest lists tables this engine does not know how to remove: ${unknown.join(', ')}`);
  const out: string[] = [];
  for (const table of CLEANUP_ORDER) {
    const ids = m.created[table] ?? [];
    if (!ids.length) continue;
    if (!opts.apply) { out.push(`would delete ${ids.length} ${table}`); continue; }
    // Table names from CLEANUP_ORDER only.
    const n = await prisma.$executeRaw(PrismaNS.sql`delete from ${PrismaNS.raw(table)} where id = any(${ids}::uuid[])`);
    out.push(`deleted ${n}/${ids.length} ${table}`);
  }
  if (opts.apply) await store.save({ keys: {}, created: {}, runs: [...m.runs, { at: new Date().toISOString(), mode: 'cleanup' }] });
  return out;
}
